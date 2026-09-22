import type { Adult, PortalState } from '../../../src/domain/model.ts';
import { DomainError, emailAddress } from '../../../src/domain/logic.ts';
import type { Guardian, Roster } from './sportadmin-api.ts';

const normal = (s: string) =>
  s.normalize('NFC').trim().toLocaleLowerCase('sv').replace(/\s+/g, ' ');
const phone = (s: string) => s.replace(/\D/g, '').replace(/^(0046|46)0?/, '0');
const sameContact = (a: Pick<Adult, 'name' | 'phone' | 'email'>, b: Guardian) =>
  (!!a.email && normal(a.email) === normal(b.email)) ||
  (!!phone(a.phone) && phone(a.phone) === phone(b.phone));

/** Only a fully validated, scoped roster reaches this function. Never use calling lists here. */
export function reconcileInventory(
  state: PortalState,
  roster: Roster,
  previousMapping: Record<string, number>,
  manualChildIds: string[] = [],
) {
  const next = structuredClone(state);
  const mapping = { ...previousMapping };
  const rows = new Map(roster.players.map((p) => [p.id, p]));
  if (!rows.size || rows.size !== roster.players.length)
    throw new DomainError('Spelarregistret är ofullständigt. Ingen inventering sparades.', 409);
  for (const id of manualChildIds) {
    const child = next.children.find((c) => c.id === id);
    if (!child || mapping[id] || roster.players.some((p) => normal(p.name) === normal(child.name)))
      throw new DomainError('En spelare i SportAdmin kan inte undantas från registersynkningen.');
    child.source = 'manual';
  }
  const used = new Set<number>();
  for (const child of next.children) {
    if (mapping[child.id]) {
      if (used.has(mapping[child.id]))
        throw new DomainError('Två barn har samma SportAdmin-koppling.', 409);
      used.add(mapping[child.id]);
      child.source = 'sportadmin';
      continue;
    }
    if (child.source === 'manual') continue;
    const matches = roster.players.filter((p) => normal(p.name) === normal(child.name));
    if (
      matches.length > 1 ||
      (matches.length &&
        next.children.filter((c) => normal(c.name) === normal(child.name)).length > 1)
    )
      throw new DomainError(
        `Koppla ${child.name} till rätt SportAdmin-spelare före inventeringen.`,
        409,
      );
    if (matches.length === 1 && !used.has(matches[0].id)) {
      mapping[child.id] = matches[0].id;
      used.add(matches[0].id);
    }
    // Legacy imported players are checked against the authoritative register.
    // Deliberate manual players are excluded above, including later syncs.
    child.source = 'sportadmin';
  }
  const added: string[] = [];
  for (const player of roster.players) {
    if (used.has(player.id)) continue;
    if (next.children.some((c) => c.source === 'manual' && normal(c.name) === normal(player.name)))
      throw new DomainError(
        `${player.name} finns nu även i SportAdmin. Koppla den manuella spelaren till rätt registerpost under Spelarinventeringen.`,
        409,
      );
    const familyMatches = new Set(
      next.adults
        .filter(
          (a) =>
            a.active &&
            player.guardians.some((g) => sameContact(a, g) && normal(a.name) === normal(g.name)),
        )
        .flatMap((a) => a.familyIds),
    );
    if (familyMatches.size > 1)
      throw new DomainError(
        `Föräldrakontakter för ${player.name} finns i flera familjer. Kontrollera familjekopplingarna före synkningen.`,
        409,
      );
    const familyId = [...familyMatches][0] || `sa-family:${roster.clubId}:${player.id}`;
    const id = `sa-child:${roster.clubId}:${player.id}`;
    if (next.children.some((c) => c.id === id))
      throw new DomainError('Spelarens identitet behöver kontrolleras.', 409);
    if (!next.families.some((f) => f.id === familyId))
      next.families.push({
        id: familyId,
        label: player.name,
        active: player.active,
        exempt: false,
      });
    next.children.push({
      id,
      familyId,
      name: player.name,
      active: player.active,
      source: 'sportadmin',
    });
    mapping[id] = player.id;
    used.add(player.id);
    added.push(id);
    // Seed guardians now so a subsequently imported sibling finds this family.
    for (const g of player.guardians)
      if (
        !next.adults.some(
          (a) =>
            a.familyIds.includes(familyId) &&
            sameContact(a, g) &&
            normal(a.name) === normal(g.name),
        )
      )
        next.adults.push({
          id: `sa-adult:${roster.clubId}:${player.id}:${g.position}`,
          name: g.name,
          phone: g.phone,
          email: g.email,
          familyIds: [familyId],
          active: true,
          source: 'sportadmin',
        });
  }
  const managedFamilies = new Set<string>();
  for (const child of next.children.filter((c) => c.source === 'sportadmin')) {
    const row = rows.get(mapping[child.id]);
    if (row) child.name = row.name;
    child.active = row?.active ?? false;
    managedFamilies.add(child.familyId);
  }
  const desired = new Map<string, Set<string>>();
  let missingEmail = 0;
  for (const child of next.children.filter((c) => c.source === 'sportadmin' && c.active)) {
    const player = rows.get(mapping[child.id])!;
    for (const g of player.guardians) {
      try {
        emailAddress(g.email);
      } catch {
        throw new DomainError(
          `En förälders mejladress för ${child.name} är ogiltig i SportAdmin. Rätta den där och synka igen.`,
          409,
        );
      }
      if (
        g.phone &&
        (g.phone.length > 40 || !/^[+\d\s().-]+$/.test(g.phone) || phone(g.phone).length < 5)
      )
        throw new DomainError(
          `En förälders telefonnummer för ${child.name} behöver rättas i SportAdmin.`,
          409,
        );
      if (!g.email) missingEmail++;
      const related = next.adults.filter((a) => a.familyIds.includes(child.familyId));
      const matches = related.filter((a) => sameContact(a, g));
      const named = related.filter((a) => normal(a.name) === normal(g.name));
      let adult =
        matches.find((a) => normal(a.name) === normal(g.name)) ||
        (named.length === 1 ? named[0] : undefined) ||
        (matches.length === 1 && !desired.has(matches[0].id) ? matches[0] : undefined);
      if (!adult) {
        const prefix = `sa-adult:${roster.clubId}:${player.id}:${g.position}`;
        let id = prefix,
          suffix = 1;
        while (next.adults.some((a) => a.id === id)) id = `${prefix}:${suffix++}`;
        adult = {
          id,
          name: g.name,
          phone: g.phone,
          email: g.email,
          familyIds: [child.familyId],
          active: true,
          source: 'sportadmin',
        };
        next.adults.push(adult);
      }
      // Conflicting guardian information across siblings must not oscillate each sync.
      if (
        desired.has(adult.id) &&
        (normal(adult.name) !== normal(g.name) ||
          phone(adult.phone) !== phone(g.phone) ||
          normal(adult.email || '') !== normal(g.email))
      )
        throw new DomainError(
          `Föräldrakontakter för ${child.name} skiljer sig mellan syskon i SportAdmin. Kontrollera registret.`,
          409,
        );
      Object.assign(adult, {
        name: g.name,
        phone: g.phone,
        email: g.email,
        active: true,
        source: 'sportadmin',
      });
      if (!desired.has(adult.id)) desired.set(adult.id, new Set());
      desired.get(adult.id)!.add(child.familyId);
    }
  }
  for (const adult of next.adults) {
    if (!adult.familyIds.some((id) => managedFamilies.has(id))) continue;
    if (desired.has(adult.id)) {
      adult.familyIds = [
        ...new Set([
          ...adult.familyIds.filter((id) => !managedFamilies.has(id)),
          ...desired.get(adult.id)!,
        ]),
      ];
    } else if (adult.source !== 'manual') {
      // Retain old records and all assignment snapshots for history and review.
      adult.source = 'sportadmin';
      adult.active = adult.familyIds.some((id) => !managedFamilies.has(id));
    }
  }
  for (const family of next.families.filter((f) => managedFamilies.has(f.id))) {
    const children = next.children.filter((c) => c.familyId === family.id);
    family.active = children.some((c) => c.active);
    family.label = children.map((c) => c.name).join(' & ');
  }
  for (const event of next.events)
    if (event.manualParticipantIds)
      event.manualParticipantIds = event.manualParticipantIds.filter((id) =>
        next.children.some((c) => c.id === id && c.source === 'manual'),
      );
  return { state: next, mapping, added: added.length, missingEmail };
}
