import { expect, test } from 'vitest';
import { demoState } from '../../src/domain/demo';
import { sportadminAction } from '../functions/_shared/sportadmin';
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
