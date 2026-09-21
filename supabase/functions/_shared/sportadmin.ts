import type { PortalState } from '../../../src/domain/model.ts';
import {
  SportAdmin,
  SportAdminError,
  token,
  type Session,
  type Activity,
  type Membership,
  type Participant,
} from './sportadmin-api.ts';
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
  snapshots?: Record<string, { players: Participant[]; checkedAt: string; error?: string }>;
  lastSyncAt?: string;
  error?: string;
  rosterStatus?: 'leader_required' | 'verification_required';
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
  };
}
export function applyAttendance(state: PortalState, c: Connection): PortalState {
  const next = structuredClone(state);
  for (const event of next.events) {
    const link = c.links?.[event.id];
    if (!link) {
      delete event.attendance;
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
      error: c.error || snapshot?.error,
      eligibleChildIds: next.children
        .filter((child) => child.active && yes.has(c.mapping?.[child.id] || 0))
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
  if (op === 'status')
    return { integration: connectionStatus(await rpc('read', { team_id: state.team.id })) };
  if (
    !['connect', 'select', 'preview', 'map', 'map_exact', 'link', 'sync', 'disconnect'].includes(op)
  )
    throw new HttpError(400, 'Okänd SportAdmin-åtgärd.');
  const lease = await rpc('acquire', { team_id: state.team.id });
  if (!lease)
    throw new HttpError(409, 'SportAdmin uppdateras redan. Vänta en stund och försök igen.');
  const args = { team_id: state.team.id, lease: lease.lease };
  let c: Connection = lease.data;
  let finished = false;
  async function finish() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await load(state.team.slug),
        next = applyAttendance(latest, c);
      const changed = JSON.stringify(next.events) !== JSON.stringify(latest.events);
      if (changed) next.version++;
      try {
        await rpc('finish', {
          ...args,
          data: c,
          ...(changed ? { state: next, expected_version: latest.version } : {}),
        });
        finished = true;
        return { integration: connectionStatus(c), state: next };
      } catch (error) {
        if (!(error instanceof HttpError && error.status === 409) || attempt === 2) throw error;
      }
    }
    throw new HttpError(409, 'Schemat uppdateras. Försök igen.');
  }
  try {
    if (op === 'disconnect') {
      // Keep restrictions in place when disconnected. Explicit unlink is a separate admin choice.
      delete c.session;
      c.error = 'SportAdmin är frånkopplat. Anslut igen eller ta bort evenemangets koppling.';
      return await finish();
    }
    if (op === 'link' && body.activityId === null) {
      if (typeof body.eventId !== 'string' || !state.events.some((e) => e.id === body.eventId))
        throw new HttpError(400, 'Välj ett sparat evenemang.');
      delete c.links?.[body.eventId];
      delete c.snapshots?.[body.eventId];
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
      if (Object.keys(c.links || {}).length)
        throw new HttpError(400, 'Ta bort evenemangens kopplingar innan du byter SportAdmin-lag.');
      const selected = c.profiles?.find(
        (p) =>
          p.clubId === body.clubId && p.groupId === body.groupId && p.memberId === body.memberId,
      );
      if (!selected) throw new HttpError(400, 'Välj ett lag från ditt SportAdmin-konto.');
      c = { session: c.session, profiles: c.profiles, selected };
    }
    if (!c.selected) return await finish();
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
      if (body.memberId === null) delete c.mapping[body.childId];
      else {
        if (!c.players?.some((p) => p.id === body.memberId))
          throw new HttpError(400, 'Välj en hämtad SportAdmin-spelare.');
        if (
          Object.entries(c.mapping).some(
            ([id, member]) => id !== body.childId && member === body.memberId,
          )
        )
          throw new HttpError(400, 'SportAdmin-spelaren är redan kopplad till ett annat barn.');
        c.mapping[body.childId] = body.memberId;
      }
    }
    if (op === 'link') {
      if (
        typeof body.eventId !== 'string' ||
        !state.events.some((e) => e.id === body.eventId && !e.cancelled)
      )
        throw new HttpError(400, 'Välj ett sparat evenemang.');
      if (body.activityId === null) {
        delete c.links[body.eventId];
        delete c.snapshots[body.eventId];
      } else {
        const activity = c.activities?.find((a) => a.id === body.activityId);
        if (!activity) throw new HttpError(400, 'Välj en hämtad SportAdmin-aktivitet.');
        const rows = await api.participants(activity);
        collect(rows);
        c.links[body.eventId] = activity;
        c.snapshots[body.eventId] = { players: rows, checkedAt: new Date().toISOString() };
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
    if (['sync', 'connect', 'select', 'preview', 'link'].includes(op)) delete c.error;
    return await finish();
  } catch (error) {
    if (error instanceof SportAdminError || !(error instanceof HttpError)) {
      c.error = safeError(error);
      return await finish();
    }
    throw error;
  } finally {
    if (!finished) await rpc('release', args).catch(() => {});
  }
}
