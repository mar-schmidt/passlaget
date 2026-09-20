import type {
  Adult,
  EventDetails,
  Family,
  PortalEvent,
  PortalState,
  Role,
  Shift,
  Slot,
} from './model.ts';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Demonstration data only. No names or telephone numbers from the source roster. */
export function demoState(): PortalState {
  const names = [
    ['Bergström', 'Mina & Milo', 'Nora', 'Alex'],
    ['Dahlén', 'Sigrid', 'Samira', 'Aron'],
    ['Ekström', 'Vera', 'Ida', 'Nils'],
    ['Falk', 'Alma', 'Rebecka', 'Amir'],
    ['Gran', 'Inez', 'Ylva', 'Tobias'],
    ['Hav', 'Elvira', 'Lina', 'Omar'],
    ['Järv', 'Maj', 'Disa', 'Ruben'],
    ['Klint', 'Nellie', 'Selma', 'Hannes'],
    ['Löv', 'Elsa', 'Freja', 'Adam'],
    ['Nyberg', 'Tuva', 'Agnes', 'Joel'],
    ['Rönn', 'Lo', 'Malin', 'David'],
    ['Sund', 'Rut', 'Elin', 'Leo'],
  ];
  const families: Family[] = names.map((name, index) => ({
    id: `family-${index + 1}`,
    label: `${name[1]} ${name[0]}`,
    active: true,
    exempt: index === 11,
    ...(index === 8
      ? {
          unavailable: [
            { startsAt: '2026-10-03T00:00:00+02:00', endsAt: '2026-10-03T23:59:00+02:00' },
          ],
        }
      : {}),
  }));
  const children = names.flatMap((name, index) =>
    name[1]
      .split(' & ')
      .map((child, childIndex) => ({
        id: `child-${index + 1}-${childIndex + 1}`,
        name: `${child} ${name[0]}`,
        familyId: families[index].id,
        active: true,
      })),
  );
  const adults: Adult[] = names.flatMap((name, index) =>
    [name[2], name[3]].map((adult, adultIndex) => ({
      id: `adult-${index + 1}-${adultIndex + 1}`,
      name: `${adult} ${name[0]}`,
      phone: `070000${String(index * 2 + adultIndex + 1).padStart(4, '0')}`,
      familyIds: [families[index].id],
      active: true,
    })),
  );
  const roles: Role[] = [
    {
      id: 'kiosk',
      name: 'Kiosk',
      instructions:
        'Bemanna kiosken, hjälp besökare och fyll på varor. Följ caféets rutiner för öppning och stängning. Sista passet gör inventering.',
    },
    {
      id: 'parking',
      name: 'Parkeringsvärd',
      instructions:
        'Vägled besökare till rätt parkering och förhindra felparkering längs Pinntorpsvägen. Håll in- och utfarter fria för räddningstjänsten. När IP:s parkering är full dirigeras trafiken om direkt vid infarten.',
    },
    {
      id: 'runner',
      name: 'Löpare',
      instructions:
        'Hjälp övrig bemanning med praktiska uppgifter: töm papperskorgar, fyll på papper på toaletterna och hjälp cafépersonalen med enklare ärenden.',
    },
    {
      id: 'host',
      name: 'Matchvärd',
      instructions:
        'Välkomna lag och besökare, visa vägen till planerna och bidra till en trygg och vänlig stämning.',
    },
    {
      id: 'build',
      name: 'Sargbygge',
      instructions:
        'Hjälp till att bygga sarg och förbereda spelplanerna enligt ansvarig ledares anvisningar.',
    },
    {
      id: 'dismantle',
      name: 'Sargrivning',
      instructions:
        'Plocka ner och ställ undan sargen efter sista matchen. Hjälps åt och följ ansvarig ledares anvisningar.',
    },
    {
      id: 'decorate',
      name: 'Pynta lokalen',
      instructions: 'Hjälp till med halloweenpynt, bord och ljus innan gästerna kommer.',
    },
    {
      id: 'games',
      name: 'Lekstation',
      instructions: 'Ta hand om en lekstation och se till att alla barn får vara med.',
    },
    {
      id: 'snacks',
      name: 'Fika & snacks',
      instructions: 'Servera fika och snacks. Kontrollera allergiinformation före servering.',
    },
  ];
  const slot = (id: string, familyNumber?: number, confirmed = false, adultNumber = 1): Slot => {
    const adult = familyNumber
      ? adults.find((adult) => adult.id === `adult-${familyNumber}-${adultNumber}`)
      : undefined;
    return {
      id,
      ...(familyNumber ? { familyId: `family-${familyNumber}` } : {}),
      ...(confirmed && adult
        ? {
            adultId: adult.id,
            adultName: adult.name,
            adultPhone: adult.phone,
            confirmedAt: '2026-09-18T18:15:00Z',
            confirmedRevision: 1,
          }
        : {}),
      locked: false,
      revision: 1,
      status: confirmed ? 'confirmed' : 'pending',
    };
  };
  const shift = (
    id: string,
    roleId: string,
    startsAt: string,
    endsAt: string,
    slots: Slot[],
  ): Shift => {
    const role = roles.find((role) => role.id === roleId)!;
    return {
      id,
      roleId,
      roleName: role.name,
      instructions: role.instructions,
      startsAt,
      endsAt,
      slots,
    };
  };
  const event = (id: string, details: EventDetails, published: boolean): PortalEvent => ({
    id,
    draft: clone(details),
    ...(published ? { published: clone(details) } : {}),
    publication: published ? 1 : 0,
    cancelled: false,
    updatedAt: '2026-09-18T17:00:00Z',
  });
  const sammandrag = event(
    'sammandrag-oktober',
    {
      title: 'Höstens sammandrag',
      location: 'Landvetter IP',
      startDate: '2026-10-04',
      endDate: '2026-10-04',
      description:
        'En söndag med fotboll och laganda! Kom tio minuter före ditt pass. Den som avslutar kioskens sista pass gör inventering. Alla uppgifter här är påhittad demodata.',
      shifts: [
        shift('oct-kiosk-1', 'kiosk', '2026-10-04T08:00:00+02:00', '2026-10-04T10:00:00+02:00', [
          slot('oct-slot-1', 1, true),
          slot('oct-slot-2', 2, true),
        ]),
        shift('oct-park-1', 'parking', '2026-10-04T08:00:00+02:00', '2026-10-04T10:00:00+02:00', [
          slot('oct-slot-3', 3),
        ]),
        shift('oct-run-1', 'runner', '2026-10-04T08:00:00+02:00', '2026-10-04T10:00:00+02:00', [
          slot('oct-slot-4', 4),
        ]),
        shift('oct-kiosk-2', 'kiosk', '2026-10-04T10:00:00+02:00', '2026-10-04T12:00:00+02:00', [
          slot('oct-slot-5', 5, true, 2),
          slot('oct-slot-6', 6),
        ]),
        shift('oct-park-2', 'parking', '2026-10-04T10:00:00+02:00', '2026-10-04T12:00:00+02:00', [
          slot('oct-slot-7', 7),
        ]),
        shift('oct-run-2', 'runner', '2026-10-04T10:00:00+02:00', '2026-10-04T12:00:00+02:00', [
          slot('oct-slot-8', 8),
        ]),
        shift('oct-kiosk-3', 'kiosk', '2026-10-04T12:00:00+02:00', '2026-10-04T14:00:00+02:00', [
          slot('oct-slot-9', 9),
          slot('oct-slot-10', 10, true),
        ]),
        shift('oct-park-3', 'parking', '2026-10-04T12:00:00+02:00', '2026-10-04T14:00:00+02:00', [
          slot('oct-slot-11', 11),
        ]),
        shift('oct-run-3', 'runner', '2026-10-04T12:00:00+02:00', '2026-10-04T14:00:00+02:00', [
          slot('oct-slot-12'),
        ]),
      ],
    },
    true,
  );
  const cafe = event(
    'cafe-vecka40',
    {
      title: 'Cafévecka 40',
      location: 'Klubbhuset, Landvetter IP',
      startDate: '2026-09-28',
      endDate: '2026-10-04',
      description:
        'Laget bemannar caféet hela veckan. Vardagar 17–21 och helgpass enligt schemat. Sista personen inventerar innan stängning.',
      shifts: [
        shift('cafe-mon', 'kiosk', '2026-09-28T17:00:00+02:00', '2026-09-28T21:00:00+02:00', [
          slot('cafe-slot-1', 7, true),
        ]),
        shift('cafe-tue', 'kiosk', '2026-09-29T17:00:00+02:00', '2026-09-29T21:00:00+02:00', [
          slot('cafe-slot-2', 8),
        ]),
        shift('cafe-wed', 'kiosk', '2026-09-30T17:00:00+02:00', '2026-09-30T21:00:00+02:00', [
          slot('cafe-slot-3', 9),
        ]),
        shift('cafe-thu', 'kiosk', '2026-10-01T17:00:00+02:00', '2026-10-01T21:00:00+02:00', [
          slot('cafe-slot-4', 10),
        ]),
        shift('cafe-fri', 'kiosk', '2026-10-02T17:00:00+02:00', '2026-10-02T21:00:00+02:00', [
          slot('cafe-slot-5', 11),
        ]),
        shift('cafe-sat', 'kiosk', '2026-10-03T09:00:00+02:00', '2026-10-03T12:00:00+02:00', [
          slot('cafe-slot-6', 1),
          slot('cafe-slot-7', 2),
        ]),
        shift('cafe-sun', 'kiosk', '2026-10-04T15:00:00+02:00', '2026-10-04T17:00:00+02:00', [
          slot('cafe-slot-8', 3),
        ]),
      ],
    },
    true,
  );
  const halloween = event(
    'halloween',
    {
      title: 'Halloween med laget',
      location: 'Klubblokalen',
      startDate: '2026-10-31',
      endDate: '2026-10-31',
      description:
        'Pumpor, lekar och en lagom läskig eftermiddag. Arbetsutkast – tider och bemanning kan fortfarande ändras.',
      shifts: [
        shift(
          'halloween-decorate',
          'decorate',
          '2026-10-31T14:00:00+01:00',
          '2026-10-31T16:00:00+01:00',
          [slot('halloween-slot-1'), slot('halloween-slot-2')],
        ),
        shift(
          'halloween-games',
          'games',
          '2026-10-31T16:00:00+01:00',
          '2026-10-31T18:00:00+01:00',
          [slot('halloween-slot-3'), slot('halloween-slot-4')],
        ),
        shift(
          'halloween-snacks',
          'snacks',
          '2026-10-31T16:00:00+01:00',
          '2026-10-31T18:00:00+01:00',
          [slot('halloween-slot-5')],
        ),
      ],
    },
    false,
  );
  const counts = [3, 2, 1, 4, 2, 1, 0, 0, 2, 3, 1, 2];
  const history = families.flatMap((family, familyIndex) =>
    Array.from({ length: counts[familyIndex] }, (_, entryIndex) => ({
      id: `demo-history-${familyIndex + 1}-${entryIndex + 1}`,
      familyId: family.id,
      assignmentId: `demo-assignment-${familyIndex + 1}-${entryIndex + 1}`,
      eventTitle: ['Vårens sammandrag', 'Cafévecka 19', 'Sommarcupen', 'Höststart'][entryIndex],
      roleName: roles[(familyIndex + entryIndex) % 3].name,
      startsAt: `2026-${String(4 + entryIndex).padStart(2, '0')}-18T08:00:00+02:00`,
      endsAt: `2026-${String(4 + entryIndex).padStart(2, '0')}-18T11:00:00+02:00`,
      source: 'import' as const,
      verified: true,
    })),
  );
  return {
    version: 1,
    team: {
      id: 'landvetter-demo',
      slug: 'landvetter-demo',
      name: 'P2018',
      clubName: 'Landvetter IS',
      contactName: 'Lagföräldern (demo)',
      contactPhone: '0700000099',
      reminderDays: [7, 1],
    },
    families,
    children,
    adults,
    roles,
    events: [sammandrag, cafe, halloween],
    history,
    requests: [
      {
        id: 'demo-request-1',
        eventId: sammandrag.id,
        slotId: 'oct-slot-6',
        familyId: 'family-6',
        message: 'Vi behöver hjälp att hitta en ersättare till detta pass.',
        requestedAt: '2026-09-19T13:00:00Z',
        status: 'open',
      },
    ],
    audit: [
      {
        id: 'audit:1',
        at: '2026-09-18T17:00:00Z',
        actor: 'admin',
        action: 'demo_created',
        summary: 'Påhittat demonstrationslag skapades.',
      },
    ],
  };
}
