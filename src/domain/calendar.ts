import type { CalendarEvent } from './model.ts';

const zonedTimestamp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const stockholm = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function timestamp(value: string): number {
  if (
    typeof value !== 'string' ||
    !zonedTimestamp.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new RangeError('Tiden måste ha datum och tidszon (Z eller exempelvis +02:00).');
  }
  const date = value.slice(0, 10);
  if (
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    (value[16] === ':' && Number(value.slice(17, 19)) > 59)
  ) {
    throw new RangeError('Datumet eller klockslaget finns inte.');
  }
  return Date.parse(value);
}

export function stockholmParts(value: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    stockholm.formatToParts(new Date(timestamp(value))).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

/** Preserve the local wall clock when a copied event crosses a DST boundary. */
export function shiftStockholmDate(value: string, days: number): string {
  const parts = stockholmParts(value);
  const date = new Date(Date.parse(`${parts.date}T12:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const wanted = `${date}T${parts.time}`;
  const wallTime = Date.parse(`${wanted}Z`);
  let instant = wallTime;
  for (let i = 0; i < 4; i++) {
    const local = stockholmParts(new Date(instant).toISOString());
    const difference = wallTime - Date.parse(`${local.date}T${local.time}Z`);
    if (difference === 0) return new Date(instant).toISOString();
    instant += difference;
  }
  throw new RangeError('Den lokala tiden finns inte när klockan ställs om. Välj en annan tid.');
}

function utc(value: string): string {
  return new Date(timestamp(value))
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function checked(event: CalendarEvent): void {
  if (
    !event ||
    typeof event.id !== 'string' ||
    !event.id.trim() ||
    typeof event.title !== 'string' ||
    !event.title.trim()
  ) {
    throw new TypeError('Kalenderhändelsen behöver ID och titel.');
  }
  if (timestamp(event.endsAt) <= timestamp(event.startsAt))
    throw new RangeError('Sluttiden måste vara efter starttiden.');
  for (const value of [event.location, event.description, event.url]) {
    if (typeof value !== 'string') throw new TypeError('Kalenderinformationen måste vara text.');
  }
  if (event.url && !/^https?:\/\/[^\s]+$/i.test(event.url))
    throw new TypeError('Kalenderlänken måste vara en http- eller https-adress.');
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/** RFC 5545 lines are folded by UTF-8 bytes, without splitting a code point. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      lines.push(current);
      current = ' ';
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  lines.push(current);
  return lines.join('\r\n');
}

export function toIcs(event: CalendarEvent): string {
  checked(event);
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Passlaget//Bemanning//SV',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${encodeURIComponent(event.id)}@passlaget`,
      `DTSTAMP:${utc(new Date().toISOString())}`,
      `DTSTART:${utc(event.startsAt)}`,
      `DTEND:${utc(event.endsAt)}`,
      `SUMMARY:${escapeText(event.title)}`,
      `LOCATION:${escapeText(event.location)}`,
      `DESCRIPTION:${escapeText(`${event.description}${event.url ? `\n\nAktuellt schema: ${event.url}` : ''}`)}`,
      ...(event.url ? [`URL:${event.url}`] : []),
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .map(fold)
      .join('\r\n') + '\r\n'
  );
}

export function googleCalendarUrl(event: CalendarEvent): string {
  checked(event);
  const query = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${utc(event.startsAt)}/${utc(event.endsAt)}`,
    ctz: 'Europe/Stockholm',
    location: event.location,
    details: `${event.description}${event.url ? `\n\nAktuellt schema: ${event.url}` : ''}`,
  });
  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}
