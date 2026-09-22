import { applyCommand, attendanceEligible, DomainError } from '../../../src/domain/logic.ts';
import type {
  InventoryIdentityPair,
  InventoryMatch,
  PortalState,
} from '../../../src/domain/model.ts';
import {
  SportAdmin,
  SportAdminError,
  token,
  type Session,
  type Activity,
  type Membership,
  type Participant,
  type Roster,
} from './sportadmin-api.ts';
import { reconcileInventory } from './sportadmin-inventory.ts';
import { HttpError } from './security.ts';
type Rpc = (op: string, args?: Record<string, unknown>) => Promise<any>;
interface Connection {
  session?: Session;
  profiles?: Membership[];
  selected?: Membership;
  activities?: Activity[];
  players?: Participant[];
  mapping?: Record<string, number>;
  links?: Record<string, Activity>;
  unlinkedEvents?: string[];
  snapshots?: Record<string, { players: Participant[]; checkedAt: string; error?: string }>;
  lastSyncAt?: string;
  error?: string;
  rosterStatus?: 'leader_required' | 'verification_required' | 'ready' | 'error';
  inventoryEnabled?: boolean;
  roster?: Roster;
  rosterError?: string;
  inventoryConflicts?: InventoryMatch[];
  distinctPeople?: InventoryIdentityPair[];
}
const safeError = (error: unknown) =>
  error instanceof SportAdminError
    ? error.message
    : 'SportAdmin kunde inte uppdateras. Försök igen.';
export function connectionStatus(c: Connection | null) {
  return {
    connected: !!c?.session,
    selected: c?.selected,
    profiles: c?.profiles || [],
    activities: c?.activities || [],
    players: c?.players || [],
    mapping: c?.mapping || {},
    links: Object.fromEntries(Object.entries(c?.links || {}).map(([id, a]) => [id, a.id])),
    lastSyncAt: c?.lastSyncAt,
    error: c?.error,
    rosterStatus: c?.rosterStatus,
    inventoryEnabled: !!c?.inventoryEnabled,
    rosterError: c?.rosterError,
    inventoryConflicts: c?.inventoryConflicts || [],
    inventory: c?.roster
      ? {
          checkedAt: c.roster.checkedAt,
          groupName: c.roster.groupName,
          active: c.roster.players.filter((p) => p.active).length,
          departed: c.roster.players.filter((p) => !p.active).length,
          missingEmail: c.roster.players.flatMap((p) => p.guardians).filter((g) => !g.email).length,
        }
      : undefined,
  };
}
export function applyAttendance(state: PortalState, c: Connection): PortalState {
  const next = structuredClone(state);
  for (const event of next.events) {
    const link = c.links?.[event.id];
    if (!link) {
      if (c.unlinkedEvents?.includes(event.id)) delete event.attendance;
      else if (event.attendance)
        event.attendance.error = 'Kopplingen behöver återställas. Välj SportAdmin-aktivitet igen.';
      continue;
    }
    const snapshot = c.snapshots?.[event.id];
    const yes = new Set(
      snapshot?.players
        .filter((p) => p.answer === 'yes' && !p.hasQuit && !p.removed)
        .map((p) => p.id),
    );
    event.attendance = {
      title: link.title,
      checkedAt: snapshot?.checkedAt || '',
      error: c.error || c.rosterError || snapshot?.error,
      eligibleChildIds: next.children
        .filter(
          (child) =>
            child.active && child.source !== 'manual' && yes.has(c.mapping?.[child.id] || 0),
        )
        .map((child) => child.id),
    };
  }
  return next;
}
export async function sportadminAction(
  body: Record<string, any>,
  state: PortalState,
  rpc: Rpc,
  load: (slug: string) => Promise<PortalState>,
) {
  const op = body.operation;
  const savingEvent = op === 'save_event';
  const resolvingIdentity = op === 'resolve_inventory_match';
  if (
    resolvingIdentity &&
    (!Number.isInteger(body.expectedVersion) || body.expectedVersion !== state.version)
  )
    throw new HttpError(409, 'Spelarlistan har ändrats. Uppdatera och granska matchningen igen.');
  if (
    savingEvent &&
    (!Number.isInteger(body.expectedVersion) || body.expectedVersion !== state.version)
  )
    throw new HttpError(409, 'Schemat har ändrats. Öppna evenemanget igen.');
  const eventId = savingEvent ? body.event?.id : body.eventId;
  if (
    savingEvent &&
    (typeof eventId !== 'string' ||
      eventId.length > 160 ||
      !/^[\w][\w.:@/-]*$/.test(eventId) ||
      ['__proto__', 'constructor', 'prototype'].includes(eventId))
  )
    throw new HttpError(400, 'Ogiltigt evenemang.');
  if (op === 'status')
    return { integration: connectionStatus(await rpc('read', { team_id: state.team.id })) };
  if (
    ![
      'connect',
      'select',
      'preview',
      'map',
      'map_exact',
      'link',
      'sync',
      'disconnect',
      'save_event',
      'inventory_sync',
      'resolve_inventory_match',
    ].includes(op)
  )
    throw new HttpError(400, 'Okänd SportAdmin-åtgärd.');
  const lease = await rpc('acquire', { team_id: state.team.id });
  if (!lease)
    throw new HttpError(409, 'SportAdmin uppdateras redan. Vänta en stund och försök igen.');
  const args = { team_id: state.team.id, lease: lease.lease };
  let c: Connection = lease.data;
  let finished = false;
  let inventoryUpdated = false;
  async function finish() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await load(state.team.slug);
      if (savingEvent && latest.version !== body.expectedVersion)
        throw new HttpError(409, 'Schemat har ändrats. Öppna evenemanget igen.');
      if (resolvingIdentity && latest.version !== body.expectedVersion)
        throw new HttpError(
          409,
          'Spelarlistan har ändrats. Uppdatera och granska matchningen igen.',
        );
      let next = structuredClone(latest);
      if (inventoryUpdated && c.roster) {
        if (resolvingIdentity) {
          const current = reconcileInventory(next, c.roster, c.mapping || {}, [], c.distinctPeople);
          if (
            !current.conflicts.some(
              (m) => m.childId === body.childId && m.memberId === body.memberId,
            )
          )
            throw new HttpError(409, 'Matchningen gäller inte längre. Uppdatera spelarlistan.');
          if (body.resolution === 'sync') c.mapping![body.childId] = body.memberId;
          else
            c.distinctPeople = [
              ...(c.distinctPeople || []),
              { childId: body.childId, memberId: body.memberId },
            ];
        }
        const result = reconcileInventory(
          next,
          c.roster,
          c.mapping || {},
          op === 'inventory_sync' && Array.isArray(body.manualChildIds) ? body.manualChildIds : [],
          c.distinctPeople,
        );
        next = result.state;
        c.mapping = result.mapping;
        c.inventoryConflicts = result.conflicts;
        if (resolvingIdentity || JSON.stringify(next) !== JSON.stringify(latest))
          next.audit.push({
            id: `audit:${latest.version + 1}`,
            at: c.roster.checkedAt,
            actor: 'admin',
            action: 'sportadmin_inventory',
            summary: resolvingIdentity
              ? `Spelarmatchning granskad: ${latest.children.find((p) => p.id === body.childId)?.name}. ${body.resolution === 'sync' ? 'Ändrad till synkad. Befintlig familj, historik och pass behölls.' : 'Inte samma person. Den manuella spelaren behölls separat.'}`
              : `Spelarinventeringen uppdaterades från ${c.roster.groupName}. ${result.added} nya spelare. Historiken behölls.`,
          });
      }
      next = applyAttendance(next, c);
      if (savingEvent) {
        next = applyAttendance(
          applyCommand(next, { type: 'save_event', event: body.event }, 'admin'),
          c,
        );
        const savedEvent = next.events.find((e) => e.id === eventId)!;
        const previous = latest.events.find((e) => e.id === eventId);
        for (const shift of savedEvent.draft.shifts)
          for (const slot of shift.slots) {
            const prior = previous?.draft.shifts
              .flatMap((s) => s.slots)
              .find((s) => s.id === slot.id);
            if (
              slot.familyId &&
              slot.familyId !== prior?.familyId &&
              !attendanceEligible(next, savedEvent, slot.familyId)
            )
              throw new HttpError(
                409,
                'Familjen har inget aktivt barn med ett aktuellt ja-svar i SportAdmin. Spara kopplingen innan du tilldelar nya pass.',
              );
          }
      }
      const changed = savingEvent || JSON.stringify(next) !== JSON.stringify(latest);
      if (changed) next.version = latest.version + 1;
      try {
        await rpc('finish', {
          ...args,
          data: c,
          ...(changed ? { state: next, expected_version: latest.version } : {}),
        });
        finished = true;
        return { integration: connectionStatus(c), state: next };
      } catch (error) {
        if (
          savingEvent ||
          resolvingIdentity ||
          !(error instanceof HttpError && error.status === 409) ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new HttpError(409, 'Schemat uppdateras. Försök igen.');
  }
  try {
    if (
      resolvingIdentity &&
      (!c.inventoryEnabled ||
        !['sync', 'different'].includes(body.resolution) ||
        typeof body.childId !== 'string' ||
        !Number.isSafeInteger(body.memberId))
    )
      throw new HttpError(
        400,
        'Välj Ändra till synkad eller Inte samma person för en aktuell matchning.',
      );
    if (
      body.manualChildIds !== undefined &&
      (op !== 'inventory_sync' ||
        c.inventoryEnabled ||
        !Array.isArray(body.manualChildIds) ||
        body.manualChildIds.length > 1000 ||
        body.manualChildIds.some((id: unknown) => typeof id !== 'string'))
    )
      throw new HttpError(
        400,
        'Undantag för befintliga manuella spelare kan bara anges vid första inventeringen.',
      );
    if (op === 'disconnect') {
      // Keep restrictions in place when disconnected. Explicit unlink is a separate admin choice.
      delete c.session;
      c.error = 'SportAdmin är frånkopplat. Anslut igen eller ta bort evenemangets koppling.';
      return await finish();
    }
    if ((op === 'link' || savingEvent) && body.activityId === null) {
      if (
        !savingEvent &&
        (typeof eventId !== 'string' || !state.events.some((e) => e.id === eventId))
      )
        throw new HttpError(400, 'Välj ett sparat evenemang.');
      delete c.links?.[eventId];
      delete c.snapshots?.[eventId];
      c.unlinkedEvents = [...new Set([...(c.unlinkedEvents || []), eventId])];
      return await finish();
    }
    if (op === 'connect') {
      if (
        typeof body.email !== 'string' ||
        body.email.length > 254 ||
        typeof body.password !== 'string' ||
        !body.password ||
        body.password.length > 1024
      )
        throw new HttpError(400, 'Fyll i inloggningen till SportAdmin.');
      const session = await token({
        grant_type: 'password',
        username: body.email,
        password: body.password,
        scope: 'profile offline_access email Sa.App.API',
        resource: 'Sa.App.API',
      });
      // Store each rotated refresh token immediately while holding the per-team lease.
      c.session = session;
      await rpc('save', { ...args, data: c });
      const profiles = await new SportAdmin(session).profiles();
      c.profiles = profiles;
      if (
        c.selected &&
        !profiles.some(
          (p) =>
            p.clubId === c.selected!.clubId &&
            p.groupId === c.selected!.groupId &&
            p.memberId === c.selected!.memberId,
        )
      )
        throw new SportAdminError(
          'access',
          'Detta konto saknar åtkomst till det anslutna laget. Anslut rätt konto.',
        );
      if (!c.selected) {
        const normal = (s: string) => s.toLocaleLowerCase('sv').replace(/[^\p{L}\p{N}]/gu, '');
        const matches = profiles.filter((p) => normal(p.clubName) === normal(state.team.clubName));
        if (matches.length === 1) c.selected = matches[0];
      }
    }
    if (!c.session) throw new HttpError(400, 'Anslut SportAdmin först.');
    if (c.session.expires_at < Date.now() + 120_000) {
      c.session = await token({
        grant_type: 'refresh_token',
        refresh_token: c.session.refresh_token,
      });
      await rpc('save', { ...args, data: c });
    }
    if (op === 'select') {
      if (
        Object.keys(c.links || {}).length ||
        state.children.some((p) => p.source === 'sportadmin')
      )
        throw new HttpError(
          400,
          'Laget används av kopplade evenemang eller Spelarinventeringen och kan inte bytas här.',
        );
      const selected = c.profiles?.find(
        (p) =>
          p.clubId === body.clubId && p.groupId === body.groupId && p.memberId === body.memberId,
      );
      if (!selected) throw new HttpError(400, 'Välj ett lag från ditt SportAdmin-konto.');
      c = { session: c.session, profiles: c.profiles, selected };
    }
    if (!c.selected) {
      if (savingEvent)
        throw new HttpError(400, 'Välj lag under SportAdmin innan du kopplar evenemanget.');
      return await finish();
    }
    const api = new SportAdmin(c.session!, [c.selected]);
    c.mapping ||= {};
    c.links ||= {};
    c.snapshots ||= {};
    if (['connect', 'select', 'sync'].includes(op) || !c.activities)
      c.activities = await api.activities();
    if (['connect', 'select', 'sync'].includes(op)) {
      try {
        c.rosterStatus = (await api.leaderClubs()).includes(c.selected.clubId)
          ? 'verification_required'
          : 'leader_required';
      } catch {
        c.rosterStatus = 'leader_required';
      }
    }
    if (op === 'inventory_sync' || (c.inventoryEnabled && ['connect', 'sync'].includes(op))) {
      try {
        const roster = await api.roster();
        c.players = roster.players.map((p) => ({
          id: p.id,
          name: p.name,
          birthYear: '',
          answer: 'unknown',
          hasQuit: !p.active,
          removed: false,
        }));
        // Validate reconciliation before replacing the last good snapshot.
        reconcileInventory(
          state,
          roster,
          c.mapping,
          op === 'inventory_sync' && Array.isArray(body.manualChildIds) ? body.manualChildIds : [],
          c.distinctPeople,
        );
        c.roster = roster;
        c.inventoryEnabled = true;
        c.rosterStatus = 'ready';
        delete c.rosterError;
        inventoryUpdated = true;
      } catch (error) {
        c.rosterStatus = 'error';
        c.rosterError = error instanceof DomainError ? error.message : safeError(error);
      }
    }
    const collect = (rows: Participant[]) => {
      const byId = new Map((c.players || []).map((p) => [p.id, p]));
      rows.forEach((p) => byId.set(p.id, p));
      c.players = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    };
    if (op === 'preview') {
      const activity = c.activities?.find((a) => a.id === body.activityId);
      if (!activity) throw new HttpError(400, 'Uppdatera och välj en aktivitet i listan.');
      collect(await api.participants(activity));
    }
    if (op === 'map_exact') {
      if (c.inventoryEnabled)
        throw new HttpError(
          400,
          'Använd Spelarinventeringen för att koppla spelare till registret.',
        );
      const normal = (s: string) =>
        s.toLocaleLowerCase('sv').normalize('NFC').trim().replace(/\s+/g, ' ');
      for (const child of state.children.filter((child) => child.active && !c.mapping![child.id])) {
        const matches = (c.players || []).filter((p) => normal(p.name) === normal(child.name));
        if (
          matches.length === 1 &&
          state.children.filter((x) => normal(x.name) === normal(child.name)).length === 1 &&
          !Object.values(c.mapping).includes(matches[0].id)
        )
          c.mapping[child.id] = matches[0].id;
      }
    }
    if (op === 'map') {
      if (
        typeof body.childId !== 'string' ||
        !state.children.some((child) => child.id === body.childId)
      )
        throw new HttpError(400, 'Välj en spelare i Passlaget.');
      if (
        c.inventoryEnabled &&
        state.children.find((child) => child.id === body.childId)?.source === 'sportadmin'
      )
        throw new HttpError(400, 'Synkade spelare hanteras i SportAdmin.');
      if (body.memberId === null) {
        if (c.inventoryEnabled && c.mapping[body.childId])
          throw new HttpError(
            400,
            'Spelaren synkas från SportAdmins register och kan inte kopplas från här.',
          );
        delete c.mapping[body.childId];
      } else {
        if (!c.players?.some((p) => p.id === body.memberId))
          throw new HttpError(400, 'Välj en hämtad SportAdmin-spelare.');
        if (
          Object.entries(c.mapping).some(
            ([id, member]) => id !== body.childId && member === body.memberId,
          )
        )
          throw new HttpError(400, 'SportAdmin-spelaren är redan kopplad till ett annat barn.');
        if (c.inventoryEnabled) {
          const roster = await api.roster();
          if (!roster.players.some((p) => p.id === body.memberId))
            throw new HttpError(400, 'Spelaren finns inte i det anslutna lagets spelarregister.');
          c.roster = roster;
        }
        c.mapping[body.childId] = body.memberId;
      }
      if (c.inventoryEnabled) {
        inventoryUpdated = true;
        c.rosterStatus = 'ready';
        delete c.rosterError;
      }
    }
    if (resolvingIdentity) {
      c.roster = await api.roster();
      inventoryUpdated = true;
      c.rosterStatus = 'ready';
      delete c.rosterError;
    }
    if (op === 'link' || savingEvent) {
      if (
        !savingEvent &&
        (typeof body.eventId !== 'string' ||
          !state.events.some((e) => e.id === eventId && !e.cancelled))
      )
        throw new HttpError(400, 'Välj ett sparat evenemang.');
      if (body.activityId === null) {
        delete c.links[eventId];
        delete c.snapshots[eventId];
      } else {
        const activity = c.activities?.find((a) => a.id === body.activityId);
        if (!activity) throw new HttpError(400, 'Välj en hämtad SportAdmin-aktivitet.');
        const rows = await api.participants(activity);
        collect(rows);
        c.links[eventId] = activity;
        c.unlinkedEvents = (c.unlinkedEvents || []).filter((id) => id !== eventId);
        c.snapshots[eventId] = { players: rows, checkedAt: new Date().toISOString() };
      }
    }
    if (op === 'sync' || op === 'connect') {
      for (const [eventId, activity] of Object.entries(c.links)) {
        const event = state.events.find((e) => e.id === eventId);
        if (
          !event ||
          event.cancelled ||
          event.draft.endDate < new Date().toISOString().slice(0, 10)
        )
          continue;
        try {
          const rows = await api.participants(activity);
          collect(rows);
          c.snapshots[eventId] = { players: rows, checkedAt: new Date().toISOString() };
        } catch (error) {
          c.snapshots[eventId] = {
            players: c.snapshots[eventId]?.players || [],
            checkedAt: c.snapshots[eventId]?.checkedAt || '',
            error: safeError(error),
          };
        }
      }
      c.lastSyncAt = new Date().toISOString();
    }
    if (
      [
        'sync',
        'connect',
        'select',
        'preview',
        'link',
        'save_event',
        'inventory_sync',
        'resolve_inventory_match',
      ].includes(op)
    )
      delete c.error;
    return await finish();
  } catch (error) {
    if (savingEvent || resolvingIdentity) {
      if (error instanceof HttpError || error instanceof DomainError) throw error;
      throw new HttpError(503, safeError(error));
    }
    if (error instanceof DomainError) throw error;
    if (error instanceof SportAdminError || !(error instanceof HttpError)) {
      c.error = safeError(error);
      return await finish();
    }
    throw error;
  } finally {
    if (!finished) await rpc('release', args).catch(() => {});
  }
}
