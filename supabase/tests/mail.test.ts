import { describe, expect, it } from 'vitest';
import type { PortalState } from '../../src/domain/model.ts';
import {
  buildMailJobs,
  validMailEntries,
  entries,
  renderMail,
  type Subscription,
} from '../functions/_shared/mail';

const now = '2026-09-20T10:00:00.000Z';
const state = (): PortalState => ({
  version: 1,
  team: {
    id: 't',
    slug: 'test',
    name: 'Testlag',
    clubName: 'Test',
    contactName: 'Test',
    contactPhone: '',
    reminderDays: [7, 1],
  },
  families: [
    { id: 'f', label: 'Familj', active: true, exempt: false },
    { id: 'other', label: 'Annan', active: true, exempt: false },
  ],
  children: [],
  adults: [],
  roles: [],
  history: [],
  requests: [],
  audit: [],
  events: [
    {
      id: 'e',
      publication: 1,
      cancelled: false,
      updatedAt: now,
      draft: {
        title: 'Cup',
        location: 'IP',
        startDate: '2026-10-10',
        endDate: '2026-10-10',
        description: '',
        shifts: [],
      },
      published: {
        title: 'Cup',
        location: 'IP',
        startDate: '2026-10-10',
        endDate: '2026-10-10',
        description: '',
        shifts: [
          {
            id: 's',
            roleId: 'r',
            roleName: 'P-värd',
            instructions: 'Visa parkeringen.',
            startsAt: '2026-10-10T09:00:00.000Z',
            endsAt: '2026-10-10T11:00:00.000Z',
            slots: [{ id: 'slot', familyId: 'f', locked: false, revision: 1, status: 'pending' }],
          },
        ],
      },
    },
  ],
});
const subscription: Subscription = {
  id: 'sub',
  team_id: 't',
  family_id: 'f',
  adult_id: null,
  scope: 'family',
  email: 'fake@example.test',
  status: 'active',
};

describe('mail queue planning', () => {
  it('schedules automatic reminders only for pending duties in a mixed family schedule', async () => {
    const after = state();
    after.events[0].published!.shifts[0].slots.push({
      id: 'confirmed-slot',
      familyId: 'f',
      locked: false,
      revision: 1,
      status: 'confirmed',
      confirmedRevision: 1,
    });
    const jobs = await buildMailJobs({ ...after, events: [] }, after, [subscription], now);
    const reminders = jobs.filter((job) => job.kind === 'reminder');
    expect(reminders).toHaveLength(2);
    expect(reminders.map((job) => job.dueAt)).toEqual([
      '2026-10-03T09:00:00.000Z',
      '2026-10-09T09:00:00.000Z',
    ]);
    expect(reminders.every((job) => job.payload.entries[0].slotId === 'slot')).toBe(true);
    expect(jobs.find((job) => job.kind === 'assignment')!.payload.entries).toHaveLength(2);
  });
  it('suppresses an already queued automatic reminder after confirmation without changing its recipient or revision', async () => {
    const pending = state();
    const job = (await buildMailJobs(pending, pending, [subscription], now))[0];
    expect(validMailEntries(job.kind, job.payload, pending, subscription, now)).toHaveLength(1);
    const confirmed = structuredClone(pending);
    confirmed.events[0].published!.shifts[0].slots[0].status = 'confirmed';
    confirmed.events[0].published!.shifts[0].slots[0].confirmedRevision = 1;
    expect(validMailEntries(job.kind, job.payload, confirmed, subscription, now)).toHaveLength(0);
    expect(await buildMailJobs(pending, confirmed, [subscription], now)).toHaveLength(0);
    expect(validMailEntries('assignment', job.payload, confirmed, subscription, now)).toHaveLength(
      1,
    );
  });
  it('resumes automatic reminders when a changed duty requires a new confirmation', async () => {
    const before = state();
    before.events[0].published!.shifts[0].slots[0].status = 'confirmed';
    before.events[0].published!.shifts[0].slots[0].confirmedRevision = 1;
    const after = structuredClone(before);
    after.version++;
    const shift = after.events[0].published!.shifts[0];
    shift.startsAt = '2026-10-10T10:00:00.000Z';
    shift.slots[0].status = 'pending';
    shift.slots[0].revision = 2;
    delete shift.slots[0].confirmedRevision;
    const jobs = await buildMailJobs(before, after, [subscription], now);
    expect(jobs.filter((job) => job.kind === 'reminder')).toHaveLength(2);
    expect(jobs.filter((job) => job.kind === 'changed')).toHaveLength(1);
    for (const job of jobs) {
      expect(validMailEntries(job.kind, job.payload, after, subscription, now)).toHaveLength(1);
    }
  });
  it('never mails draft changes; reminder dedupe remains stable across unrelated edits', async () => {
    const before = state(),
      after = structuredClone(before);
    after.version++;
    after.events[0].draft.title = 'Hemligt utkast';
    const a = await buildMailJobs(before, after, [subscription], now),
      b = await buildMailJobs(before, before, [subscription], now);
    expect(a.every((x) => x.kind === 'reminder')).toBe(true);
    expect(a.map((x) => x.dedupeKey)).toEqual(b.map((x) => x.dedupeKey));
  });
  it('aggregates two newly published family slots into one notification but does not duplicate twin family ownership', async () => {
    const before = state(),
      after = state();
    before.events = [];
    after.version++;
    after.events[0].published!.shifts[0].slots.push({
      id: 'slot2',
      familyId: 'f',
      locked: false,
      revision: 1,
      status: 'pending',
    });
    const jobs = await buildMailJobs(before, after, [subscription], now);
    expect(jobs.filter((x) => x.kind === 'assignment')).toHaveLength(1);
    expect(jobs.find((x) => x.kind === 'assignment')!.payload.entries).toHaveLength(2);
  });
  it('requires a named adult for adult-scoped mail', async () => {
    const before = state();
    before.events = [];
    expect(
      await buildMailJobs(
        before,
        state(),
        [{ ...subscription, scope: 'adult', adult_id: 'a' }],
        now,
      ),
    ).toHaveLength(0);
  });
  it('stops stale reminders after family reassignment and sends former family a cancellation', async () => {
    const before = state(),
      after = state();
    after.version++;
    after.events[0].published!.shifts[0].slots[0].familyId = 'other';
    after.events[0].published!.shifts[0].slots[0].revision++;
    const jobs = await buildMailJobs(before, after, [subscription], now);
    expect(jobs.map((x) => x.kind)).toEqual(['cancelled']);
    expect(
      validMailEntries('reminder', { entries: entries(before) }, after, subscription, now),
    ).toHaveLength(0);
    expect(validMailEntries('cancelled', jobs[0].payload, after, subscription, now)).toHaveLength(
      1,
    );
  });
  it('sends a removal notice even if the former family is inactive and the shift has just started', async () => {
    const before = state(),
      after = state();
    after.version++;
    after.events[0].published!.shifts = [];
    after.families[0].active = false;
    const during = '2026-10-10T09:30:00.000Z';
    const jobs = await buildMailJobs(before, after, [subscription], during);
    expect(jobs.map((x) => x.kind)).toEqual(['cancelled']);
    expect(
      validMailEntries('cancelled', jobs[0].payload, after, subscription, during),
    ).toHaveLength(1);
    const message = renderMail(
      'Inställt\r\nTest',
      jobs[0].payload.entries,
      'cancelled',
      'https://example.test/',
      'https://example.test/?unsubscribe=x',
    );
    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.text).toContain('Du ska inte bemanna');
    expect(message.text).not.toContain('Välj vem som kommer');
  });
  it('notifies a changed assignment during an ongoing pass but does not create missed reminders', async () => {
    const before = state(),
      after = state();
    after.version++;
    after.events[0].published!.location = 'Annan plats';
    after.events[0].published!.shifts[0].slots[0].revision++;
    const during = '2026-10-10T09:30:00.000Z';
    const jobs = await buildMailJobs(before, after, [subscription], during);
    expect(jobs.map((x) => x.kind)).toEqual(['changed']);
    expect(validMailEntries('changed', jobs[0].payload, after, subscription, during)).toHaveLength(
      1,
    );
  });
  it('does not treat completing a pass as cancellation', async () => {
    const before = state(),
      after = state();
    after.events[0].published!.shifts[0].slots[0].status = 'completed';
    expect(await buildMailJobs(before, after, [subscription], now)).toHaveLength(0);
  });
  it('suppresses opt-out, outdated revisions and passed shifts at send time', () => {
    const original = state(),
      updated = state();
    updated.events[0].published!.shifts[0].slots[0].revision = 2;
    expect(
      validMailEntries(
        'reminder',
        { entries: entries(original) },
        original,
        { ...subscription, status: 'unsubscribed' },
        now,
      ),
    ).toHaveLength(0);
    expect(
      validMailEntries('reminder', { entries: entries(original) }, updated, subscription, now),
    ).toHaveLength(0);
    expect(
      validMailEntries(
        'reminder',
        { entries: entries(original) },
        original,
        subscription,
        '2026-10-11T00:00:00.000Z',
      ),
    ).toHaveLength(0);
  });
  it('never creates a reminder whose planned send time is already past', async () => {
    const jobs = await buildMailJobs(state(), state(), [subscription], '2026-10-09T12:00:00.000Z');
    expect(jobs).toHaveLength(0);
  });
  it('compares reminder due times by instant when now uses a UTC offset', async () => {
    const utc = await buildMailJobs(state(), state(), [subscription], '2026-10-03T08:00:00.000Z');
    const offset = await buildMailJobs(
      state(),
      state(),
      [subscription],
      '2026-10-03T10:00:00+02:00',
    );
    expect(offset).toEqual(utc);
    expect(offset.map((job) => job.dueAt)).toContain('2026-10-03T09:00:00.000Z');
  });
  it('suppresses ended offset shifts and reminders exactly when an offset shift starts', async () => {
    const original = state();
    original.events[0].published!.shifts[0].startsAt = '2026-10-10T11:00:00+02:00';
    original.events[0].published!.shifts[0].endsAt = '2026-10-10T13:00:00+02:00';
    const before = state();
    before.events = [];
    expect(
      await buildMailJobs(before, original, [subscription], '2026-10-10T11:00:00.000Z'),
    ).toHaveLength(0);
    const removed = structuredClone(original);
    removed.events = [];
    expect(
      await buildMailJobs(original, removed, [subscription], '2026-10-10T11:00:00.000Z'),
    ).toHaveLength(0);
    const payload = { entries: entries(original) };
    expect(
      validMailEntries('reminder', payload, original, subscription, '2026-10-10T09:00:00.000Z'),
    ).toHaveLength(0);
    expect(
      validMailEntries('assignment', payload, original, subscription, '2026-10-10T09:00:00.000Z'),
    ).toHaveLength(1);
    expect(
      validMailEntries('assignment', payload, original, subscription, '2026-10-10T11:00:00.000Z'),
    ).toHaveLength(0);
  });
});
