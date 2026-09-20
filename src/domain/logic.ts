import type {
  Adult,
  Balance,
  Child,
  EventDetails,
  Family,
  HistoryEntry,
  PlanningResult,
  PortalCommand,
  PortalEvent,
  PortalState,
  PublicState,
  Role,
  Shift,
  Slot,
  SlotStatus,
  Team,
} from './model.ts';
import { shiftStockholmDate, stockholmParts, timestamp } from './calendar.ts';

export class DomainError extends Error {
  code: number;
  constructor(message: string, code = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

type RecordValue = Record<string, unknown>;
const statuses: SlotStatus[] = ['pending', 'confirmed', 'completed', 'absent', 'cancelled'];
const adminCommands = new Set([
  'save_family',
  'save_role',
  'save_event',
  'copy_event',
  'auto_plan',
  'publish_event',
  'cancel_event',
  'resolve_request',
  'complete_slot',
  'complete_slots',
  'review_history',
  'import_data',
  'remind_confirmation',
  'update_team',
]);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function failure(message: string, code = 400): never {
  throw new DomainError(message, code);
}
const key = (eventId: string, slotId: string) => `${eventId}:${slotId}`;
const normalized = (value?: string) =>
  (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv-SE');
const activeSlot = (slot: Slot) =>
  Boolean(slot.familyId) && (slot.status === 'pending' || slot.status === 'confirmed');

function object(value: unknown, field: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    failure(`${field} har fel format.`);
  return value as RecordValue;
}
function text(value: unknown, field: string, max = 200, optional = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!optional && !value.trim()) ||
    /\u0000/.test(value)
  )
    failure(`${field} behöver giltig text${optional ? '' : ' och får inte vara tomt'}.`);
  return value.trim();
}
function id(value: unknown, field = 'ID'): string {
  const result = text(value, field, 160);
  if (!/^[\w][\w.:@/-]*$/.test(result)) failure(`${field} innehåller otillåtna tecken.`);
  return result;
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') failure(`${field} måste vara ja eller nej.`);
  return value as boolean;
}
function integer(value: unknown, field: string, max = 1_000_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max)
    failure(`${field} måste vara ett giltigt heltal.`);
  return value as number;
}
function list(value: unknown, field: string, max = 1000): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    failure(`${field} behöver vara en lista med högst ${max} poster.`);
  return value as unknown[];
}
function uniqueIds<T extends { id: string }>(items: T[], field: string): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    failure(`${field} innehåller samma ID flera gånger.`);
  return items;
}
function instant(value: unknown, field: string): string {
  const result = text(value, field, 40);
  try {
    return new Date(timestamp(result)).toISOString();
  } catch {
    return failure(`${field} behöver giltigt datum, tid och tidszon.`);
  }
}
function date(value: unknown, field: string): string {
  const result = text(value, field, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    !Number.isFinite(Date.parse(`${result}T12:00:00Z`)) ||
    new Date(`${result}T12:00:00Z`).toISOString().slice(0, 10) !== result
  )
    failure(`${field} behöver ett riktigt datum.`);
  return result;
}
function optionalId(value: unknown, field: string): string | undefined {
  return value === undefined || value === '' ? undefined : id(value, field);
}
function optionalText(value: unknown, field: string, max = 200): string | undefined {
  return value === undefined || value === '' ? undefined : text(value, field, max);
}
function phone(value: unknown, required = false): string {
  const result = text(value, 'Telefonnummer', 40, !required);
  if (result && (!/^[+\d\s().-]+$/.test(result) || result.replace(/\D/g, '').length < 5))
    failure('Ange ett giltigt telefonnummer.');
  return result;
}
export function emailAddress(value: unknown, required = false): string {
  const result = text(value ?? '', 'Mejladress', 254, !required).toLowerCase();
  const [local, domain, ...extra] = result.split('@');
  if (
    result &&
    (extra.length ||
      !local ||
      !domain ||
      local.length > 64 ||
      local.startsWith('.') ||
      local.endsWith('.') ||
      local.includes('..') ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) ||
      !domain.includes('.') ||
      !domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))
  )
    failure('Ange en giltig mejladress.');
  return result;
}
/** Private register contacts; never use this to project emails to the public portal. */
export function assignmentContacts(state: PortalState, slot: Slot): Adult[] {
  if (!state.families.some((f) => f.id === slot.familyId && f.active)) return [];
  const seen = new Set<string>();
  return state.adults.filter((adult) => {
    if (
      !adult.active ||
      !adult.familyIds.includes(slot.familyId || '') ||
      !adult.email ||
      (slot.adultId && adult.id !== slot.adultId)
    )
      return false;
    const email = emailAddress(adult.email);
    if (!email || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}
function mergeAdults(state: PortalState, adults: Adult[]): Adult[] {
  return upsert(
    state.adults,
    adults.map((adult) =>
      adult.email === undefined
        ? {
            ...adult,
            ...(state.adults.find((a) => a.id === adult.id)?.email !== undefined
              ? { email: state.adults.find((a) => a.id === adult.id)!.email }
              : {}),
          }
        : adult,
    ),
  );
}
function parseFamily(value: unknown): Family {
  const item = object(value, 'Familj');
  const family: Family = {
    id: id(item.id),
    label: text(item.label, 'Familjens namn'),
    active: boolean(item.active, 'Aktiv familj'),
    exempt: boolean(item.exempt, 'Ledarundantag'),
  };
  if (item.unavailable !== undefined)
    family.unavailable = list(item.unavailable, 'Förhinder', 100).map((value) => {
      const unavailable = object(value, 'Förhinder');
      const startsAt = instant(unavailable.startsAt, 'Förhindrets start');
      const endsAt = instant(unavailable.endsAt, 'Förhindrets slut');
      if (startsAt >= endsAt) failure('Förhindrets sluttid måste vara efter starttiden.');
      return { startsAt, endsAt };
    });
  return family;
}
function parseChild(value: unknown): Child {
  const item = object(value, 'Barn');
  return {
    id: id(item.id),
    name: text(item.name, 'Barnets namn'),
    familyId: id(item.familyId, 'Familj'),
    active: boolean(item.active, 'Aktivt barn'),
  };
}
function parseAdult(value: unknown): Adult {
  const item = object(value, 'Vuxen');
  const familyIds = [
    ...new Set(list(item.familyIds, 'Vuxens familjer', 30).map((value) => id(value, 'Familj'))),
  ];
  if (!familyIds.length) failure('En vuxen behöver tillhöra minst en familj.');
  return {
    id: id(item.id),
    name: text(item.name, 'Vuxens namn'),
    phone: phone(item.phone),
    ...(item.email === undefined ? {} : { email: emailAddress(item.email) }),
    familyIds,
    active: boolean(item.active, 'Aktiv vuxen'),
  };
}
function parseRole(value: unknown): Role {
  const item = object(value, 'Uppgift');
  return {
    id: id(item.id),
    name: text(item.name, 'Uppgiftens namn'),
    instructions: text(item.instructions, 'Instruktioner', 8000, true),
  };
}
function parseSlot(value: unknown): Slot {
  const item = object(value, 'Bemanningsplats');
  const status = text(item.status, 'Status') as SlotStatus;
  if (!statuses.includes(status)) failure('Okänd bemanningsstatus.');
  return {
    id: id(item.id),
    familyId: optionalId(item.familyId, 'Familj'),
    adultId: optionalId(item.adultId, 'Vuxen'),
    adultName: optionalText(item.adultName, 'Ansvarig vuxen'),
    adultPhone: item.adultPhone === undefined ? undefined : phone(item.adultPhone),
    locked: boolean(item.locked, 'Låst plats'),
    revision: integer(item.revision, 'Version'),
    status,
  };
}
function parseDetails(value: unknown): EventDetails {
  const item = object(value, 'Evenemang');
  const startDate = date(item.startDate, 'Första datum');
  const endDate = date(item.endDate, 'Sista datum');
  if (endDate < startDate) failure('Sista datum får inte vara före första datum.');
  const shifts: Shift[] = uniqueIds(
    list(item.shifts, 'Pass', 300).map((value) => {
      const shift = object(value, 'Pass');
      const startsAt = instant(shift.startsAt, 'Passets start');
      const endsAt = instant(shift.endsAt, 'Passets slut');
      if (endsAt <= startsAt) failure('Passets sluttid måste vara efter starttiden.');
      return {
        id: id(shift.id),
        roleId: id(shift.roleId, 'Uppgift'),
        roleName: text(shift.roleName, 'Uppgiftens namn'),
        instructions: text(shift.instructions, 'Instruktioner', 8000, true),
        startsAt,
        endsAt,
        externalTeam: optionalText(shift.externalTeam, 'Annat lag'),
        slots: uniqueIds(
          list(shift.slots, 'Bemanningsplatser', 40).map(parseSlot),
          'Bemanningsplatser',
        ),
      };
    }),
    'Pass',
  );
  uniqueIds(
    shifts.flatMap((shift) => shift.slots),
    'Evenemangets bemanningsplatser',
  );
  if (shifts.reduce((count, shift) => count + shift.slots.length, 0) > 1000)
    failure('Ett evenemang kan ha högst 1 000 bemanningsplatser. Dela upp större arrangemang.');
  return {
    title: text(item.title, 'Evenemangets namn'),
    location: text(item.location, 'Plats', 500, true),
    startDate,
    endDate,
    description: text(item.description, 'Beskrivning', 12000, true),
    shifts,
  };
}
function parseHistory(value: unknown): HistoryEntry {
  const item = object(value, 'Historik');
  const startsAt = instant(item.startsAt, 'Historikens start');
  const endsAt = instant(item.endsAt, 'Historikens slut');
  if (endsAt <= startsAt) failure('Historikens sluttid måste vara efter starttiden.');
  if (item.source !== 'import') failure('Importerad historik måste märkas med källa import.');
  return {
    id: id(item.id),
    familyId: id(item.familyId, 'Familj'),
    assignmentId: id(item.assignmentId, 'Historiskt pass'),
    eventTitle: text(item.eventTitle, 'Evenemangsnamn'),
    roleName: text(item.roleName, 'Uppgift'),
    startsAt,
    endsAt,
    source: 'import',
    verified: boolean(item.verified, 'Granskad historik'),
  };
}
function parseTeam(value: unknown): Team {
  const item = object(value, 'Lag');
  return {
    id: id(item.id),
    slug: id(item.slug),
    name: text(item.name, 'Lagets namn'),
    clubName: text(item.clubName, 'Förening'),
    contactName: text(item.contactName, 'Kontaktperson', 200, true),
    contactPhone: phone(item.contactPhone),
    reminderDays: [
      ...new Set(
        list(item.reminderDays, 'Påminnelser', 10).map((value) =>
          integer(value, 'Dagar före passet', 60),
        ),
      ),
    ].sort((a, b) => b - a),
  };
}

function eventById(state: PortalState, eventId: string): PortalEvent {
  return (
    state.events.find((event) => event.id === eventId) ??
    failure('Evenemanget finns inte längre.', 404)
  );
}
function findSlot(
  details: EventDetails | undefined,
  slotId: string,
): { shift: Shift; slot: Slot } | undefined {
  if (!details) return undefined;
  for (const shift of details.shifts) {
    const slot = shift.slots.find((slot) => slot.id === slotId);
    if (slot) return { shift, slot };
  }
  return undefined;
}
function person(slot: Slot): string {
  return slot.adultId
    ? `id:${slot.adultId}`
    : normalized(slot.adultName)
      ? `name:${normalized(slot.adultName)}`
      : '';
}
function phoneIdentity(value?: string): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.startsWith('0046')
    ? `0${digits.slice(4).replace(/^0/, '')}`
    : digits.startsWith('46')
      ? `0${digits.slice(2).replace(/^0/, '')}`
      : digits;
}
function sameDeclaredAdult(state: PortalState, a: Slot, b: Slot): boolean {
  if (a.adultId && b.adultId) return a.adultId === b.adultId;
  const aRegistered = a.adultId ? state.adults.find((adult) => adult.id === a.adultId) : undefined;
  const bRegistered = b.adultId ? state.adults.find((adult) => adult.id === b.adultId) : undefined;
  const aName = normalized(aRegistered?.name ?? a.adultName),
    bName = normalized(bRegistered?.name ?? b.adultName);
  const aPhone = phoneIdentity(a.adultPhone || aRegistered?.phone),
    bPhone = phoneIdentity(b.adultPhone || bRegistered?.phone);
  return Boolean(
    aName &&
    bName &&
    aName === bName &&
    (a.familyId === b.familyId || (aPhone && bPhone && aPhone === bPhone)),
  );
}
function context(details: EventDetails, shift: Shift, slot: Slot): string {
  return JSON.stringify([
    normalized(details.location),
    timestamp(shift.startsAt),
    timestamp(shift.endsAt),
    shift.roleId,
    normalized(shift.externalTeam),
    slot.familyId ?? '',
  ]);
}
function fingerprint(details: EventDetails, shift: Shift, slot: Slot): string {
  return `${context(details, shift, slot)}|${person(slot)}`;
}
function overlaps(
  a: { startsAt: string; endsAt: string },
  b: { startsAt: string; endsAt: string },
): boolean {
  return timestamp(a.startsAt) < timestamp(b.endsAt) && timestamp(b.startsAt) < timestamp(a.endsAt);
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function upsert<T extends { id: string }>(items: T[], values: T[]): T[] {
  const merged = new Map(items.map((item) => [item.id, item]));
  values.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}
function validateRelations(state: PortalState): void {
  const families = new Set(state.families.map((family) => family.id));
  for (const child of state.children)
    if (!families.has(child.familyId)) failure(`Barnet ${child.name} saknar en giltig familj.`);
  for (const adult of state.adults)
    if (adult.familyIds.some((family) => !families.has(family)))
      failure(`Den vuxne ${adult.name} saknar en giltig familj.`);
  for (const row of state.history)
    if (!families.has(row.familyId)) failure('En historikpost hänvisar till en okänd familj.');
}
function eligibleFamily(state: PortalState, family: Family): boolean {
  return (
    family.active && state.children.some((child) => child.familyId === family.id && child.active)
  );
}
function selection(
  state: PortalState,
  targetEventId?: string,
): { event: PortalEvent; details: EventDetails }[] {
  return state.events
    .filter((event) => !event.cancelled)
    .flatMap((event) => {
      const details = event.id === targetEventId ? event.draft : event.published;
      return details ? [{ event, details }] : [];
    });
}

export function balances(state: PortalState, eventId?: string): Balance[] {
  const result = new Map(
    state.families.map((family) => [
      family.id,
      { familyId: family.id, completed: 0, reserved: 0, total: 0, latest: '' } satisfies Balance,
    ]),
  );
  const counted = new Set<string>();
  for (const entry of state.history) {
    const balance = result.get(entry.familyId);
    if (!entry.verified || !balance || counted.has(entry.assignmentId)) continue;
    counted.add(entry.assignmentId);
    balance.completed += 1;
    if (!balance.latest || timestamp(entry.startsAt) > timestamp(balance.latest))
      balance.latest = entry.startsAt;
  }
  for (const { event, details } of selection(state, eventId)) {
    for (const shift of details.shifts)
      for (const slot of shift.slots) {
        const balance = slot.familyId ? result.get(slot.familyId) : undefined;
        const assignment = key(event.id, slot.id);
        if (shift.externalTeam || !activeSlot(slot) || !balance || counted.has(assignment))
          continue;
        counted.add(assignment);
        balance.reserved += 1;
        if (!balance.latest || timestamp(shift.startsAt) > timestamp(balance.latest))
          balance.latest = shift.startsAt;
      }
  }
  return [...result.values()].map((balance) => ({
    ...balance,
    total: balance.completed + balance.reserved,
  }));
}

export function validateEvent(state: PortalState, eventId: string): string[] {
  const event = state.events.find((event) => event.id === eventId);
  if (!event) return ['Evenemanget finns inte längre.'];
  const errors: string[] = [];
  try {
    parseDetails(event.draft);
  } catch (error) {
    return [error instanceof Error ? error.message : 'Evenemanget har fel format.'];
  }
  const details = event.draft;
  if (!details.shifts.length) errors.push('Lägg till minst ett pass innan publicering.');
  const targetIds = new Set(details.shifts.flatMap((shift) => shift.slots.map((slot) => slot.id)));
  for (const other of state.events)
    if (other.id !== eventId) {
      if (
        [other.draft, ...(other.published ? [other.published] : [])].some((version) =>
          version.shifts.some((shift) => shift.slots.some((slot) => targetIds.has(slot.id))),
        )
      )
        errors.push('En bemanningsplats har samma ID som en plats i ett annat evenemang.');
    }
  for (const shift of details.shifts) {
    if (!state.roles.some((role) => role.id === shift.roleId))
      errors.push(`Uppgiften ${shift.roleName} finns inte i registret.`);
    if (
      stockholmParts(shift.startsAt).date < details.startDate ||
      stockholmParts(shift.endsAt).date > details.endDate
    )
      errors.push(`${shift.roleName}: passet ligger utanför evenemangets datum.`);
    if (!shift.externalTeam && !shift.slots.length)
      errors.push(`${shift.roleName}: ange minst en bemanningsplats.`);
    for (const slot of shift.slots) {
      if (shift.externalTeam && (slot.familyId || slot.adultId || slot.adultName))
        errors.push(`${shift.roleName}: ett annat lags platser kan inte tilldelas egna familjer.`);
      if (!slot.familyId && (slot.adultId || slot.adultName || slot.adultPhone))
        errors.push(`${shift.roleName}: välj familj före ansvarig vuxen.`);
      const family = state.families.find((family) => family.id === slot.familyId);
      if (slot.familyId && !family)
        errors.push(`${shift.roleName}: en tilldelad familj finns inte.`);
      if (family && activeSlot(slot) && !eligibleFamily(state, family))
        errors.push(`${shift.roleName}: ${family.label} är inte aktiv och behöver kontrolleras.`);
      if (slot.adultId) {
        const adult = state.adults.find((adult) => adult.id === slot.adultId);
        if (!adult || !adult.familyIds.includes(slot.familyId ?? ''))
          errors.push(`${shift.roleName}: den valda vuxna tillhör inte familjen.`);
        else if (!adult.active && activeSlot(slot))
          errors.push(`${shift.roleName}: den valda vuxna är inte aktiv.`);
      }
    }
  }
  const assignments = selection(state, eventId)
    .flatMap(({ event, details }) =>
      details.shifts
        .filter((shift) => !shift.externalTeam)
        .flatMap((shift) =>
          shift.slots.filter(activeSlot).map((slot) => ({
            event,
            shift,
            slot,
            start: timestamp(shift.startsAt),
            end: timestamp(shift.endsAt),
          })),
        ),
    )
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    for (let j = i + 1; j < assignments.length && assignments[j].start < a.end; j++) {
      const b = assignments[j];
      if (a.event.id !== eventId && b.event.id !== eventId) continue;
      const aPerson = person(a.slot),
        bPerson = person(b.slot);
      if (sameDeclaredAdult(state, a.slot, b.slot))
        errors.push(
          `Dubbelbokning: samma vuxen har överlappande pass (${a.shift.roleName} och ${b.shift.roleName}).`,
        );
      else if (a.slot.familyId === b.slot.familyId && (!aPerson || !bPerson))
        errors.push(
          `Dubbelbokning: ${state.families.find((family) => family.id === a.slot.familyId)?.label ?? 'familjen'} har överlappande pass utan två olika ansvariga vuxna.`,
        );
    }
  }
  return [...new Set(errors)];
}

export function autoPlan(state: PortalState, eventId: string): PlanningResult {
  const next = clone(state);
  const event = eventById(next, eventId);
  if (event.cancelled) failure('Ett inställt evenemang kan inte bemannas.', 409);
  const notices: string[] = [];
  const shifts = [...event.draft.shifts].sort(
    (a, b) => timestamp(a.startsAt) - timestamp(b.startsAt) || a.id.localeCompare(b.id),
  );
  for (const shift of shifts) {
    if (shift.externalTeam) continue;
    for (const slot of shift.slots) {
      if (slot.familyId || slot.locked || slot.status !== 'pending') continue;
      const counts = new Map(balances(next, eventId).map((balance) => [balance.familyId, balance]));
      const candidates = next.families
        .filter(
          (family) =>
            eligibleFamily(next, family) &&
            !family.exempt &&
            !(family.unavailable ?? []).some((unavailable) => overlaps(unavailable, shift)),
        )
        .filter(
          (family) =>
            !selection(next, eventId).some(({ details }) =>
              details.shifts.some(
                (other) =>
                  !other.externalTeam &&
                  overlaps(other, shift) &&
                  other.slots.some(
                    (otherSlot) =>
                      otherSlot.id !== slot.id &&
                      activeSlot(otherSlot) &&
                      otherSlot.familyId === family.id,
                  ),
              ),
            ),
        )
        .sort((a, b) => {
          const aBalance = counts.get(a.id)!,
            bBalance = counts.get(b.id)!;
          return (
            aBalance.total - bBalance.total ||
            (aBalance.latest ? timestamp(aBalance.latest) : 0) -
              (bBalance.latest ? timestamp(bBalance.latest) : 0) ||
            a.id.localeCompare(b.id)
          );
        });
      const family = candidates[0];
      if (!family) {
        notices.push(
          `${shift.roleName} ${stockholmParts(shift.startsAt).date} ${stockholmParts(shift.startsAt).time.slice(0, 5)}: ingen tillgänglig familj, platsen är tom.`,
        );
        continue;
      }
      slot.familyId = family.id;
      delete slot.adultId;
      delete slot.adultName;
      delete slot.adultPhone;
      delete slot.confirmedAt;
      delete slot.confirmedRevision;
      slot.status = 'pending';
      notices.push(
        `${family.label}: ${counts.get(family.id)!.total} pass före tilldelning av ${shift.roleName}.`,
      );
    }
  }
  return { state: next, notices };
}

/** Explicit projection: neither unpublished drafts nor private register fields reach visitors. */
export function publicState(state: PortalState): PublicState {
  const assignedFamilies = new Set(
    state.events.flatMap(
      (event) =>
        event.published?.shifts.flatMap((shift) =>
          shift.slots.flatMap((slot) => (slot.familyId ? [slot.familyId] : [])),
        ) ?? [],
    ),
  );
  const families = state.families
    .filter((family) => family.active || assignedFamilies.has(family.id))
    .map((family) => ({
      id: family.id,
      label: family.label,
      active: family.active,
      exempt: false,
    }));
  const visible = new Set(families.map((family) => family.id));
  const publicPhones = new Map<string, string>();
  const publicRoles = new Map<string, Role>();
  for (const event of [...state.events].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)))
    for (const shift of event.published?.shifts ?? []) {
      publicRoles.set(shift.roleId, {
        id: shift.roleId,
        name: shift.roleName,
        instructions: shift.instructions,
      });
      for (const slot of shift.slots)
        if (slot.adultId && slot.adultPhone) publicPhones.set(slot.adultId, slot.adultPhone);
    }
  return {
    version: state.version,
    team: {
      id: state.team.id,
      slug: state.team.slug,
      name: state.team.name,
      clubName: state.team.clubName,
      contactName: state.team.contactName,
      contactPhone: state.team.contactPhone,
      reminderDays: [],
    },
    families,
    children: state.children
      .filter((child) => child.active && visible.has(child.familyId))
      .map((child) => ({
        id: child.id,
        name: child.name,
        familyId: child.familyId,
        active: child.active,
      })),
    adults: state.adults
      .filter((adult) => adult.active && adult.familyIds.some((family) => visible.has(family)))
      .map((adult) => ({
        id: adult.id,
        name: adult.name,
        phone: publicPhones.get(adult.id) ?? '',
        familyIds: adult.familyIds.filter((family) => visible.has(family)),
        active: adult.active,
      })),
    roles: [...publicRoles.values()],
    events: state.events
      .filter((event) => event.published)
      .map((event) => {
        const details: EventDetails = {
          title: event.published!.title,
          location: event.published!.location,
          startDate: event.published!.startDate,
          endDate: event.published!.endDate,
          description: event.published!.description,
          shifts: event.published!.shifts.map((shift) => ({
            id: shift.id,
            roleId: shift.roleId,
            roleName: shift.roleName,
            instructions: shift.instructions,
            startsAt: shift.startsAt,
            endsAt: shift.endsAt,
            ...(shift.externalTeam ? { externalTeam: shift.externalTeam } : {}),
            slots: shift.slots.map((slot) => ({
              id: slot.id,
              familyId: slot.familyId,
              adultId: slot.adultId,
              adultName: slot.adultName,
              adultPhone: slot.adultPhone,
              revision: slot.revision,
              status: slot.status,
              confirmedAt: slot.confirmedAt,
              confirmedRevision: slot.confirmedRevision,
              locked: false,
            })),
          })),
        };
        return {
          id: event.id,
          draft: clone(details),
          published: details,
          publication: event.publication,
          cancelled: event.cancelled,
          updatedAt: event.updatedAt,
        };
      }),
    requests: [],
  };
}

function canonicalAdult(state: PortalState, slot: Slot, previous?: Slot): void {
  if (!slot.adultId) return;
  const adult = state.adults.find((adult) => adult.id === slot.adultId);
  if (!adult || !adult.familyIds.includes(slot.familyId ?? ''))
    failure('Den valda vuxna tillhör inte familjen.');
  if (!adult.active) failure('Den valda vuxna är inte aktiv.');
  if (previous?.adultId === slot.adultId) {
    // Keep the accepted contact snapshot on ordinary edits. An explicit re-selection
    // may supply the current register values, while omitted fields retain the snapshot.
    slot.adultName = slot.adultName ?? previous.adultName ?? adult.name;
    slot.adultPhone = slot.adultPhone ?? previous.adultPhone ?? adult.phone;
  } else {
    slot.adultName = adult.name;
    slot.adultPhone = adult.phone;
  }
}
function clearConfirmation(slot: Slot): void {
  delete slot.confirmedAt;
  delete slot.confirmedRevision;
}
function preserveOutcome(slot: Slot, prior: Slot): void {
  slot.status = prior.status;
  slot.revision = prior.revision;
  slot.confirmedAt = prior.confirmedAt;
  slot.confirmedRevision = prior.confirmedRevision;
  slot.reminderRequestedAt = prior.reminderRequestedAt;
  slot.reminderRevision = prior.reminderRevision;
}
function checkPublishedSlot(
  state: PortalState,
  command: RecordValue,
): { event: PortalEvent; shift: Shift; slot: Slot } {
  const event = eventById(state, id(command.eventId, 'Evenemang'));
  if (!event.published || event.cancelled)
    failure('Evenemanget är inte publicerat eller har ställts in.', 409);
  const found = findSlot(event.published, id(command.slotId, 'Bemanningsplats'));
  if (!found || found.shift.externalTeam || !activeSlot(found.slot))
    failure('Passet är inte längre tillgängligt för svar.', 409);
  if (found.slot.familyId !== id(command.familyId, 'Familj'))
    failure('Passet är inte tilldelat den valda familjen.', 409);
  if (found.slot.revision !== integer(command.revision, 'Version'))
    failure('Passet har ändrats. Läs det aktuella schemat och svara igen.', 409);
  return { event, ...found };
}

/** Mutates only the reducer's private clone; bulk calls commit all outcomes or none. */
function completeOne(
  next: PortalState,
  eventId: string,
  slotId: string,
  completed: boolean,
  at: string,
): boolean {
  const event = eventById(next, eventId);
  const found = findSlot(event.published, slotId);
  if (!found || !found.slot.familyId || found.shift.externalTeam)
    failure('Passet måste vara publicerat och tilldelat en familj.', 409);
  if (event.cancelled || found.slot.status === 'cancelled')
    failure('Ett inställt pass kan inte avslutas.', 409);
  if (timestamp(found.shift.endsAt) > timestamp(at))
    failure('Passet kan markeras genomfört först efter sluttiden.', 409);
  const assignmentId = key(event.id, slotId);
  const status: SlotStatus = completed ? 'completed' : 'absent';
  if (
    found.slot.status === status &&
    (completed
      ? next.history.some((entry) => entry.assignmentId === assignmentId && entry.verified)
      : !next.history.some((entry) => entry.assignmentId === assignmentId))
  )
    return false;
  next.history = next.history.filter((entry) => entry.assignmentId !== assignmentId);
  if (completed)
    next.history.push({
      id: `history:${assignmentId}`,
      assignmentId,
      familyId: found.slot.familyId,
      eventTitle: event.published!.title,
      roleName: found.shift.roleName,
      startsAt: found.shift.startsAt,
      endsAt: found.shift.endsAt,
      source: 'portal',
      verified: true,
    });
  found.slot.status = status;
  const draft = findSlot(event.draft, slotId);
  if (
    draft &&
    fingerprint(event.draft, draft.shift, draft.slot) ===
      fingerprint(event.published!, found.shift, found.slot)
  )
    preserveOutcome(draft.slot, found.slot);
  event.updatedAt = at;
  return true;
}

export function applyCommand(
  state: PortalState,
  command: PortalCommand,
  actor: 'admin' | 'public',
  now = new Date().toISOString(),
): PortalState {
  const input = object(command, 'Åtgärd');
  const type = text(input.type, 'Åtgärd', 40);
  if (actor !== 'admin' && actor !== 'public') failure('Okänd behörighet.', 403);
  if (actor === 'public' && type !== 'confirm' && type !== 'request_change')
    failure('Åtgärden kräver administratörsinloggning.', 403);
  if (!adminCommands.has(type) && type !== 'confirm' && type !== 'request_change')
    failure('Okänd åtgärd.');
  const at = instant(now, 'Tidpunkt');
  let next = clone(state);
  let summary = '';
  switch (type) {
    case 'save_family': {
      const family = parseFamily(input.family);
      const children = uniqueIds(list(input.children, 'Barn', 30).map(parseChild), 'Barn');
      const adults = uniqueIds(list(input.adults, 'Vuxna', 30).map(parseAdult), 'Vuxna');
      if (
        children.some((child) => child.familyId !== family.id) ||
        adults.some((adult) => !adult.familyIds.includes(family.id))
      )
        failure('Barn och vuxna måste kopplas till den redigerade familjen.');
      next.families = upsert(next.families, [family]);
      next.children = upsert(next.children, children);
      next.adults = mergeAdults(next, adults);
      validateRelations(next);
      summary = `Familjen ${family.label} sparades.`;
      break;
    }
    case 'save_role': {
      const role = parseRole(input.role);
      next.roles = upsert(next.roles, [role]);
      summary = `Uppgiften ${role.name} sparades.`;
      break;
    }
    case 'update_team': {
      const team = parseTeam(input.team);
      if (team.id !== next.team.id) failure('Lagets identitet får inte ändras.');
      next.team = team;
      summary = 'Laginställningarna sparades.';
      break;
    }
    case 'save_event': {
      const raw = object(input.event, 'Evenemang');
      const eventId = id(raw.id, 'Evenemang');
      const draft = parseDetails(raw.draft);
      const existing = next.events.find((event) => event.id === eventId);
      if (existing?.cancelled)
        failure(
          'Ett inställt evenemang kan inte redigeras. Kopiera det för ett nytt tillfälle.',
          409,
        );
      for (const shift of draft.shifts)
        for (const slot of shift.slots) {
          const prior = findSlot(existing?.draft, slot.id);
          canonicalAdult(next, slot, prior?.slot);
          if (
            prior &&
            existing &&
            fingerprint(existing.draft, prior.shift, prior.slot) === fingerprint(draft, shift, slot)
          )
            preserveOutcome(slot, prior.slot);
          else {
            slot.status = 'pending';
            slot.revision = prior?.slot.revision ?? 0;
            clearConfirmation(slot);
          }
          const published = findSlot(existing?.published, slot.id);
          if (
            published?.slot.status === 'completed' &&
            existing?.published &&
            fingerprint(existing.published, published.shift, published.slot) !==
              fingerprint(draft, shift, slot)
          )
            failure(
              'Ett genomfört pass måste först rättas i uppföljningen innan tilldelningen kan ändras.',
              409,
            );
        }
      if (
        existing?.published?.shifts.some((shift) =>
          shift.slots.some((slot) => slot.status === 'completed' && !findSlot(draft, slot.id)),
        )
      )
        failure('Ett genomfört pass kan inte tas bort ur schemat.', 409);
      const event: PortalEvent = existing
        ? { ...existing, draft, updatedAt: at }
        : { id: eventId, draft, publication: 0, cancelled: false, updatedAt: at };
      next.events = upsert(next.events, [event]);
      const structuralErrors = validateEvent(next, eventId).filter((error) =>
        /finns inte i registret|tillhör inte|familj före|familj finns inte|samma ID|annat lags/.test(
          error,
        ),
      );
      if (structuralErrors.length) failure(structuralErrors.join('\n'));
      summary = `Utkastet ${draft.title} sparades.`;
      break;
    }
    case 'copy_event': {
      const source = eventById(next, id(input.eventId, 'Evenemang'));
      const newId = id(input.newId, 'Nytt evenemang');
      if (newId.length > 120) failure('Det nya evenemangets ID är för långt för kopiering.');
      if (next.events.some((event) => event.id === newId))
        failure('Ett evenemang med detta ID finns redan.', 409);
      const startDate = date(input.startDate, 'Nytt startdatum');
      const days =
        (Date.parse(`${startDate}T12:00:00Z`) - Date.parse(`${source.draft.startDate}T12:00:00Z`)) /
        86_400_000;
      const draft = clone(source.draft);
      draft.title = `${draft.title} – kopia`;
      draft.startDate = startDate;
      draft.endDate = new Date(Date.parse(`${draft.endDate}T12:00:00Z`) + days * 86_400_000)
        .toISOString()
        .slice(0, 10);
      try {
        draft.shifts = draft.shifts.map((shift, shiftIndex) => ({
          ...shift,
          id: `${newId}-shift-${shiftIndex + 1}`,
          startsAt: shiftStockholmDate(shift.startsAt, days),
          endsAt: shiftStockholmDate(shift.endsAt, days),
          slots: shift.slots.map((_, slotIndex) => ({
            id: `${newId}-slot-${shiftIndex + 1}-${slotIndex + 1}`,
            locked: false,
            revision: 0,
            status: 'pending',
          })),
        }));
      } catch (error) {
        failure(error instanceof Error ? error.message : 'Datumet kunde inte kopieras.');
      }
      next.events.push({ id: newId, draft, publication: 0, cancelled: false, updatedAt: at });
      if (validateEvent(next, newId).some((error) => error.includes('samma ID')))
        failure(
          'Kopians bemannings-ID kolliderar med ett befintligt pass. Välj ett annat evenemangs-ID.',
          409,
        );
      summary = `${source.draft.title} kopierades utan bemanning.`;
      break;
    }
    case 'auto_plan': {
      const eventId = id(input.eventId, 'Evenemang');
      next = autoPlan(next, eventId).state;
      eventById(next, eventId).updatedAt = at;
      summary = 'Automatiken fyllde tillgängliga platser i utkastet.';
      break;
    }
    case 'publish_event': {
      const event = eventById(next, id(input.eventId, 'Evenemang'));
      if (event.cancelled) failure('Ett inställt evenemang kan inte publiceras igen.', 409);
      const errors = validateEvent(next, event.id);
      if (errors.length) failure(errors.join('\n'), 409);
      const previous = event.published;
      const published = clone(event.draft);
      if (previous)
        for (const oldShift of previous.shifts)
          for (const oldSlot of oldShift.slots) {
            if (oldSlot.status !== 'completed') continue;
            const current = findSlot(published, oldSlot.id);
            if (
              !current ||
              fingerprint(previous, oldShift, oldSlot) !==
                fingerprint(published, current.shift, current.slot)
            )
              failure(
                'Utkastet ändrar ett pass som redan genomförts. Rätta uppföljningen innan publicering.',
                409,
              );
          }
      for (const shift of published.shifts)
        for (const slot of shift.slots) {
          const old = findSlot(previous, slot.id);
          if (
            old &&
            previous &&
            fingerprint(previous, old.shift, old.slot) === fingerprint(published, shift, slot)
          ) {
            preserveOutcome(slot, old.slot);
            // Names and telephone numbers may have been corrected without invalidating acceptance.
          } else {
            slot.revision = old ? old.slot.revision + 1 : 1;
            slot.status = 'pending';
            clearConfirmation(slot);
          }
        }
      if (previous && same(previous, published)) return state;
      for (const request of next.requests.filter(
        (request) => request.eventId === event.id && request.status === 'open',
      )) {
        const old = findSlot(previous, request.slotId),
          current = findSlot(published, request.slotId);
        if (
          !current ||
          (old &&
            previous &&
            fingerprint(previous, old.shift, old.slot) !==
              fingerprint(published, current.shift, current.slot))
        )
          request.status = 'resolved';
      }
      event.published = published;
      event.draft = clone(published);
      event.publication += 1;
      event.updatedAt = at;
      summary = `${published.title} publicerades.`;
      break;
    }
    case 'cancel_event': {
      const event = eventById(next, id(input.eventId, 'Evenemang'));
      if (event.cancelled) return state;
      event.cancelled = true;
      event.updatedAt = at;
      event.publication += 1;
      for (const details of [event.draft, ...(event.published ? [event.published] : [])])
        for (const shift of details.shifts)
          for (const slot of shift.slots)
            if (slot.status !== 'completed') {
              slot.status = 'cancelled';
              slot.revision += 1;
              clearConfirmation(slot);
            }
      next.requests
        .filter((request) => request.eventId === event.id && request.status === 'open')
        .forEach((request) => {
          request.status = 'resolved';
        });
      summary = `${event.draft.title} ställdes in.`;
      break;
    }
    case 'confirm': {
      const { event, shift, slot } = checkPublishedSlot(next, input);
      let adultId = optionalId(input.adultId, 'Vuxen');
      const adultName = text(input.adultName, 'Ansvarig vuxen');
      const adultPhone = phone(input.adultPhone, true);
      const adultEmail = emailAddress(input.adultEmail, true);
      if (adultId) {
        const adult = next.adults.find((adult) => adult.id === adultId);
        if (!adult || !adult.active || !adult.familyIds.includes(slot.familyId!))
          failure('Den valda vuxna tillhör inte familjen.');
        if (normalized(adultName) !== normalized(adult.name))
          failure(
            'Namnet stämmer inte med den valda vuxna. Välj ange annan ansvarig vuxen om någon annan kommer.',
          );
      }
      // Resolve an explicitly named adult once, so future assignments can use the contact.
      if (!adultId)
        adultId = next.adults.find(
          (adult) =>
            adult.active &&
            adult.familyIds.includes(slot.familyId!) &&
            normalized(adult.name) === normalized(adultName) &&
            adult.phone.replace(/\D/g, '') === adultPhone.replace(/\D/g, ''),
        )?.id;
      const contact = next.adults.find((adult) => adult.id === adultId);
      const emailChanged = contact?.email !== adultEmail;
      if (contact) contact.email = adultEmail;
      else {
        adultId = `adult:confirmation:${next.version + 1}:${slot.id}`;
        next.adults.push({
          id: adultId,
          name: adultName,
          phone: adultPhone,
          email: adultEmail,
          familyIds: [slot.familyId!],
          active: true,
        });
      }
      if (
        slot.status === 'confirmed' &&
        slot.adultId === adultId &&
        slot.adultName === adultName &&
        slot.adultPhone === adultPhone &&
        slot.confirmedRevision === slot.revision &&
        !emailChanged
      )
        return state;
      const old = clone(slot);
      slot.adultId = adultId;
      slot.adultName = adultName;
      slot.adultPhone = adultPhone;
      slot.status = 'confirmed';
      slot.confirmedAt = at;
      slot.confirmedRevision = slot.revision;
      const draft = findSlot(event.draft, slot.id);
      if (draft && draft.slot.familyId === old.familyId && person(draft.slot) === person(old)) {
        draft.slot.adultId = adultId;
        draft.slot.adultName = adultName;
        draft.slot.adultPhone = adultPhone;
        if (
          context(event.draft, draft.shift, draft.slot) === context(event.published!, shift, slot)
        )
          preserveOutcome(draft.slot, slot);
      }
      // Check the actual public schedule, not an unrelated unpublished draft.
      const check = clone(next);
      eventById(check, event.id).draft = clone(event.published!);
      const conflicts = validateEvent(check, event.id).filter((error) =>
        error.startsWith('Dubbelbokning:'),
      );
      if (conflicts.length) failure(conflicts.join('\n'), 409);
      event.updatedAt = at;
      summary = 'Ett pass bekräftades utan identitetskontroll.';
      break;
    }
    case 'remind_confirmation': {
      const { event, shift, slot } = checkPublishedSlot(next, input);
      if (slot.status !== 'pending') failure('Passet är redan bekräftat.', 409);
      if (timestamp(shift.startsAt) <= timestamp(at)) failure('Passet har redan börjat.', 409);
      if (!assignmentContacts(next, slot).length)
        failure('Mejladress saknas. Lägg till den under Barn & föräldrar.');
      if (
        slot.reminderRevision === slot.revision &&
        slot.reminderRequestedAt &&
        timestamp(at) - timestamp(slot.reminderRequestedAt) < 10 * 60 * 1000
      )
        failure('En påminnelse har nyligen begärts. Vänta tio minuter innan du skickar igen.', 409);
      slot.reminderRequestedAt = at;
      slot.reminderRevision = slot.revision;
      const draft = findSlot(event.draft, slot.id);
      if (draft && draft.slot.familyId === slot.familyId) {
        draft.slot.reminderRequestedAt = at;
        draft.slot.reminderRevision = slot.revision;
      }
      summary = 'En mejlpåminnelse om saknad bekräftelse begärdes.';
      break;
    }
    case 'request_change': {
      const { event, slot } = checkPublishedSlot(next, input);
      const message = text(input.message, 'Meddelande', 2000);
      const existing = next.requests.find(
        (request) =>
          request.eventId === event.id &&
          request.slotId === slot.id &&
          request.familyId === slot.familyId &&
          request.status === 'open',
      );
      if (existing?.message === message) return state;
      if (existing) {
        existing.message = message;
        existing.requestedAt = at;
      } else
        next.requests.push({
          id: `request:${next.version + 1}:${slot.id}`,
          eventId: event.id,
          slotId: slot.id,
          familyId: slot.familyId!,
          message,
          requestedAt: at,
          status: 'open',
        });
      summary = 'En familj begärde hjälp med sitt pass.';
      break;
    }
    case 'resolve_request': {
      const request = next.requests.find(
        (request) => request.id === id(input.requestId, 'Förfrågan'),
      );
      if (!request) failure('Förfrågan finns inte.', 404);
      if (input.status !== 'resolved' && input.status !== 'declined')
        failure('Välj löst eller avslaget.');
      if (request.status === input.status) return state;
      request.status = input.status as 'resolved' | 'declined';
      summary = 'En bytesförfrågan hanterades.';
      break;
    }
    case 'complete_slot':
    case 'complete_slots': {
      const eventId = id(input.eventId, 'Evenemang');
      const completed = boolean(input.completed, 'Genomfört pass');
      const slotIds =
        type === 'complete_slot'
          ? [id(input.slotId, 'Bemanningsplats')]
          : list(input.slotIds, 'Bemanningsplatser', 1000).map((value) =>
              id(value, 'Bemanningsplats'),
            );
      if (!slotIds.length || new Set(slotIds).size !== slotIds.length)
        failure('Välj minst en bemanningsplats och ange varje plats en gång.');
      let changed = false;
      for (const slotId of slotIds) {
        const result = completeOne(next, eventId, slotId, completed, at);
        changed = result || changed;
      }
      if (!changed) return state;
      summary = completed
        ? `${slotIds.length} genomförda pass registrerades.`
        : `${slotIds.length} pass markerades som inte genomförda.`;
      break;
    }
    case 'review_history': {
      const historyId = id(input.historyId, 'Historikpost');
      const verified = boolean(input.verified, 'Granskad historik');
      const entry = next.history.find((entry) => entry.id === historyId);
      if (!entry) failure('Historikposten finns inte.', 404);
      if (entry.source !== 'import')
        failure('Pass som registrerats i portalen rättas via evenemangets uppföljning.', 409);
      if (verified && timestamp(entry.endsAt) > timestamp(at))
        failure('Framtida pass kan inte markeras som genomförda. Kontrollera datumet.');
      if (entry.verified === verified) return state;
      entry.verified = verified;
      summary = verified
        ? `Historikposten ${entry.eventTitle} godkändes som genomförd.`
        : `Godkännandet av historikposten ${entry.eventTitle} återtogs. Passet räknas inte längre.`;
      break;
    }
    case 'import_data': {
      const families = uniqueIds(
        list(input.families, 'Familjer', 500).map(parseFamily),
        'Familjer',
      );
      const children = uniqueIds(list(input.children, 'Barn', 1000).map(parseChild), 'Barn');
      const adults = uniqueIds(list(input.adults, 'Vuxna', 1500).map(parseAdult), 'Vuxna');
      const history = uniqueIds(
        list(input.history, 'Historik', 10000).map(parseHistory),
        'Historik',
      );
      next.families = upsert(next.families, families);
      next.children = upsert(next.children, children);
      next.adults = mergeAdults(next, adults);
      for (const entry of history) {
        if (entry.verified && timestamp(entry.endsAt) > timestamp(at))
          failure(
            'Framtida pass kan inte importeras som genomförda. Granska datumet eller lämna posten okontrollerad.',
          );
        const existing = next.history.find(
          (item) => item.id === entry.id || item.assignmentId === entry.assignmentId,
        );
        if (
          existing &&
          (existing.id !== entry.id ||
            existing.assignmentId !== entry.assignmentId ||
            existing.source !== 'import')
        )
          failure(
            'Historikimporten kolliderar med ett redan registrerat pass. Granska ID och dubbletter.',
            409,
          );
        if (
          existing &&
          (existing.familyId !== entry.familyId ||
            timestamp(existing.startsAt) !== timestamp(entry.startsAt) ||
            timestamp(existing.endsAt) !== timestamp(entry.endsAt))
        )
          failure(
            'Ett tidigare importerat pass har motstridiga uppgifter. Granska det före import.',
            409,
          );
        // Re-reading the original unverified PDF export must not undo an administrator's approval.
        next.history = upsert(next.history, [
          { ...entry, verified: entry.verified || existing?.verified || false },
        ]);
      }
      validateRelations(next);
      if (
        same(state.families, next.families) &&
        same(state.children, next.children) &&
        same(state.adults, next.adults) &&
        same(state.history, next.history)
      )
        return state;
      summary = `${history.length} historikposter granskades vid import.`;
      break;
    }
  }
  next.version = state.version + 1;
  next.audit.push({ id: `audit:${next.version}`, at, actor, action: type, summary });
  return next;
}
