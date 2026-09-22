import { expect, test } from 'vitest';
import { demoState } from '../../src/domain/demo';
import {
  applyCommand,
  attendanceEligible,
  attendanceWarnings,
  autoPlan,
  publicState,
} from '../../src/domain/logic';
import { reconcileInventory } from '../functions/_shared/sportadmin-inventory';
import type { Roster } from '../functions/_shared/sportadmin-api';
const guardian = {
  position: 1,
  name: 'Nora Bergström',
  phone: '0701234567',
  email: 'nora@example.test',
};
const roster = (players: Roster['players']): Roster => ({
  clubId: 1,
  groupId: 2,
  groupName: 'P2018',
  checkedAt: '2026-09-22T10:00:00Z',
  players,
});
function fixture() {
  const s = demoState();
  s.children.forEach((c) => {
    c.source = 'manual';
  });
  delete s.children[0].source;
  delete s.children[1].source;
  return s;
}
test('roster owns names, active status and contacts while retaining family IDs, twins, history and assignments', () => {
  const s = fixture();
  const first = s.children[0],
    twin = s.children[1],
    family = s.families[0];
  family.exempt = true;
  const r = roster([
    { id: 7, name: 'Mina Nyttnamn', active: true, guardians: [guardian] },
    { id: 8, name: twin.name, active: false, guardians: [] },
  ]);
  const updated = reconcileInventory(s, r, { [first.id]: 7, [twin.id]: 8 });
  expect(updated.state.children[0]).toMatchObject({
    id: first.id,
    familyId: family.id,
    name: 'Mina Nyttnamn',
    source: 'sportadmin',
    active: true,
  });
  expect(updated.state.children[1].active).toBe(false);
  expect(updated.state.families[0]).toMatchObject({ active: true, exempt: true });
  expect(updated.state.adults[0]).toMatchObject({
    id: s.adults[0].id,
    source: 'sportadmin',
    phone: guardian.phone,
    email: guardian.email,
  });
  expect(updated.state.adults[1].active).toBe(false);
  expect(updated.state.children[2]).toEqual(s.children[2]);
  expect(updated.state.history).toEqual(s.history);
  expect(updated.state.events).toEqual(s.events);
  expect(reconcileInventory(updated.state, r, updated.mapping).state).toEqual(updated.state);
});
test('missing synced player is departed, manual player and contacts survive; empty roster rejected', () => {
  const s = fixture();
  const before = structuredClone(s);
  const r = roster([{ id: 8, name: s.children[1].name, active: true, guardians: [guardian] }]);
  const next = reconcileInventory(s, r, { [s.children[0].id]: 7, [s.children[1].id]: 8 }).state;
  expect(next.children[0].active).toBe(false);
  expect(next.children[2]).toEqual(s.children[2]);
  expect(next.adults.filter((a) => a.familyIds.includes(s.children[2].familyId))).toEqual(
    s.adults.filter((a) => a.familyIds.includes(s.children[2].familyId)),
  );
  expect(() => reconcileInventory(s, roster([]), {})).toThrow('ofullständigt');
  expect(s).toEqual(before);
});
test('new siblings share one family and parents; parents sharing an inbox remain separate adults', () => {
  const s = fixture();
  s.children.forEach((c) => {
    c.source = 'manual';
  });
  const guardians = [
    { ...guardian, name: 'Test Ett', phone: '0701112233' },
    { ...guardian, position: 2, name: 'Test Två', phone: '0702223344' },
  ];
  const r = roster([10, 11].map((id) => ({ id, name: `Testbarn ${id}`, active: true, guardians })));
  const next = reconcileInventory(s, r, {}).state;
  const children = next.children.filter((c) => c.source === 'sportadmin');
  expect(children).toHaveLength(2);
  expect(children[0].familyId).toBe(children[1].familyId);
  expect(
    next.adults.filter((a) => a.familyIds.includes(children[0].familyId) && a.active),
  ).toHaveLength(2);
});
test('manual player who later appears in SportAdmin requires identity confirmation without creating a duplicate', () => {
  const s = fixture(),
    child = s.children[2];
  const r = roster([{ id: 99, name: child.name, active: true, guardians: [] }]);
  expect(() => reconcileInventory(s, r, {})).toThrow('Koppla den manuella spelaren');
  const linked = reconcileInventory(s, r, { [child.id]: 99 });
  expect(linked.state.children.filter((c) => c.name === child.name)).toHaveLength(1);
  expect(linked.state.children.find((c) => c.id === child.id)?.source).toBe('sportadmin');
});
test('ordinary edits and imports cannot overwrite synced names, contacts, source or reactivate a departed child', () => {
  const s = fixture();
  s.children[0].source = 'sportadmin';
  s.children[0].active = false;
  s.adults[0].source = 'sportadmin';
  s.adults[0].email = guardian.email;
  const children = [{ ...s.children[0], source: 'manual' as const, name: 'Forged', active: true }];
  const adults = [
    { ...s.adults[0], source: 'manual' as const, name: 'Forged', email: 'other@example.test' },
  ];
  for (const command of [
    { type: 'save_family' as const, family: s.families[0], children, adults },
    { type: 'import_data' as const, families: [s.families[0]], children, adults, history: [] },
  ]) {
    const next = applyCommand(s, command, 'admin');
    expect(next.children[0]).toEqual(s.children[0]);
    expect(next.adults[0]).toEqual(s.adults[0]);
  }
});
test('manual participation is event-specific, ignores stale SportAdmin, and respects inactive players', () => {
  const s = fixture(),
    child = s.children[2],
    e = s.events[0];
  e.attendance = { title: 'Match', checkedAt: '', error: 'Offline', eligibleChildIds: [] };
  expect(attendanceEligible(s, e, child.familyId)).toBe(false);
  e.manualParticipantIds = [child.id];
  expect(attendanceEligible(s, e, child.familyId)).toBe(true);
  e.published = structuredClone(e.draft);
  const view = publicState(s);
  expect(view.events[0].manualParticipantIds).toBeUndefined();
  expect(view.events[0].attendance?.eligibleChildIds).toBeUndefined();
  expect(attendanceEligible(view, view.events[0], child.familyId)).toBe(true);
  child.active = false;
  expect(attendanceEligible(s, e, child.familyId)).toBe(false);
  const forged = structuredClone(e);
  forged.manualParticipantIds = [s.children[0].id];
  s.children[0].source = 'sportadmin';
  expect(() => applyCommand(s, { type: 'save_event', event: forged }, 'admin')).toThrow(
    'status manuell',
  );
});
test('departed players cannot receive new assignments even without an event link; old assignments stay with warnings', () => {
  const s = fixture(),
    e = s.events[0],
    family = s.families[0];
  s.children
    .filter((c) => c.familyId === family.id)
    .forEach((c) => {
      c.active = false;
    });
  const draft = structuredClone(e);
  const slot = draft.draft.shifts[0].slots[0];
  delete slot.adultId;
  delete slot.adultName;
  delete slot.adultPhone;
  delete e.draft.shifts[0].slots[0].familyId;
  slot.familyId = family.id;
  expect(() => applyCommand(s, { type: 'save_event', event: draft }, 'admin')).toThrow(
    'inget aktivt barn',
  );
  e.draft.shifts[0].slots[0] = slot;
  expect(attendanceWarnings(s, e)).toContain(family.label);
  const next = applyCommand(s, { type: 'save_event', event: e }, 'admin');
  expect(next.events[0].draft.shifts[0].slots[0].familyId).toBe(family.id);
  expect(
    autoPlan(s, e.id)
      .state.events[0].draft.shifts.flatMap((s) => s.slots)
      .filter(
        (slot) =>
          !e.draft.shifts.flatMap((s) => s.slots).find((old) => old.id === slot.id)?.familyId,
      )
      .some((slot) => slot.familyId === family.id),
  ).toBe(false);
});
test('synced parent confirmation uses SportAdmin contacts and keeps their email out of the public view', () => {
  const s = fixture(),
    e = s.events[0],
    adult = s.adults[0];
  Object.assign(adult, { source: 'sportadmin', phone: guardian.phone, email: guardian.email });
  const slot = e.published!.shifts[0].slots[0];
  Object.assign(slot, { familyId: s.families[0].id, adultId: adult.id, status: 'pending' });
  const next = applyCommand(
    s,
    {
      type: 'confirm',
      eventId: e.id,
      slotId: slot.id,
      revision: slot.revision,
      familyId: slot.familyId!,
      adultId: adult.id,
      adultName: 'Override',
      adultPhone: '',
      adultEmail: 'other@example.test',
    },
    'public',
    '2026-09-22T10:00:00Z',
  );
  expect(next.adults[0].email).toBe(guardian.email);
  expect(next.events[0].published!.shifts[0].slots[0]).toMatchObject({
    adultName: adult.name,
    adultPhone: guardian.phone,
    status: 'confirmed',
  });
  expect(JSON.stringify(publicState(next))).not.toContain(guardian.email);
  expect(publicState(next).adults.find((a) => a.id === adult.id)?.source).toBe('sportadmin');
});
