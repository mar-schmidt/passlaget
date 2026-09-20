import { describe, expect, it } from 'vitest';
import { demoState } from '../../src/domain/demo';
import { applyCommand, publicState } from '../../src/domain/logic';
import { buildContactMailJobs, validContactMailEntries } from '../functions/_shared/contact-mail';
import type { PortalCommand, PortalState } from '../../src/domain/model';
const now = '2026-09-20T12:00:00Z';
function fixture() {
  const s = demoState();
  s.events = s.events.slice(0, 1);
  s.history = [];
  s.requests = [];
  const event = s.events[0];
  event.id = 'e';
  delete event.published;
  event.draft.shifts = event.draft.shifts.slice(0, 1);
  event.draft.shifts[0].slots = [
    { id: 'slot', familyId: 'family-1', locked: false, status: 'pending', revision: 0 },
  ];
  s.adults
    .filter((a) => a.familyIds.includes('family-1'))
    .forEach((a, i) => {
      a.email = `parent${i}@example.test`;
    });
  return applyCommand(s, { type: 'publish_event', eventId: 'e' }, 'admin', now);
}
function confirmation(s: PortalState): Extract<PortalCommand, { type: 'confirm' }> {
  const a = s.adults.find((a) => a.familyIds.includes('family-1'))!;
  return {
    type: 'confirm',
    eventId: 'e',
    slotId: 'slot',
    familyId: 'family-1',
    revision: 1,
    adultId: a.id,
    adultName: a.name,
    adultPhone: a.phone,
    adultEmail: ' Updated@Example.test ',
  };
}
const remind: Extract<PortalCommand, { type: 'remind_confirmation' }> = {
  type: 'remind_confirmation',
  eventId: 'e',
  slotId: 'slot',
  familyId: 'family-1',
  revision: 1,
};
const publish: PortalCommand = { type: 'publish_event', eventId: 'e' };

describe('adult email and confirmation reminders', () => {
  it('requires one valid email even when the selected contact already has an address', () => {
    const s = fixture();
    for (const email of [
      '',
      'bad',
      'first@example.test,second@example.test',
      'first@example.test;second',
      'Name <first@example.test>',
      'x@example.test\r\nBcc:x@example.test',
    ])
      expect(() =>
        applyCommand(s, { ...confirmation(s), adultEmail: email }, 'public', now),
      ).toThrow(/Mejladress|mejladress/);
  });
  it('saves normalized contact email privately and supports changing it after confirmation', () => {
    const s = fixture(),
      command = confirmation(s);
    const confirmed = applyCommand(s, command, 'public', now);
    expect(confirmed.adults.find((a) => a.id === command.adultId)!.email).toBe(
      'updated@example.test',
    );
    expect(JSON.stringify(publicState(confirmed))).not.toContain('@');
    expect(applyCommand(confirmed, command, 'public', now)).toEqual(confirmed);
    const changed = applyCommand(
      confirmed,
      { ...command, adultEmail: 'new@example.test' },
      'public',
      now,
    );
    expect(changed.adults.find((a) => a.id === command.adultId)!.email).toBe('new@example.test');
  });
  it('remembers a newly named adult and does not duplicate that person on retry', () => {
    const s = fixture(),
      command = {
        ...confirmation(s),
        adultId: undefined,
        adultName: 'Test Person',
        adultPhone: '0700000099',
      };
    const confirmed = applyCommand(s, command, 'public', now);
    const slot = confirmed.events[0].published!.shifts[0].slots[0];
    expect(confirmed.adults.find((a) => a.id === slot.adultId)).toMatchObject({
      name: 'Test Person',
      email: 'updated@example.test',
      familyIds: ['family-1'],
    });
    expect(applyCommand(confirmed, command, 'public', now)).toEqual(confirmed);
  });
  it('preserves a saved email when reimporting an older roster without email fields', () => {
    const s = fixture();
    const adult = { ...s.adults[0] };
    delete adult.email;
    const next = applyCommand(
      s,
      { type: 'import_data', families: [], children: [], adults: [adult], history: [] },
      'admin',
      now,
    );
    expect(next.adults[0].email).toBe(s.adults[0].email);
  });
  it('restricts reminders to admins and pending future published assignments with an email', () => {
    const s = fixture();
    expect(() => applyCommand(s, remind, 'public', now)).toThrow('administratör');
    const confirmed = applyCommand(s, confirmation(s), 'public', now);
    expect(() => applyCommand(confirmed, remind, 'admin', now)).toThrow('redan bekräftat');
    expect(() => applyCommand(s, { ...remind, revision: 99 }, 'admin', now)).toThrow('ändrats');
    s.adults.forEach((a) => delete a.email);
    expect(() => applyCommand(s, remind, 'admin', now)).toThrow('Mejladress saknas');
    s.adults[0].email = 'test@example.test';
    expect(() => applyCommand(s, remind, 'admin', '2027-01-01T00:00:00Z')).toThrow('redan börjat');
  });
  it('has a cooldown without changing the assignment revision or requiring new confirmation', () => {
    const s = fixture(),
      next = applyCommand(s, remind, 'admin', now);
    expect(next.events[0].published!.shifts[0].slots[0].revision).toBe(1);
    expect(() => applyCommand(next, remind, 'admin', now)).toThrow('tio minuter');
    expect(applyCommand(next, remind, 'admin', '2026-09-20T12:11:00Z').version).toBe(
      next.version + 1,
    );
  });
  it('notifies family contacts on publication and only the assigned adult when one is selected', async () => {
    const after = fixture(),
      before = { ...after, events: [] };
    const contacts = after.adults.filter((a) => a.familyIds.includes('family-1') && a.email);
    expect(
      (await buildContactMailJobs(before, after, publish, now)).filter(
        (j) => j.kind === 'assignment',
      ),
    ).toHaveLength(contacts.length);
    const slot = after.events[0].published!.shifts[0].slots[0];
    slot.adultId = contacts[0].id;
    const jobs = await buildContactMailJobs(before, after, publish, now);
    expect(jobs.filter((j) => j.kind === 'assignment').map((j) => j.recipient)).toEqual([
      contacts[0].email,
    ]);
    expect(jobs.every((j) => j.subscriptionId === undefined)).toBe(true);
  });
  it('deduplicates a shared family mailbox, including when the second adult is specifically assigned', async () => {
    const after = fixture();
    const adults = after.adults.filter((a) => a.familyIds.includes('family-1'));
    adults.forEach((a) => (a.email = 'shared@example.test'));
    const before = { ...after, events: [] };
    expect(
      (await buildContactMailJobs(before, after, publish, now)).filter(
        (j) => j.kind === 'assignment',
      ),
    ).toHaveLength(1);
    after.events[0].published!.shifts[0].slots[0].adultId = adults.at(-1)!.id;
    expect(
      (await buildContactMailJobs(before, after, publish, now)).filter(
        (j) => j.kind === 'assignment',
      ),
    ).toHaveLength(1);
  });
  it('confirmation schedules reminders but does not send an immediate assignment notice', async () => {
    const before = fixture(),
      command = confirmation(before),
      after = applyCommand(before, command, 'public', now);
    const jobs = await buildContactMailJobs(before, after, command, now);
    expect(jobs.some((j) => j.kind === 'reminder' && j.recipient === 'updated@example.test')).toBe(
      true,
    );
    expect(jobs.every((j) => j.kind === 'reminder')).toBe(true);
  });
  it('queues only the requested missing confirmation and suppresses it after a response, reassignment or contact change', async () => {
    const before = fixture(),
      after = applyCommand(before, remind, 'admin', now);
    const job = (await buildContactMailJobs(before, after, remind, now)).find(
      (j) => j.payload.confirmationOnly,
    )!;
    expect(job.payload.entries.map((e) => e.slotId)).toEqual(['slot']);
    expect(
      await validContactMailEntries(job.kind, job.payload, after, job.recipient!, now),
    ).toHaveLength(1);
    const confirmed = applyCommand(after, confirmation(after), 'public', now);
    expect(
      await validContactMailEntries(job.kind, job.payload, confirmed, job.recipient!, now),
    ).toHaveLength(0);
    const moved = structuredClone(after);
    moved.events[0].published!.shifts[0].slots[0].familyId = 'family-2';
    expect(
      await validContactMailEntries(job.kind, job.payload, moved, job.recipient!, now),
    ).toHaveLength(0);
    after.adults.forEach((a) => {
      if (a.email === job.recipient) a.email = 'replacement@example.test';
    });
    expect(
      await validContactMailEntries(job.kind, job.payload, after, job.recipient!, now),
    ).toHaveLength(0);
  });
  it('does not send drafts, completed duties or imported history as new assignments', async () => {
    const after = fixture(),
      before = structuredClone(after);
    after.events[0].draft.title = 'A private draft';
    expect(
      (await buildContactMailJobs(before, after, publish, now)).every((j) => j.kind === 'reminder'),
    ).toBe(true);
    after.events[0].published!.shifts[0].slots[0].status = 'completed';
    expect(await buildContactMailJobs({ ...before, events: [] }, after, publish, now)).toHaveLength(
      0,
    );
  });
});
