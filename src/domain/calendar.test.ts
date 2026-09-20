import { describe, expect, it } from 'vitest';
import {
  googleCalendarUrl,
  shiftStockholmDate,
  stockholmParts,
  timestamp,
  toIcs,
} from './calendar.ts';
import type { CalendarEvent } from './model.ts';

const event: CalendarEvent = {
  id: 'event:slot-1',
  title: 'Parkeringsvärd – Landvetter IS',
  startsAt: '2026-10-03T11:00:00+02:00',
  endsAt: '2026-10-03T13:00:00+02:00',
  location: 'Landvetter IP, entrén',
  description: 'Håll räddningsvägen fri.\nLäs: anvisningar; tack!',
  url: 'https://example.test/#/event/test',
};

describe('single-event calendar exports', () => {
  it('creates exactly one event at the correct UTC instants with stable identity', () => {
    const value = toIcs(event);
    expect(value.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(value).toContain('DTSTART:20261003T090000Z\r\n');
    expect(value).toContain('DTEND:20261003T110000Z\r\n');
    expect(value).toContain('UID:event%3Aslot-1@passlaget');
    expect(value).toContain('DTSTAMP:');
    expect(value).toContain('LOCATION:Landvetter IP\\, entrén');
    expect(value.replace(/\r\n /g, '')).toContain('\\nLäs: anvisningar\\; tack!');
    expect(value.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('folds long Swedish and emoji text by bytes without corrupting Unicode', () => {
    const title = 'Välkommen till cupen 🏆 '.repeat(20);
    const ics = toIcs({ ...event, title });
    for (const line of ics.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${title}`);
  });

  it('escapes injected newlines so user text cannot add calendar properties', () => {
    const ics = toIcs({ ...event, title: 'Cup\r\nEND:VEVENT\r\nBEGIN:VEVENT' });
    expect(ics.split('\r\n').filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(ics).toContain('SUMMARY:Cup\\nEND:VEVENT\\nBEGIN:VEVENT');
    expect(() => toIcs({ ...event, url: 'https://example.test/\nBEGIN:VEVENT' })).toThrow();
  });

  it('uses UTC dates and Stockholm display timezone in the Google template', () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin).toBe('https://calendar.google.com');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20261003T090000Z/20261003T110000Z');
    expect(url.searchParams.get('ctz')).toBe('Europe/Stockholm');
    expect(url.searchParams.get('text')).toBe(event.title);
    expect(url.searchParams.get('details')).toContain(event.url);
  });

  it('handles summer and winter offsets and preserves local wall times on copies', () => {
    expect(
      toIcs({
        ...event,
        startsAt: '2026-11-07T11:00:00+01:00',
        endsAt: '2026-11-07T13:00:00+01:00',
      }),
    ).toContain('DTSTART:20261107T100000Z');
    expect(shiftStockholmDate(event.startsAt, 35)).toBe('2026-11-07T10:00:00.000Z');
    expect(stockholmParts('2026-03-29T01:30:00Z')).toEqual({
      date: '2026-03-29',
      time: '03:30:00',
    });
    expect(() => shiftStockholmDate('2026-03-22T02:30:00+01:00', 7)).toThrow('finns inte');
  });

  it('rejects ambiguous local timestamps, impossible dates and reversed ranges', () => {
    expect(() => timestamp('2026-10-03T11:00')).toThrow();
    expect(() => timestamp('2026-02-30T11:00:00+01:00')).toThrow();
    expect(() => toIcs({ ...event, endsAt: event.startsAt })).toThrow('Sluttiden');
  });
});
