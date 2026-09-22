import { DomainError } from './logic.ts';
import type { EventDetails, PortalCommand, PortalEvent, PortalState, Shift } from './model.ts';

export const staleDataMessage =
  'Uppgifterna har uppdaterats sedan sidan öppnades. Åtgärden sparades inte. Hämta senaste uppgifterna och försök igen.';
export const eventBusyMessage =
  'Evenemanget uppdateras samtidigt som du sparar. Dina ändringar finns kvar i formuläret men är inte sparade. Vänta en stund och tryck på Spara utkast igen.';

export class EventConflictError extends DomainError {
  constructor(detail: string, draftSaved = false) {
    super(
      draftSaved
        ? `${detail} Utkastet är sparat, men nästa steg avbröts. Stäng planeringen och hämta senaste uppgifterna innan du öppnar den igen.`
        : `${detail} Dina ändringar finns kvar i formuläret men är inte sparade. Kopiera det du vill behålla, stäng planeringen och hämta senaste uppgifterna innan du öppnar den igen.`,
      409,
    );
  }
}

// JSON object key order can differ between the browser and Postgres jsonb.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
function same(a: unknown, b: unknown) {
  return stable(a) === stable(b);
}
function conflict(label: string): never {
  throw new EventConflictError(`${label} har ändrats av någon annan sedan du öppnade planeringen.`);
}
function mergeValue<T>(base: T, current: T, edited: T, label: string): T {
  if (same(edited, base) || same(edited, current)) return structuredClone(current);
  if (same(current, base)) return structuredClone(edited);
  return conflict(label);
}

function mergeItems<T extends { id: string }>(
  base: T[],
  current: T[],
  edited: T[],
  label: string,
  mergeItem?: (base: T, current: T, edited: T) => T,
): T[] {
  const index = (items: T[]) => {
    if (!Array.isArray(items) || items.some((i) => !i || typeof i.id !== 'string'))
      throw new DomainError('Evenemangets pass har fel format.');
    const map = new Map(items.map((i) => [i.id, i]));
    if (map.size !== items.length) throw new DomainError('Evenemanget innehåller dubbla pass-id.');
    return map;
  };
  const b = index(base),
    c = index(current),
    e = index(edited);
  const result = new Map<string, T>();
  for (const id of new Set([...b.keys(), ...c.keys(), ...e.keys()])) {
    const before = b.get(id),
      now = c.get(id),
      after = e.get(id);
    const item =
      before && now && after && mergeItem
        ? mergeItem(before, now, after)
        : mergeValue(before, now, after, label);
    if (item) result.set(id, item);
  }
  // Preserve either side's reordering; simultaneous, incompatible reorders conflict.
  const common = new Set(base.filter((i) => c.has(i.id) && e.has(i.id)).map((i) => i.id));
  const order = (items: T[]) => items.filter((i) => common.has(i.id)).map((i) => i.id);
  const localOrderChanged = !same(order(base), order(edited));
  mergeValue(order(base), order(current), order(edited), label);
  const preferred = localOrderChanged ? edited : current;
  const other = localOrderChanged ? current : edited;
  return [...new Set([...preferred, ...other].map((i) => i.id))]
    .filter((id) => result.has(id))
    .map((id) => result.get(id)!);
}

const detailLabels = {
  title: 'Evenemangets namn',
  location: 'Platsen',
  startDate: 'Startdatumet',
  endDate: 'Slutdatumet',
  description: 'Beskrivningen',
  bookingMode: 'Bokningssättet',
} satisfies Record<Exclude<keyof EventDetails, 'shifts'>, string>;
const shiftKeys: (keyof Omit<Shift, 'slots'>)[] = [
  'id',
  'kind',
  'title',
  'group',
  'countsTowardBalance',
  'endIsApproximate',
  'sharedPrompt',
  'sharedAnswer',
  'answerPrompt',
  'roleId',
  'roleName',
  'instructions',
  'startsAt',
  'endsAt',
  'externalTeam',
];
function mergeDraft(base: EventDetails, current: EventDetails, edited: EventDetails): EventDetails {
  const fields = Object.fromEntries(
    Object.entries(detailLabels).map(([key, label]) => {
      const k = key as keyof typeof detailLabels;
      return [key, mergeValue(base[k], current[k], edited[k], label)];
    }),
  );
  const shifts = mergeItems(
    base.shifts,
    current.shifts,
    edited.shifts,
    'Passlistan',
    (b, c, e) =>
      ({
        ...Object.fromEntries(
          shiftKeys.map((k) => [k, mergeValue(b[k], c[k], e[k], 'Uppgifterna för ett pass')]),
        ),
        // A place is atomic: do not combine conflicting family/adult choices or discard a new confirmation.
        slots: mergeItems(b.slots, c.slots, e.slots, 'Bemanningen eller bekräftelsen för en plats'),
      }) as Shift,
  );
  return { ...fields, shifts } as EventDetails;
}

export function mergeEventEdit(
  base: PortalEvent | null,
  current: PortalEvent | undefined,
  edited: PortalEvent,
): PortalEvent {
  if (!edited || typeof edited.id !== 'string' || !edited.draft)
    throw new DomainError('Evenemanget har fel format.');
  if (base === null) {
    if (current) conflict('Evenemanget');
    return structuredClone(edited);
  }
  if (!base || base.id !== edited.id || !base.draft)
    throw new DomainError('Underlaget för redigeringen saknas. Öppna evenemanget igen.');
  if (!current || current.cancelled)
    throw new EventConflictError('Evenemanget har tagits bort eller ställts in.');
  if (current.publication !== base.publication)
    throw new EventConflictError('En ny version av evenemanget har publicerats.');
  return {
    ...current,
    draft: mergeDraft(base.draft, current.draft, edited.draft),
    manualParticipantIds: mergeValue(
      base.manualParticipantIds,
      current.manualParticipantIds,
      edited.manualParticipantIds,
      'De manuellt valda deltagarna',
    ),
  };
}

export function hasEventBase(command: PortalCommand): boolean {
  return (
    ['save_event', 'auto_plan', 'publish_event'].includes(command.type) &&
    Object.hasOwn(command, 'baseEvent')
  );
}

/** Rebase only event operations. All other commands retain the existing global version check. */
export function prepareEventCommand(
  state: PortalState,
  command: PortalCommand,
  expectedVersion: number,
): PortalCommand {
  if (!Number.isInteger(expectedVersion)) throw new DomainError(staleDataMessage, 409);
  if (!hasEventBase(command)) {
    if (state.version !== expectedVersion) throw new DomainError(staleDataMessage, 409);
    return command;
  }
  if (command.type === 'save_event')
    return {
      ...command,
      event: mergeEventEdit(
        command.baseEvent!,
        state.events.find((e) => e.id === command.event?.id),
        command.event,
      ),
    };
  if (command.type === 'auto_plan' || command.type === 'publish_event') {
    const base = command.baseEvent;
    const current = state.events.find((e) => e.id === command.eventId);
    if (
      !base ||
      base.id !== command.eventId ||
      !current ||
      current.cancelled ||
      base.publication !== current.publication ||
      !same(base.draft, current.draft) ||
      !same(base.manualParticipantIds, current.manualParticipantIds)
    )
      throw new EventConflictError(
        'Evenemanget har ändrats efter att utkastet sparades. Granska den senaste versionen innan du fördelar eller publicerar.',
        true,
      );
  }
  return command;
}
