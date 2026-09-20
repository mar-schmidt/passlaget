import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  autoPlan,
  balances,
  DomainError,
  publicState,
  validateEvent,
} from './logic.ts';
import { demoState } from './demo.ts';
import type { HistoryEntry, PortalCommand, PortalState, Shift, Slot } from './model.ts';

const now = '2026-09-20T12:00:00Z';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const blankSlot = (id: string, familyId?: string): Slot => ({
  id,
  familyId,
  locked: false,
  revision: 0,
  status: 'pending',
});
function fixture(): PortalState {
  const state = demoState();
  state.families = state.families.slice(0, 3);
  state.children = state.children.filter((child) =>
    state.families.some((family) => family.id === child.familyId),
  );
  state.adults = state.adults.filter((adult) =>
    adult.familyIds.some((family) => state.families.some((item) => item.id === family)),
  );
  state.history = [];
  state.requests = [];
  state.audit = [];
  const event = state.events[0];
  event.id = 'event';
  event.publication = 0;
  delete event.published;
  event.draft.shifts = [clone(event.draft.shifts[0])];
  event.draft.shifts[0].slots = [blankSlot('slot-1', 'family-1')];
  state.events = [event];
  return state;
}
function published(state = fixture()): PortalState {
  return applyCommand(state, { type: 'publish_event', eventId: 'event' }, 'admin', now);
}
function history(familyId: string, id: string, verified = true): HistoryEntry {
  return {
    id,
    familyId,
    assignmentId: `assignment-${id}`,
    eventTitle: 'Tidigare sammandrag',
    roleName: 'Kiosk',
    startsAt: '2026-04-18T08:00:00+02:00',
    endsAt: '2026-04-18T09:00:00+02:00',
    source: 'import',
    verified,
  };
}
function confirm(
  state: PortalState,
  overrides: Partial<Extract<PortalCommand, { type: 'confirm' }>> = {},
): PortalState {
  return applyCommand(
    state,
    {
      type: 'confirm',
      eventId: 'event',
      slotId: 'slot-1',
      familyId: 'family-1',
      revision: 1,
      adultId: 'adult-1-1',
      adultName: 'Nora Bergström',
      adultPhone: '0700000001',
      ...overrides,
    },
    'public',
    now,
  );
}
function twoShifts(state: PortalState, slots: [Slot, Slot]): void {
  const first = state.events[0].draft.shifts[0];
  first.endsAt = '2026-10-04T09:00:00+02:00';
  first.slots = [slots[0]];
  const second: Shift = {
    ...clone(first),
    id: 'shift-2',
    startsAt: '2026-10-04T09:00:00+02:00',
    endsAt: '2026-10-04T13:00:00+02:00',
    slots: [slots[1]],
  };
  state.events[0].draft.shifts.push(second);
}

describe('fairness and planning', () => {
  it('counts unique places equally regardless of duration and siblings', () => {
    const state = fixture();
    twoShifts(state, [blankSlot('slot-1', 'family-1'), blankSlot('slot-2', 'family-2')]);
    state.history = [history('family-1', 'past'), history('family-2', 'unverified', false)];
    const result = balances(published(state));
    expect(state.children.filter((child) => child.familyId === 'family-1')).toHaveLength(2);
    expect(result.find((item) => item.familyId === 'family-1')).toMatchObject({
      completed: 1,
      reserved: 1,
      total: 2,
    });
    expect(result.find((item) => item.familyId === 'family-2')).toMatchObject({
      completed: 0,
      reserved: 1,
      total: 1,
    });
  });

  it('replaces the target published plan with its draft and ignores other drafts', () => {
    const state = published();
    state.events[0].draft.shifts[0].slots[0].familyId = 'family-2';
    const other = clone(state.events[0]);
    other.id = 'other';
    delete other.published;
    other.draft.shifts[0].slots = [blankSlot('other-slot', 'family-3')];
    state.events.push(other);
    expect(balances(state).find((item) => item.familyId === 'family-1')!.reserved).toBe(1);
    const planned = balances(state, 'event');
    expect(planned.find((item) => item.familyId === 'family-1')!.reserved).toBe(0);
    expect(planned.find((item) => item.familyId === 'family-2')!.reserved).toBe(1);
    expect(planned.find((item) => item.familyId === 'family-3')!.reserved).toBe(0);
  });

  it('uses all history and can choose the same low-balance family for consecutive slots', () => {
    const state = fixture();
    twoShifts(state, [blankSlot('slot-1'), blankSlot('slot-2')]);
    state.history = [
      history('family-1', 'past-1'),
      history('family-1', 'past-2'),
      history('family-1', 'past-3'),
    ];
    state.families[2].exempt = true;
    const before = clone(state);
    const planned = autoPlan(state, 'event');
    expect(planned.state.events[0].draft.shifts.map((shift) => shift.slots[0].familyId)).toEqual([
      'family-2',
      'family-2',
    ]);
    expect(
      balances(planned.state, 'event').find((item) => item.familyId === 'family-2')!.reserved,
    ).toBe(2);
    expect(state).toEqual(before);
  });

  it('respects leader exemptions, availability, active children and existing manual choices', () => {
    const state = fixture();
    twoShifts(state, [blankSlot('slot-1'), { ...blankSlot('slot-2', 'family-3'), locked: true }]);
    state.families[2].exempt = true;
    state.families[0].unavailable = [
      { startsAt: '2026-10-04T07:00:00+02:00', endsAt: '2026-10-04T09:00:00+02:00' },
    ];
    state.children.find((child) => child.familyId === 'family-2')!.active = false;
    const result = autoPlan(state, 'event');
    expect(result.state.events[0].draft.shifts[0].slots[0].familyId).toBeUndefined();
    expect(result.state.events[0].draft.shifts[1].slots[0].familyId).toBe('family-3');
    expect(result.notices.join(' ')).toContain('ingen tillgänglig familj');
  });

  it('never adds confirmation or completed history a second time', () => {
    const original = published();
    const accepted = confirm(original);
    expect(balances(accepted)[0].total).toBe(1);
    const done = applyCommand(
      accepted,
      { type: 'complete_slot', eventId: 'event', slotId: 'slot-1', completed: true },
      'admin',
      '2026-10-05T10:00:00Z',
    );
    expect(balances(done)[0]).toMatchObject({ completed: 1, reserved: 0, total: 1 });
    expect(done.history).toHaveLength(1);
    const again = applyCommand(
      done,
      { type: 'complete_slot', eventId: 'event', slotId: 'slot-1', completed: true },
      'admin',
      '2026-10-05T10:01:00Z',
    );
    expect(again).toBe(done);
    expect(done.events[0].draft.shifts[0].slots[0].status).toBe('completed');
    const absent = applyCommand(
      done,
      { type: 'complete_slot', eventId: 'event', slotId: 'slot-1', completed: false },
      'admin',
      '2026-10-05T10:02:00Z',
    );
    expect(balances(absent)[0].total).toBe(0);
    expect(absent.history).toHaveLength(0);
  });

  it('retains overdue unfinished reservations and blocks future completion', () => {
    const state = published();
    expect(() =>
      applyCommand(
        state,
        { type: 'complete_slot', eventId: 'event', slotId: 'slot-1', completed: true },
        'admin',
        now,
      ),
    ).toThrow('sluttiden');
    state.events[0].published!.shifts[0].startsAt = '2025-10-04T08:00:00+02:00';
    state.events[0].published!.shifts[0].endsAt = '2025-10-04T10:00:00+02:00';
    expect(balances(state)[0].reserved).toBe(1);
  });

  it('records bulk follow-up once and rolls back the whole command if one pass is still in the future', () => {
    const state = fixture();
    twoShifts(state, [blankSlot('slot-1', 'family-1'), blankSlot('slot-2', 'family-2')]);
    const current = published(state),
      before = clone(current);
    const command: PortalCommand = {
      type: 'complete_slots',
      eventId: 'event',
      slotIds: ['slot-1', 'slot-2'],
      completed: true,
    };
    // The first shift is over at 09:00; the second ends at 13:00 local time.
    expect(() => applyCommand(current, command, 'admin', '2026-10-04T08:00:00Z')).toThrow(
      'sluttiden',
    );
    expect(current).toEqual(before);
    const finished = applyCommand(current, command, 'admin', '2026-10-04T12:00:00Z');
    expect(finished.history).toHaveLength(2);
    expect(finished.version).toBe(current.version + 1);
    expect(finished.audit).toHaveLength(current.audit.length + 1);
    expect(finished.audit.at(-1)!.action).toBe('complete_slots');
    expect(
      finished.events[0].draft.shifts.every((shift) => shift.slots[0].status === 'completed'),
    ).toBe(true);
    expect(applyCommand(finished, command, 'admin', '2026-10-04T13:00:00Z')).toBe(finished);
    expect(() =>
      applyCommand(
        current,
        { ...command, slotIds: ['slot-1', 'slot-1'] },
        'admin',
        '2026-10-04T12:00:00Z',
      ),
    ).toThrow('varje plats en gång');
  });
});

describe('untrusted commands and open access', () => {
  it('allows only confirmation and requests for public visitors', () => {
    const state = published();
    expect(() =>
      applyCommand(state, { type: 'cancel_event', eventId: 'event' }, 'public', now),
    ).toThrowError(DomainError);
    try {
      applyCommand(state, { type: 'cancel_event', eventId: 'event' }, 'public', now);
    } catch (error) {
      expect((error as DomainError).code).toBe(403);
    }
    expect(() => applyCommand(state, null as unknown as PortalCommand, 'public', now)).toThrowError(
      DomainError,
    );
    expect(() =>
      applyCommand(
        state,
        { type: 'save_family', family: {}, children: [], adults: [] } as unknown as PortalCommand,
        'admin',
        now,
      ),
    ).toThrowError(DomainError);
  });

  it('rejects stale revisions, wrong families, invalid phones and cross-family adults', () => {
    const state = published();
    expect(() => confirm(state, { revision: 0 })).toThrow('ändrats');
    expect(() => confirm(state, { familyId: 'family-2' })).toThrow('inte tilldelat');
    expect(() => confirm(state, { adultId: 'adult-2-1' })).toThrow('tillhör inte');
    expect(() => confirm(state, { adultPhone: 'not-a-phone' })).toThrow('telefonnummer');
    expect(() => confirm(state, { adultName: 'En annan person' })).toThrow('Namnet stämmer inte');
    expect(
      confirm(state, { adultPhone: '0709999999' }).events[0].published!.shifts[0].slots[0]
        .adultPhone,
    ).toBe('0709999999');
  });

  it('confirms without an account, is idempotent and does not mutate input', () => {
    const state = published(),
      before = clone(state);
    const result = confirm(state);
    expect(state).toEqual(before);
    expect(result.events[0].published!.shifts[0].slots[0]).toMatchObject({
      status: 'confirmed',
      adultId: 'adult-1-1',
      confirmedRevision: 1,
    });
    expect(confirm(result)).toBe(result);
    expect(result.audit.at(-1)).toMatchObject({ actor: 'public' });
  });

  it('projects published schedules but never private drafts, requests or unavailable periods', () => {
    const state = demoState();
    state.events[0].draft.description = 'PRIVATE_DRAFT_MARKER';
    state.requests[0].message = 'PRIVATE_REQUEST_MARKER';
    state.roles.find((role) => role.id === 'kiosk')!.instructions = 'PRIVATE_CHANGED_ROLE_TEMPLATE';
    state.adults.find((adult) => adult.id === 'adult-1-2')!.phone = '0709998888';
    const visible = publicState(state);
    const serialized = JSON.stringify(visible);
    expect(visible.events).toHaveLength(2);
    expect(serialized).not.toContain('PRIVATE_DRAFT_MARKER');
    expect(serialized).not.toContain('PRIVATE_REQUEST_MARKER');
    expect(serialized).not.toContain('PRIVATE_CHANGED_ROLE_TEMPLATE');
    expect(serialized).not.toContain('0709998888');
    expect(visible.roles.some((role) => role.id === 'decorate')).toBe(false);
    expect(visible.adults.find((adult) => adult.id === 'adult-1-2')!.phone).toBe('');
    expect(serialized).not.toContain('unavailable');
    expect(visible).not.toHaveProperty('history');
    expect(visible).not.toHaveProperty('audit');
    expect(visible.events[0].draft).toEqual(visible.events[0].published);
    expect(visible.adults[0].phone).toBeTruthy();
    visible.events[0].draft.title = 'Browser modification';
    expect(state.events[0].published!.title).not.toBe('Browser modification');
  });

  it.each([
    {},
    { type: 42 },
    { type: 'confirm', revision: '1' },
    {
      type: 'save_family',
      family: { id: 'f', label: 'Familj', active: 'yes', exempt: false },
      children: [],
      adults: [],
    },
    { type: 'save_event', event: { id: 'event', draft: null } },
    { type: 'import_data', families: [], children: null, adults: [], history: [] },
    { type: 'update_team', team: { id: 'team', reminderDays: 'seven' } },
    { type: 'complete_slots', eventId: 'event', slotIds: ['slot-1', null], completed: true },
  ])('rejects malformed network payloads with a typed domain error: %j', (payload) => {
    const state = published(),
      before = clone(state);
    expect(() =>
      applyCommand(state, payload as unknown as PortalCommand, 'admin', now),
    ).toThrowError(DomainError);
    expect(state).toEqual(before);
  });

  it('does not let extra public command fields write privileged state', () => {
    const state = published();
    const command = {
      type: 'confirm',
      eventId: 'event',
      slotId: 'slot-1',
      familyId: 'family-1',
      revision: 1,
      adultId: 'adult-1-1',
      adultName: 'Nora Bergström',
      adultPhone: '0700000001',
      team: { name: 'Injected' },
      history: [history('family-1', 'injected')],
      published: true,
      status: 'completed',
    };
    const result = applyCommand(state, command as PortalCommand, 'public', now);
    expect(result.team).toEqual(state.team);
    expect(result.history).toEqual([]);
    expect(result.events[0].published!.shifts[0].slots[0].status).toBe('confirmed');
  });
});

describe('publication, changes and confirmations', () => {
  it('ignores forged published metadata and completed statuses when saving a draft', () => {
    const state = fixture(),
      event = clone(state.events[0]);
    event.publication = 900;
    event.cancelled = true;
    event.published = clone(event.draft);
    event.draft.shifts[0].slots[0].status = 'completed';
    const result = applyCommand(state, { type: 'save_event', event }, 'admin', now);
    expect(result.events[0].publication).toBe(0);
    expect(result.events[0].published).toBeUndefined();
    expect(result.events[0].cancelled).toBe(false);
    expect(result.events[0].draft.shifts[0].slots[0].status).toBe('pending');
  });

  it('keeps a public adult choice in a pre-existing draft but requires reconfirmation for changed time', () => {
    let state = published();
    const event = clone(state.events[0]);
    event.draft.shifts[0].startsAt = '2026-10-04T09:00:00+02:00';
    state = applyCommand(state, { type: 'save_event', event }, 'admin', now);
    state = confirm(state);
    expect(state.events[0].draft.shifts[0].slots[0].adultId).toBe('adult-1-1');
    expect(state.events[0].draft.shifts[0].slots[0].status).toBe('pending');
    state = applyCommand(state, { type: 'publish_event', eventId: 'event' }, 'admin', now);
    expect(state.events[0].published!.shifts[0].slots[0]).toMatchObject({
      revision: 2,
      adultId: 'adult-1-1',
      status: 'pending',
    });
    expect(() => confirm(state)).toThrow('ändrats');
    expect(confirm(state, { revision: 2 }).events[0].published!.shifts[0].slots[0].status).toBe(
      'confirmed',
    );
  });

  it('does not overwrite an administrator’s different adult choice in an unpublished draft', () => {
    let state = published();
    const event = clone(state.events[0]);
    event.draft.shifts[0].slots[0].adultId = 'adult-1-2';
    state = applyCommand(state, { type: 'save_event', event }, 'admin', now);
    state = confirm(state);
    expect(state.events[0].draft.shifts[0].slots[0].adultId).toBe('adult-1-2');
    state = applyCommand(state, { type: 'publish_event', eventId: 'event' }, 'admin', now);
    expect(state.events[0].published!.shifts[0].slots[0]).toMatchObject({
      adultId: 'adult-1-2',
      status: 'pending',
      revision: 2,
    });
  });

  it('preserves confirmations for descriptive corrections and unchanged families', () => {
    let state = confirm(published());
    const event = clone(state.events[0]);
    event.draft.description = 'Rättad allmän information';
    event.draft.shifts[0].roleName = 'Kiosken';
    state = applyCommand(state, { type: 'save_event', event }, 'admin', now);
    state = applyCommand(state, { type: 'publish_event', eventId: 'event' }, 'admin', now);
    expect(state.events[0].published!.shifts[0].slots[0]).toMatchObject({
      status: 'confirmed',
      revision: 1,
      confirmedRevision: 1,
    });
    expect(applyCommand(state, { type: 'publish_event', eventId: 'event' }, 'admin', now)).toBe(
      state,
    );
  });

  it('retains a parent’s pass-specific phone and confirmation through an unrelated title edit', () => {
    let state = confirm(published(), { adultPhone: '0709999999' });
    const event = clone(state.events[0]);
    event.draft.title = 'Uppdaterad rubrik';
    state = applyCommand(state, { type: 'save_event', event }, 'admin', now);
    expect(state.events[0].draft.shifts[0].slots[0].adultPhone).toBe('0709999999');
    state = applyCommand(state, { type: 'publish_event', eventId: 'event' }, 'admin', now);
    expect(state.events[0].published!.shifts[0].slots[0]).toMatchObject({
      adultPhone: '0709999999',
      status: 'confirmed',
      revision: 1,
      confirmedRevision: 1,
    });
    expect(state.adults.find((adult) => adult.id === 'adult-1-1')!.phone).toBe('0700000001');
    const reselected = clone(state.events[0]);
    reselected.draft.shifts[0].slots[0].adultPhone = state.adults[0].phone;
    const saved = applyCommand(state, { type: 'save_event', event: reselected }, 'admin', now);
    expect(saved.events[0].draft.shifts[0].slots[0].adultPhone).toBe('0700000001');
  });

  it('keeps a pending request assigned until an admin publishes its replacement', () => {
    let state = published();
    const request: PortalCommand = {
      type: 'request_change',
      eventId: 'event',
      slotId: 'slot-1',
      revision: 1,
      familyId: 'family-1',
      message: 'Vi behöver en ersättare.',
    };
    state = applyCommand(state, request, 'public', now);
    expect(applyCommand(state, request, 'public', now)).toBe(state);
    expect(balances(state)[0].reserved).toBe(1);
    expect(state.requests[0].status).toBe('open');
    const event = clone(state.events[0]);
    event.draft.shifts[0].slots[0].familyId = 'family-2';
    state = applyCommand(state, { type: 'save_event', event }, 'admin', now);
    expect(state.events[0].published!.shifts[0].slots[0].familyId).toBe('family-1');
    state = applyCommand(state, { type: 'publish_event', eventId: 'event' }, 'admin', now);
    expect(balances(state)[0].reserved).toBe(0);
    expect(balances(state)[1].reserved).toBe(1);
    expect(state.requests[0].status).toBe('resolved');
  });

  it('blocks a previously saved draft from rewriting subsequently completed work', () => {
    let state = published();
    const event = clone(state.events[0]);
    event.draft.shifts[0].slots[0].familyId = 'family-2';
    state = applyCommand(state, { type: 'save_event', event }, 'admin', now);
    state = applyCommand(
      state,
      { type: 'complete_slot', eventId: 'event', slotId: 'slot-1', completed: true },
      'admin',
      '2026-10-05T10:00:00Z',
    );
    expect(() =>
      applyCommand(
        state,
        { type: 'publish_event', eventId: 'event' },
        'admin',
        '2026-10-05T11:00:00Z',
      ),
    ).toThrow('redan genomförts');
    expect(state.history[0].familyId).toBe('family-1');
  });

  it('cancels without deleting completed history and rejects further public responses', () => {
    const state = published();
    state.history.push(history('family-1', 'earlier'));
    const cancelled = applyCommand(state, { type: 'cancel_event', eventId: 'event' }, 'admin', now);
    expect(balances(cancelled)[0]).toMatchObject({ completed: 1, reserved: 0 });
    expect(() => confirm(cancelled)).toThrow('ställts in');
    expect(applyCommand(cancelled, { type: 'cancel_event', eventId: 'event' }, 'admin', now)).toBe(
      cancelled,
    );
  });
});

describe('validation, copying and import', () => {
  it('blocks double-booked families without distinct adults and accepts explicit parallel adults', () => {
    const state = fixture();
    state.events[0].draft.shifts[0].slots.push(blankSlot('slot-2', 'family-1'));
    expect(validateEvent(state, 'event').join(' ')).toContain('Dubbelbokning');
    state.events[0].draft.shifts[0].slots[0].adultId = 'adult-1-1';
    state.events[0].draft.shifts[0].slots[1].adultId = 'adult-1-2';
    expect(validateEvent(state, 'event')).toEqual([]);
    state.events[0].draft.shifts[0].slots[1].adultId = 'adult-1-1';
    expect(validateEvent(state, 'event').join(' ')).toContain('samma vuxen');
  });

  it('recognizes an overlapping adult entered once from the register and once as free text', () => {
    const state = fixture();
    state.adults[0].phone = '0701234567';
    const slots = state.events[0].draft.shifts[0].slots;
    slots[0].adultId = state.adults[0].id;
    slots.push({
      ...blankSlot('slot-2', 'family-2'),
      adultName: state.adults[0].name,
      adultPhone: '+46 70 123 45 67',
    });
    expect(validateEvent(state, 'event').join(' ')).toContain('samma vuxen');
    slots[1].familyId = 'family-1';
    slots[1].adultPhone = '0709999999';
    expect(validateEvent(state, 'event').join(' ')).toContain('samma vuxen');
    slots[1].adultName = 'En annan vuxen';
    expect(validateEvent(state, 'event')).toEqual([]);
  });

  it('permits an empty draft with no roles but prevents publishing it', () => {
    const state = fixture();
    state.roles = [];
    state.events[0].draft.shifts = [];
    const saved = applyCommand(state, { type: 'save_event', event: state.events[0] }, 'admin', now);
    expect(saved.events[0].published).toBeUndefined();
    expect(() =>
      applyCommand(saved, { type: 'publish_event', eventId: 'event' }, 'admin', now),
    ).toThrow('minst ett pass');
  });

  it('bounds hostile event sizes and detects generated copy-ID collisions before saving', () => {
    const state = fixture(),
      event = clone(state.events[0]),
      template = event.draft.shifts[0];
    event.draft.shifts = Array.from({ length: 26 }, (_, shiftIndex) => ({
      ...clone(template),
      id: `shift-${shiftIndex}`,
      slots: Array.from({ length: 40 }, (_, slotIndex) =>
        blankSlot(`slot-${shiftIndex}-${slotIndex}`),
      ),
    }));
    expect(() => applyCommand(state, { type: 'save_event', event }, 'admin', now)).toThrow(
      'högst 1 000',
    );
    state.events[0].draft.shifts[0].slots[0].id = 'copy-slot-1-1';
    const before = clone(state);
    expect(() =>
      applyCommand(
        state,
        { type: 'copy_event', eventId: 'event', newId: 'copy', startDate: '2026-11-01' },
        'admin',
        now,
      ),
    ).toThrow('kolliderar');
    expect(state).toEqual(before);
  });

  it('checks other published events, role references, family ownership and dates', () => {
    const state = published();
    const other = clone(state.events[0]);
    other.id = 'other';
    other.draft.shifts[0].slots[0].id = 'other-slot';
    other.published = clone(other.draft);
    state.events.push(other);
    expect(validateEvent(state, 'event').join(' ')).toContain('Dubbelbokning');
    state.events.pop();
    state.events[0].draft.shifts[0].roleId = 'missing';
    expect(validateEvent(state, 'event').join(' ')).toContain('finns inte i registret');
    state.events[0].draft.shifts[0].slots[0].adultId = 'adult-2-1';
    expect(validateEvent(state, 'event').join(' ')).toContain('tillhör inte');
    state.events[0].draft.shifts[0].startsAt = '2026-02-30T08:00:00+01:00';
    expect(validateEvent(state, 'event').join(' ')).toContain('giltigt datum');
  });

  it('excludes externally staffed slots from own obligations', () => {
    const state = fixture();
    const shift = state.events[0].draft.shifts[0];
    shift.externalTeam = 'Ett annat lag';
    shift.slots = [blankSlot('external-slot')];
    expect(validateEvent(state, 'event')).toEqual([]);
    expect(
      autoPlan(state, 'event').state.events[0].draft.shifts[0].slots[0].familyId,
    ).toBeUndefined();
    shift.slots[0].familyId = 'family-1';
    expect(validateEvent(state, 'event').join(' ')).toContain('annat lags');
  });

  it('copies events with new IDs, no assignments and the same Stockholm clock across DST', () => {
    const state = confirm(published());
    const result = applyCommand(
      state,
      { type: 'copy_event', eventId: 'event', newId: 'copy', startDate: '2026-11-01' },
      'admin',
      now,
    );
    const copied = result.events.find((event) => event.id === 'copy')!;
    expect(copied.published).toBeUndefined();
    expect(copied.draft.shifts[0].startsAt).toBe('2026-11-01T07:00:00.000Z');
    expect(copied.draft.shifts[0].slots[0]).toEqual({
      id: 'copy-slot-1-1',
      revision: 0,
      status: 'pending',
      locked: false,
    });
    expect(validateEvent(result, 'copy')).toEqual([]);
    expect(() =>
      applyCommand(
        state,
        { type: 'copy_event', eventId: 'event', newId: 'x'.repeat(150), startDate: '2026-11-01' },
        'admin',
        now,
      ),
    ).toThrow('för långt');
  });

  it('imports stable IDs idempotently, separates approval and rejects conflicting duplicates', () => {
    const state = fixture();
    const row = history('family-1', 'imported', false);
    const command: PortalCommand = {
      type: 'import_data',
      families: [],
      children: [],
      adults: [],
      history: [row],
    };
    const imported = applyCommand(state, command, 'admin', now);
    expect(balances(imported)[0].completed).toBe(0);
    expect(applyCommand(imported, command, 'admin', now)).toBe(imported);
    const approved = applyCommand(
      imported,
      { ...command, history: [{ ...row, verified: true }] },
      'admin',
      now,
    );
    expect(balances(approved)[0].completed).toBe(1);
    expect(applyCommand(approved, command, 'admin', now)).toBe(approved);
    expect(() =>
      applyCommand(approved, { ...command, history: [{ ...row, id: 'duplicate' }] }, 'admin', now),
    ).toThrow('kolliderar');
    expect(() =>
      applyCommand(
        approved,
        { ...command, history: [{ ...row, familyId: 'family-2' }] },
        'admin',
        now,
      ),
    ).toThrow('motstridiga');
    expect(() =>
      applyCommand(approved, { ...command, history: [{ ...row, source: 'portal' }] }, 'admin', now),
    ).toThrow('källa import');
  });

  it('keeps historic credits when a family leaves and never replaces omitted people', () => {
    const state = fixture();
    state.history = [history('family-1', 'past')];
    const family = { ...state.families[0], active: false };
    const result = applyCommand(
      state,
      { type: 'save_family', family, children: [], adults: [] },
      'admin',
      now,
    );
    expect(balances(result)[0].completed).toBe(1);
    expect(result.children).toHaveLength(state.children.length);
    expect(validateEvent(result, 'event').join(' ')).toContain('inte aktiv');
  });

  it('lets admins undo imported-history approval explicitly without reimport restoring it', () => {
    const state = fixture(),
      row = history('family-1', 'reviewed', false);
    const importCommand: PortalCommand = {
      type: 'import_data',
      families: [],
      children: [],
      adults: [],
      history: [row],
    };
    const imported = applyCommand(state, importCommand, 'admin', now);
    const review: PortalCommand = { type: 'review_history', historyId: row.id, verified: true };
    expect(() => applyCommand(imported, review, 'public', now)).toThrow('administratörsinloggning');
    const approved = applyCommand(imported, review, 'admin', now);
    expect(balances(approved)[0].completed).toBe(1);
    expect(applyCommand(approved, review, 'admin', now)).toBe(approved);
    const undone = applyCommand(approved, { ...review, verified: false }, 'admin', now);
    expect(balances(undone)[0].completed).toBe(0);
    expect(undone.version).toBe(approved.version + 1);
    expect(undone.audit.at(-1)).toMatchObject({ action: 'review_history', actor: 'admin' });
    expect(undone.audit.at(-1)!.summary).toContain('återtogs');
    expect(applyCommand(undone, importCommand, 'admin', now)).toBe(undone);
  });

  it('rejects review of portal outcomes and approval of future imported history', () => {
    const state = fixture();
    state.history = [
      { ...history('family-1', 'portal'), source: 'portal' },
      {
        ...history('family-1', 'future', false),
        startsAt: '2027-01-01T08:00:00Z',
        endsAt: '2027-01-01T09:00:00Z',
      },
    ];
    expect(() =>
      applyCommand(
        state,
        { type: 'review_history', historyId: 'portal', verified: false },
        'admin',
        now,
      ),
    ).toThrow('uppföljning');
    expect(() =>
      applyCommand(
        state,
        { type: 'review_history', historyId: 'future', verified: true },
        'admin',
        now,
      ),
    ).toThrow('Framtida pass');
    expect(state.history[1].verified).toBe(false);
  });
});
