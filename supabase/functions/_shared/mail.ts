import type { PortalState } from '../../../src/domain/model.ts';

export interface Subscription {
  id: string;
  team_id: string;
  family_id: string;
  adult_id: string | null;
  scope: 'family' | 'adult';
  email: string;
  status: string;
  verify_hash?: string;
  verify_expires_at?: string;
  contactAdultIds?: string[];
}
export interface MailEntry {
  eventId: string;
  slotId: string;
  revision: number;
  familyId: string;
  adultId?: string;
  adultName?: string;
  title: string;
  role: string;
  location: string;
  instructions: string;
  startsAt: string;
  endsAt: string;
  cancelled: boolean;
  status: string;
}
export interface MailJob {
  subscriptionId?: string;
  recipient?: string;
  kind: 'assignment' | 'changed' | 'cancelled' | 'reminder';
  dedupeKey: string;
  subject: string;
  payload: {
    entries: MailEntry[];
    reminderDays?: number;
    contact?: { familyId: string; adultIds: string[] };
    confirmationOnly?: boolean;
  };
  priority: number;
  dueAt: string;
}
export async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function entries(state: PortalState): MailEntry[] {
  return state.events.flatMap(
    (event) =>
      event.published?.shifts.flatMap((shift) =>
        shift.externalTeam
          ? []
          : shift.slots
              .filter((slot) => slot.familyId)
              .map((slot) => ({
                eventId: event.id,
                slotId: slot.id,
                revision: slot.revision,
                familyId: slot.familyId!,
                adultId: slot.adultId,
                adultName: slot.adultName,
                title: event.published!.title,
                role: shift.roleName,
                location: event.published!.location,
                instructions: shift.instructions,
                startsAt: shift.startsAt,
                endsAt: shift.endsAt,
                cancelled: event.cancelled || slot.status === 'cancelled',
                status: slot.status,
              })),
      ) ?? [],
  );
}
export function matches(subscription: Subscription, entry: MailEntry) {
  return (
    subscription.family_id === entry.familyId &&
    (subscription.contactAdultIds
      ? !entry.adultId || subscription.contactAdultIds.includes(entry.adultId)
      : subscription.scope === 'family' || subscription.adult_id === entry.adultId)
  );
}
const active = (entry: MailEntry) =>
  !entry.cancelled && (entry.status === 'pending' || entry.status === 'confirmed');
const key = (entry: MailEntry) => `${entry.eventId}:${entry.slotId}`;
const fingerprint = (entry: MailEntry) =>
  JSON.stringify([
    entry.revision,
    entry.familyId,
    entry.adultId ?? '',
    entry.adultName ?? '',
    entry.title,
    entry.role,
    entry.location,
    entry.instructions,
    entry.startsAt,
    entry.endsAt,
  ]);
const subjectByKind = {
  assignment: 'Nya bemanningspass',
  changed: 'Ändrad bemanning',
  cancelled: 'Bemanningspass avbokat',
  reminder: 'Påminnelse om bemanning',
};

/** Called on the server from the just-validated state. Queue inserts share its SQL commit. */
export async function buildMailJobs(
  before: PortalState,
  after: PortalState,
  subscriptions: Subscription[],
  now = new Date().toISOString(),
): Promise<MailJob[]> {
  const nowMs = Date.parse(now);
  const old = entries(before),
    current = entries(after),
    oldByKey = new Map(old.map((x) => [key(x), x]));
  const currentByKey = new Map(current.map((x) => [key(x), x]));
  const jobs: MailJob[] = [];
  for (const subscription of subscriptions.filter((x) => x.status === 'active')) {
    const groups: { assignment: MailEntry[]; changed: MailEntry[]; cancelled: MailEntry[] } = {
      assignment: [],
      changed: [],
      cancelled: [],
    };
    for (const entry of current.filter(
      (x) => active(x) && matches(subscription, x) && Date.parse(x.endsAt) > nowMs,
    )) {
      const prior = oldByKey.get(key(entry));
      if (!prior || !active(prior) || !matches(subscription, prior)) groups.assignment.push(entry);
      else if (fingerprint(prior) !== fingerprint(entry)) groups.changed.push(entry);
      for (const days of after.team.reminderDays) {
        const dueMs = Date.parse(entry.startsAt) - days * 86400000;
        if (!(dueMs > nowMs)) continue; // Never manufacture already missed routine reminders.
        const due = new Date(dueMs).toISOString();
        const digest = await hash(fingerprint(entry));
        jobs.push({
          subscriptionId: subscription.id,
          kind: 'reminder',
          dedupeKey: `reminder:${subscription.id}:${entry.eventId}:${entry.slotId}:${digest}:${days}`,
          subject: `Påminnelse: ${entry.role} – ${after.team.name}`,
          payload: { entries: [entry], reminderDays: days },
          priority: 50,
          dueAt: due,
        });
      }
    }
    for (const entry of old.filter(
      (x) => active(x) && matches(subscription, x) && Date.parse(x.endsAt) > nowMs,
    )) {
      const next = currentByKey.get(key(entry));
      if (!next || next.cancelled || !matches(subscription, next)) groups.cancelled.push(entry);
    }
    for (const kind of ['assignment', 'changed', 'cancelled'] as const)
      if (groups[kind].length) {
        const digest = await hash(JSON.stringify(groups[kind].map(fingerprint)));
        jobs.push({
          subscriptionId: subscription.id,
          kind,
          dedupeKey: `${kind}:${subscription.id}:${after.version}:${digest}`,
          subject: `${subjectByKind[kind]} – ${after.team.name}`,
          payload: { entries: groups[kind] },
          priority: kind === 'cancelled' ? 5 : kind === 'changed' ? 8 : 20,
          dueAt: now,
        });
      }
  }
  return jobs;
}

/** Recheck the current published assignment and consent immediately before sending. */
export function validMailEntries(
  kind: string,
  payload: { entries?: MailEntry[] },
  state: PortalState,
  subscription: Subscription,
  now = new Date().toISOString(),
): MailEntry[] {
  const nowMs = Date.parse(now);
  if (subscription.status !== 'active') return [];
  // A deactivated family still needs to learn that a previously assigned pass was removed.
  if (
    kind !== 'cancelled' &&
    !state.families.some((x) => x.id === subscription.family_id && x.active)
  )
    return [];
  const current = new Map(entries(state).map((x) => [key(x), x]));
  return (payload.entries ?? []).filter((entry) => {
    if (
      !matches(subscription, entry) ||
      !(Date.parse(entry.endsAt) > nowMs) ||
      (kind === 'reminder' && !(Date.parse(entry.startsAt) > nowMs))
    )
      return false;
    const next = current.get(key(entry));
    if (kind === 'cancelled') return !next || next.cancelled || !matches(subscription, next);
    return Boolean(
      next &&
      active(next) &&
      matches(subscription, next) &&
      fingerprint(next) === fingerprint(entry),
    );
  });
}
export function renderMail(
  subject: string,
  mailEntries: MailEntry[],
  kind: string,
  portalUrl: string,
  unsubscribeUrl: string,
) {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  });
  const lines = mailEntries.map((entry) =>
    [
      `${entry.role} – ${entry.title}`,
      `${formatter.format(new Date(entry.startsAt))} till ${new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' }).format(new Date(entry.endsAt))}`,
      `Plats: ${entry.location}`,
      kind === 'cancelled'
        ? 'Du ska inte bemanna det här passet längre.'
        : entry.adultName
          ? `Ansvarig vuxen: ${entry.adultName}`
          : 'Välj vem som kommer i portalen.',
      kind === 'cancelled' ? '' : entry.instructions,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  const changeNote =
    kind === 'changed' || kind === 'cancelled'
      ? 'Om du har sparat passet i din kalender behöver du ändra eller ta bort kalenderkopian själv.'
      : '';
  return {
    subject: subject.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 250),
    text: [
      ...lines,
      changeNote,
      `Aktuell information${kind === 'cancelled' ? '' : ' och bekräftelse'}: ${portalUrl}`,
      kind === 'confirmation'
        ? 'Vi saknar din bekräftelse. Öppna Passlaget, välj din familj och bekräfta vem som kommer.'
        : '',
      unsubscribeUrl
        ? `Avsluta mejlpåminnelser: ${unsubscribeUrl}`
        : 'Kontakta lagföräldern om dina kontaktuppgifter behöver ändras.',
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}
