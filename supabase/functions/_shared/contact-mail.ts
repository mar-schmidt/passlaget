import type { PortalCommand, PortalState } from '../../../src/domain/model.ts';
import { emailAddress } from '../../../src/domain/logic.ts';
import {
  buildMailJobs,
  entries,
  hash,
  matches,
  validMailEntries,
  type MailJob,
  type Subscription,
} from './mail.ts';

// One recipient per family/address, even when two adults share an inbox.
async function contacts(state: PortalState): Promise<Subscription[]> {
  const groups = new Map<string, Subscription>();
  for (const adult of state.adults.filter((a) => a.active && a.email)) {
    const email = emailAddress(adult.email);
    for (const familyId of adult.familyIds) {
      if (!state.families.some((f) => f.id === familyId)) continue;
      const identity = JSON.stringify([familyId, email]);
      let recipient = groups.get(identity);
      if (!recipient) {
        recipient = {
          id: `contact:${await hash(identity)}`,
          team_id: state.team.id,
          family_id: familyId,
          adult_id: null,
          scope: 'family',
          email,
          status: 'active',
          contactAdultIds: [],
        };
        groups.set(identity, recipient);
      }
      recipient.contactAdultIds!.push(adult.id);
    }
  }
  return [...groups.values()];
}
function direct(job: MailJob, recipient: Subscription): MailJob {
  return {
    ...job,
    subscriptionId: undefined,
    recipient: recipient.email,
    payload: {
      ...job.payload,
      contact: { familyId: recipient.family_id, adultIds: recipient.contactAdultIds! },
    },
  };
}
export async function buildContactMailJobs(
  before: PortalState,
  after: PortalState,
  command: PortalCommand,
  now = new Date().toISOString(),
): Promise<MailJob[]> {
  const recipients = await contacts(after);
  const old = await contacts(before);
  const result: MailJob[] = [];
  for (const recipient of recipients) {
    // Confirmation saves the address without an immediate assignment email.
    // Only other, still-pending duties may retain future reminders.
    const basis =
      command.type === 'confirm'
        ? after
        : old.some((s) => s.id === recipient.id)
          ? before
          : { ...before, events: [] };
    result.push(
      ...(await buildMailJobs(basis, after, [recipient], now)).map((job) => direct(job, recipient)),
    );
    if (command.type === 'remind_confirmation') {
      const entry = entries(after).find(
        (e) => e.eventId === command.eventId && e.slotId === command.slotId,
      );
      if (
        entry &&
        entry.status === 'pending' &&
        !entry.cancelled &&
        matches(recipient, entry) &&
        Date.parse(entry.startsAt) > Date.parse(now)
      )
        result.push(
          direct(
            {
              kind: 'reminder',
              dedupeKey: `confirmation:${recipient.id}:${entry.eventId}:${entry.slotId}:${after.version}`,
              subject: `Bekräfta ditt pass: ${entry.role} – ${after.team.name}`,
              payload: { entries: [entry], confirmationOnly: true },
              priority: 10,
              dueAt: now,
            },
            recipient,
          ),
        );
    }
  }
  return result;
}
export async function validContactMailEntries(
  kind: string,
  payload: MailJob['payload'],
  state: PortalState,
  email: string,
  now = new Date().toISOString(),
) {
  const recipient = (await contacts(state)).find(
    (s) => s.email === email && s.family_id === payload.contact?.familyId,
  );
  if (
    !recipient ||
    !payload.contact?.adultIds.some((id) => recipient.contactAdultIds!.includes(id))
  )
    return [];
  const valid = validMailEntries(kind, payload, state, recipient, now);
  if (!payload.confirmationOnly) return valid;
  const current = entries(state);
  return valid.filter((entry) =>
    current.some(
      (e) => e.eventId === entry.eventId && e.slotId === entry.slotId && e.status === 'pending',
    ),
  );
}
