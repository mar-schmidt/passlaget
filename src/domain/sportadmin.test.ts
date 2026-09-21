import { expect, test } from 'vitest';
import { demoState } from './demo';
import {
  applyCommand,
  attendanceEligible,
  attendanceWarnings,
  autoPlan,
  publicState,
} from './logic';
import { applyAttendance, connectionStatus } from '../../supabase/functions/_shared/sportadmin';
const fixture = () => {
  const s = demoState();
  s.events = [s.events[0]];
  const e = s.events[0];
  delete e.published;
  e.draft.shifts = [e.draft.shifts[0]];
  e.draft.shifts[0].slots = [{ id: 'empty', locked: false, revision: 1, status: 'pending' }];
  s.history = [];
  return s;
};
test('only yes family selected, siblings share eligibility; inactive child cannot qualify', () => {
  const s = fixture(),
    e = s.events[0],
    child = s.children[0];
  e.attendance = {
    title: 'Match',
    checkedAt: new Date().toISOString(),
    eligibleChildIds: [child.id],
  };
  expect(attendanceEligible(s, e, child.familyId)).toBe(true);
  expect(attendanceEligible(s, e, s.families.find((f) => f.id !== child.familyId)!.id)).toBe(false);
  const planned = autoPlan(s, e.id).state.events[0].draft.shifts[0].slots[0];
  expect(planned.familyId).toBe(child.familyId);
  child.active = false;
  expect(attendanceEligible(s, e, child.familyId)).toBe(false);
  s.children.push({ ...child, id: 'twin', active: true });
  e.attendance.eligibleChildIds!.push('twin');
  expect(attendanceEligible(s, e, child.familyId)).toBe(true);
});
test('stale or failed sync closes new assignments; existing pass kept with warning', () => {
  const s = fixture(),
    e = s.events[0],
    child = s.children[0];
  e.attendance = { title: 'Match', checkedAt: new Date().toISOString(), eligibleChildIds: [] };
  const edited = structuredClone(e);
  edited.draft.shifts[0].slots[0].familyId = child.familyId;
  expect(() => applyCommand(s, { type: 'save_event', event: edited }, 'admin')).toThrow('ja-svar');
  e.draft.shifts[0].slots[0].familyId = child.familyId;
  expect(attendanceWarnings(s, e)).toHaveLength(1);
  expect(
    applyCommand(s, { type: 'save_event', event: e }, 'admin').events[0].draft.shifts[0].slots[0]
      .familyId,
  ).toBe(child.familyId);
  e.attendance.eligibleChildIds = [child.id];
  e.attendance.error = 'unavailable';
  expect(attendanceEligible(s, e, child.familyId)).toBe(false);
  delete e.attendance.error;
  e.attendance.checkedAt = new Date(Date.now() - 3 * 3600_000).toISOString();
  expect(attendanceEligible(s, e, child.familyId)).toBe(false);
});
test('public projection omits child mapping and private integration tokens', () => {
  const s = fixture(),
    e = s.events[0];
  e.published = structuredClone(e.draft);
  e.attendance = {
    title: 'Match',
    checkedAt: new Date().toISOString(),
    eligibleChildIds: [s.children[0].id],
  };
  const projected = publicState(s).events[0].attendance!;
  expect(projected.eligibleChildIds).toBeUndefined();
  expect(projected.eligibleFamilyIds).toEqual([s.children[0].familyId]);
  expect(
    JSON.stringify(
      connectionStatus({
        session: { access_token: 'SECRET', refresh_token: 'SECRET', expires_at: 0 },
      }),
    ),
  ).not.toContain('SECRET');
});
test('mapping sync keeps assignments and does not infer departures from missing players', () => {
  const s = fixture(),
    e = s.events[0],
    child = s.children[0];
  e.draft.shifts[0].slots[0].familyId = child.familyId;
  const next = applyAttendance(s, {
    mapping: { [child.id]: 7 },
    links: {
      [e.id]: {
        id: 1,
        callingId: 2,
        clubId: 3,
        groupId: 4,
        memberId: 5,
        title: 'Match',
        startsAt: '',
        endsAt: '',
      },
    },
    snapshots: { [e.id]: { players: [], checkedAt: new Date().toISOString() } },
  });
  expect(next.children).toEqual(s.children);
  expect(next.events[0].draft).toEqual(e.draft);
  expect(next.events[0].attendance?.eligibleChildIds).toEqual([]);
});

test('public booking and publishing cannot bypass changed kallelsesvar', () => {
  const s = fixture(),
    e = s.events[0],
    child = s.children[0];
  e.attendance = { title: 'Match', checkedAt: new Date().toISOString(), eligibleChildIds: [] };
  e.draft.bookingMode = 'self';
  e.draft.shifts[0].startsAt = new Date(Date.now() + 86400_000).toISOString();
  e.draft.shifts[0].endsAt = new Date(Date.now() + 90000_000).toISOString();
  e.published = structuredClone(e.draft);
  expect(() =>
    applyCommand(
      s,
      {
        type: 'book',
        eventId: e.id,
        slotId: 'empty',
        revision: 1,
        familyId: child.familyId,
        adultName: 'Test',
        adultPhone: '0701234567',
        adultEmail: 'test@example.test',
      },
      'public',
    ),
  ).toThrow('anmält i SportAdmin');
  e.draft.shifts[0].slots[0].familyId = child.familyId;
  expect(() => applyCommand(s, { type: 'publish_event', eventId: e.id }, 'admin')).toThrow(
    'aktuellt ja-svar',
  );
});
