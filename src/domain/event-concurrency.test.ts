import { describe, expect, it } from 'vitest';
import { demoState } from './demo';
import { applyCommand } from './logic';
import { EventConflictError, mergeEventEdit, prepareEventCommand } from './event-concurrency';

function fixture() {
  const state = demoState();
  state.events[0].draft.shifts[0].slots[0].status = 'pending';
  delete state.events[0].draft.shifts[0].slots[0].confirmedAt;
  delete state.events[0].draft.shifts[0].slots[0].confirmedRevision;
  const base = structuredClone(state.events[0]);
  return { state, base, current: state.events[0], edited: structuredClone(base) };
}
describe('event edit concurrency', () => {
  it('rebases past unrelated changes and a SportAdmin sync without restoring old attendance', () => {
    const { state, base, current, edited } = fixture();
    state.version++;
    state.events[1].draft.title = 'Another admin';
    current.attendance = {
      title: 'New calling',
      checkedAt: new Date().toISOString(),
      eligibleChildIds: [],
    };
    edited.draft.description = 'My description';
    const command = prepareEventCommand(
      state,
      { type: 'save_event', event: edited, baseEvent: base },
      state.version - 1,
    );
    const saved = applyCommand(state, command, 'admin');
    expect(saved.events[0].draft.description).toBe('My description');
    expect(saved.events[0].attendance).toEqual(current.attendance);
    expect(saved.events[1]).toEqual(state.events[1]);
  });
  it('merges separate fields of the same event', () => {
    const { base, current, edited } = fixture();
    current.draft.description = 'Other admin description';
    edited.draft.title = 'My title';
    expect(mergeEventEdit(base, current, edited).draft).toMatchObject({
      title: 'My title',
      description: 'Other admin description',
    });
  });
  it('retains a new confirmation and the adult chosen by the parent', () => {
    const { state, base, current, edited } = fixture();
    const slot = current.draft.shifts[0].slots[0];
    const adult = state.adults.find((a) => a.familyIds.includes(slot.familyId!))!;
    Object.assign(slot, {
      status: 'confirmed',
      adultId: adult.id,
      adultName: adult.name,
      adultPhone: adult.phone,
      confirmedAt: new Date().toISOString(),
      confirmedRevision: slot.revision,
    });
    edited.draft.description = 'Changed by admin';
    const merged = mergeEventEdit(base, current, edited);
    const saved = applyCommand(state, { type: 'save_event', event: merged }, 'admin');
    expect(saved.events[0].draft.shifts[0].slots[0]).toMatchObject(slot);
  });
  it('reports the conflicting field and leaves both versions untouched', () => {
    const { base, current, edited } = fixture();
    current.draft.title = 'Other name';
    edited.draft.title = 'My name';
    expect(() => mergeEventEdit(base, current, edited)).toThrow(
      /Evenemangets namn.*inte sparade.*Kopiera/,
    );
    expect(edited.draft.title).toBe('My name');
    expect(current.draft.title).toBe('Other name');
  });
  it('does not silently replace a concurrently confirmed assignment', () => {
    const { base, current, edited } = fixture();
    current.draft.shifts[0].slots[0].status = 'confirmed';
    edited.draft.shifts[0].slots[0].familyId = 'different-family';
    expect(() => mergeEventEdit(base, current, edited)).toThrow(/Bemanningen eller bekräftelsen/);
  });
  it('can merge changes to separate places', () => {
    const { base, current, edited } = fixture();
    const other = structuredClone(base.draft.shifts[0].slots[0]);
    other.id = 'other-place';
    for (const e of [base, current, edited]) e.draft.shifts[0].slots.push(structuredClone(other));
    current.draft.shifts[0].slots[0].status = 'confirmed';
    edited.draft.shifts[0].slots.at(-1)!.familyId = 'other-family';
    const result = mergeEventEdit(base, current, edited).draft.shifts[0].slots;
    expect(result[0].status).toBe('confirmed');
    expect(result.at(-1)!.familyId).toBe('other-family');
  });
  it('does not delete a shift changed by someone else', () => {
    const { base, current, edited } = fixture();
    current.draft.shifts[0].instructions = 'New instructions';
    edited.draft.shifts.shift();
    expect(() => mergeEventEdit(base, current, edited)).toThrow(EventConflictError);
  });
  it('merges added places and preserves removals of unchanged places', () => {
    const { base, current, edited } = fixture();
    const shift = base.draft.shifts[0];
    current.draft.shifts[0].slots.push({ ...shift.slots[0], id: 'added-current' });
    edited.draft.shifts[0].slots.push({ ...shift.slots[0], id: 'added-local' });
    edited.draft.shifts[0].slots.shift();
    const ids = mergeEventEdit(base, current, edited).draft.shifts[0].slots.map((s) => s.id);
    expect(ids).toContain('added-current');
    expect(ids).toContain('added-local');
    expect(ids).not.toContain(shift.slots[0].id);
  });
  it('compares JSON structurally regardless of object key order', () => {
    const { base, current, edited } = fixture();
    const reverse = (v: any): any =>
      Array.isArray(v)
        ? v.map(reverse)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, x]) => [k, reverse(x)]),
            )
          : v;
    edited.draft.title = 'My title';
    expect(mergeEventEdit(reverse(base), reverse(current), edited).draft.title).toBe('My title');
  });
  it('does not recreate a missing or cancelled event or edit across publication', () => {
    const { base, current, edited } = fixture();
    expect(() => mergeEventEdit(base, undefined, edited)).toThrow(/tagits bort/);
    current.cancelled = true;
    expect(() => mergeEventEdit(base, current, edited)).toThrow(/ställts in/);
    current.cancelled = false;
    current.publication++;
    expect(() => mergeEventEdit(base, current, edited)).toThrow(/publicerats/);
  });
  it('allows a new event after unrelated changes but rejects an id collision', () => {
    const { state, edited } = fixture();
    edited.id = 'brand-new';
    const command = { type: 'save_event' as const, event: edited, baseEvent: null };
    expect(prepareEventCommand(state, command, state.version - 1)).toEqual(command);
    expect(() => mergeEventEdit(null, edited, edited)).toThrow(EventConflictError);
  });
  it('keeps global version protection for old clients and unrelated commands', () => {
    const { state, edited } = fixture();
    expect(() =>
      prepareEventCommand(state, { type: 'save_event', event: edited }, state.version - 1),
    ).toThrow(/uppdaterats/);
    expect(() =>
      prepareEventCommand(state, { type: 'update_team', team: state.team }, state.version - 1),
    ).toThrow(/uppdaterats/);
  });
  it.each(['auto_plan', 'publish_event'] as const)(
    'allows %s past sync but requires review after actual event changes',
    (type) => {
      const { state, base, current } = fixture();
      current.attendance = { title: 'Match', checkedAt: new Date().toISOString() };
      const command = { type, eventId: base.id, baseEvent: base };
      expect(prepareEventCommand(state, command, state.version - 1)).toBe(command);
      current.draft.description = 'Changed';
      expect(() => prepareEventCommand(state, command, state.version - 1)).toThrow(/Granska/);
    },
  );
});
