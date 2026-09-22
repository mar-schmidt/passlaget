import { afterEach, expect, test, vi } from 'vitest';
import { demoState } from '../../src/domain/demo';
import { sportadminAction } from '../functions/_shared/sportadmin';
import { SportAdmin, SportAdminError } from '../functions/_shared/sportadmin-api';
import { HttpError } from '../functions/_shared/security';
function fixture() {
  let state = demoState();
  const data: any = {
    session: {
      access_token: 'private',
      refresh_token: 'private',
      expires_at: Date.now() + 3600_000,
    },
    selected: { clubId: 1, groupId: 2, memberId: 3 },
    activities: [],
    players: [
      {
        id: 1,
        name: state.children[0].name,
        birthYear: '2018',
        answer: 'yes',
        hasQuit: false,
        removed: false,
      },
    ],
    mapping: {},
    links: {},
    error: 'Disconnected',
  };
  const calls: string[] = [];
  let conflicts = 0;
  const rpc = async (op: string, args: Record<string, any> = {}) => {
    calls.push(op);
    if (op === 'acquire') return { lease: 'lease', data: structuredClone(data) };
    if (op === 'finish') {
      if (conflicts-- > 0) throw new HttpError(409, 'conflict');
      if (args.state) state = args.state;
      return {};
    }
    return null;
  };
  return {
    get state() {
      return state;
    },
    data,
    calls,
    rpc,
    load: async () => structuredClone(state),
    conflict: () => conflicts++,
  };
}
test('mapping cannot duplicate a child association and does not erase sync failure', async () => {
  const f = fixture();
  const first = f.state.children[0];
  const result = await sportadminAction(
    { operation: 'map', childId: first.id, memberId: 1 },
    f.state,
    f.rpc,
    f.load,
  );
  expect(result!.integration.mapping[first.id]).toBe(1);
  expect(result!.integration.error).toBe('Disconnected');
  f.data.mapping[first.id] = 1;
  await expect(
    sportadminAction(
      { operation: 'map', childId: f.state.children[1].id, memberId: 1 },
      f.state,
      f.rpc,
      f.load,
    ),
  ).rejects.toThrow('redan kopplad');
  expect(f.calls.at(-1)).toBe('release');
});
test('unlink works after disconnect and retries optimistic conflicts', async () => {
  const f = fixture();
  delete f.data.session;
  const event = f.state.events[0];
  event.attendance = { title: 'Match', checkedAt: '', eligibleChildIds: [] };
  f.data.links[event.id] = { id: 7 };
  f.conflict();
  const result = await sportadminAction(
    { operation: 'link', eventId: event.id, activityId: null },
    f.state,
    f.rpc,
    f.load,
  );
  expect(result!.state!.events[0].attendance).toBeUndefined();
  expect(f.calls.filter((x) => x === 'finish')).toHaveLength(2);
});

afterEach(() => vi.restoreAllMocks());
const activity = {
  id: 7,
  title: 'Match',
  clubId: 1,
  groupId: 2,
  memberId: 3,
  callingId: 4,
  startsAt: '',
  endsAt: '',
};
function newEvent(state: ReturnType<typeof demoState>) {
  const event = structuredClone(state.events[0]);
  event.id = 'new-match';
  delete event.published;
  event.publication = 0;
  event.draft.title = 'New match';
  event.draft.shifts.forEach((s) => {
    s.id += '-new';
    s.slots = s.slots.map((slot, i) => ({
      id: slot.id + '-new-' + i,
      revision: 1,
      locked: false,
      status: 'pending',
    }));
  });
  return event;
}
test('new event and SportAdmin link commit together with one state version', async () => {
  const f = fixture();
  f.data.activities = [activity];
  const event = newEvent(f.state);
  vi.spyOn(SportAdmin.prototype, 'participants').mockResolvedValue(f.data.players);
  const result = await sportadminAction(
    { operation: 'save_event', event, activityId: 7, expectedVersion: f.state.version },
    f.state,
    f.rpc,
    f.load,
  );
  expect(result!.integration.links[event.id]).toBe(7);
  expect(result!.state!.events.find((e) => e.id === event.id)?.attendance?.title).toBe('Match');
  expect(f.calls.filter((x) => x === 'finish')).toHaveLength(1);
});
test('API failure does not save the event or change the existing link', async () => {
  const f = fixture();
  f.data.activities = [activity];
  const before = structuredClone(f.state);
  vi.spyOn(SportAdmin.prototype, 'participants').mockRejectedValue(new SportAdminError('upstream'));
  await expect(
    sportadminAction(
      {
        operation: 'save_event',
        event: newEvent(f.state),
        activityId: 7,
        expectedVersion: f.state.version,
      },
      f.state,
      f.rpc,
      f.load,
    ),
  ).rejects.toThrow('SportAdmin');
  expect(f.state).toEqual(before);
  expect(f.calls).not.toContain('finish');
  expect(f.calls.at(-1)).toBe('release');
});
test('new ineligible assignments are rejected even when creating the event with its link', async () => {
  const f = fixture();
  f.data.activities = [activity];
  const event = newEvent(f.state);
  event.draft.shifts[0].slots[0].familyId = f.state.children[0].familyId;
  vi.spyOn(SportAdmin.prototype, 'participants').mockResolvedValue([]);
  await expect(
    sportadminAction(
      { operation: 'save_event', event, activityId: 7, expectedVersion: f.state.version },
      f.state,
      f.rpc,
      f.load,
    ),
  ).rejects.toThrow('ja-svar');
  expect(f.calls).not.toContain('finish');
});
test('removing a link and saving draft changes works while disconnected', async () => {
  const f = fixture();
  delete f.data.session;
  const event = structuredClone(f.state.events[0]);
  event.draft.title = 'Ändrat namn';
  f.state.events[0].attendance = { title: 'Match', checkedAt: '', eligibleChildIds: [] };
  const result = await sportadminAction(
    { operation: 'save_event', event, activityId: null, expectedVersion: f.state.version },
    f.state,
    f.rpc,
    f.load,
  );
  expect(result!.state!.events[0].draft.title).toBe('Ändrat namn');
  expect(result!.state!.events[0].attendance).toBeUndefined();
});
test('concurrent draft changes reject the combined save instead of rebasing stale input', async () => {
  const f = fixture();
  f.conflict();
  await expect(
    sportadminAction(
      {
        operation: 'save_event',
        event: newEvent(f.state),
        activityId: null,
        expectedVersion: f.state.version,
      },
      f.state,
      f.rpc,
      f.load,
    ),
  ).rejects.toThrow('conflict');
  expect(f.calls.filter((x) => x === 'finish')).toHaveLength(1);
});

test('inventory and private mapping commit atomically; manual selection survives optimistic retry', async () => {
  const f = fixture();
  f.state.children.forEach((c) => {
    c.source = 'manual';
  });
  const child = f.state.children[0];
  delete child.source;
  f.data.mapping[child.id] = 1;
  vi.spyOn(SportAdmin.prototype, 'roster').mockResolvedValue({
    clubId: 1,
    groupId: 2,
    groupName: 'P2018',
    checkedAt: new Date().toISOString(),
    players: [{ id: 1, name: 'Updated Player', active: false, guardians: [] }],
  });
  f.conflict();
  const result = await sportadminAction({ operation: 'inventory_sync' }, f.state, f.rpc, f.load);
  expect(result!.integration.inventoryEnabled).toBe(true);
  expect(result!.integration.inventory?.departed).toBe(1);
  expect(result!.state.children[0]).toMatchObject({
    name: 'Updated Player',
    active: false,
    source: 'sportadmin',
  });
  expect(result!.state.children[2].source).toBe('manual');
  expect(f.calls.filter((c) => c === 'finish')).toHaveLength(2);
});
test('failed complete roster or contact read preserves all players and contacts and reports the error', async () => {
  const f = fixture();
  const before = structuredClone(f.state);
  vi.spyOn(SportAdmin.prototype, 'roster').mockRejectedValue(new SportAdminError('upstream'));
  const result = await sportadminAction({ operation: 'inventory_sync' }, f.state, f.rpc, f.load);
  expect(result!.integration.rosterStatus).toBe('error');
  expect(result!.integration.inventoryEnabled).toBe(false);
  expect(result!.state.children).toEqual(before.children);
  expect(result!.state.adults).toEqual(before.adults);
  expect(result!.state.history).toEqual(before.history);
});
test('event and first manual participant can be saved together with an empty calling list', async () => {
  const f = fixture();
  const child = f.state.children[0];
  child.source = 'manual';
  f.data.activities = [activity];
  vi.spyOn(SportAdmin.prototype, 'participants').mockResolvedValue([]);
  const event = newEvent(f.state);
  event.manualParticipantIds = [child.id];
  event.draft.shifts[0].slots[0].familyId = child.familyId;
  const result = await sportadminAction(
    { operation: 'save_event', event, activityId: 7, expectedVersion: f.state.version },
    f.state,
    f.rpc,
    f.load,
  );
  expect(
    result!.state.events.find((e) => e.id === event.id)?.draft.shifts[0].slots[0].familyId,
  ).toBe(child.familyId);
});
