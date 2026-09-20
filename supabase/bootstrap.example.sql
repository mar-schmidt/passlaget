-- Run deliberately in the SQL editor AFTER applying migrations.
-- Creates P2018 with standard roles, no user accounts or personal data.
-- Repeat does not overwrite existing data. VITE_TEAM_SLUG=landvetter-p2018.
insert into portal_private.teams (id,slug,version,state) values (
  'landvetter-p2018', 'landvetter-p2018', 0,
  $state${
  "version": 0,
  "team": {
    "id": "landvetter-p2018",
    "slug": "landvetter-p2018",
    "name": "P2018",
    "clubName": "Landvetter IS",
    "contactName": "Lagförälder",
    "contactPhone": "",
    "reminderDays": [
      7,
      1
    ]
  },
  "families": [],
  "children": [],
  "adults": [],
  "roles": [
    {
      "id": "kiosk",
      "name": "Kiosk",
      "instructions": "Bemanna kiosken, hjälp besökare och fyll på varor. Följ caféets rutiner för öppning och stängning. Sista passet gör inventering."
    },
    {
      "id": "parking",
      "name": "Parkeringsvärd",
      "instructions": "Vägled besökare till rätt parkering och förhindra felparkering längs Pinntorpsvägen. Håll in- och utfarter fria för räddningstjänsten. När IP:s parkering är full dirigeras trafiken om direkt vid infarten."
    },
    {
      "id": "runner",
      "name": "Löpare",
      "instructions": "Hjälp övrig bemanning med praktiska uppgifter: töm papperskorgar, fyll på papper på toaletterna och hjälp cafépersonalen med enklare ärenden."
    },
    {
      "id": "host",
      "name": "Matchvärd",
      "instructions": "Välkomna lag och besökare, visa vägen till planerna och bidra till en trygg och vänlig stämning."
    },
    {
      "id": "build",
      "name": "Sargbygge",
      "instructions": "Hjälp till att bygga sarg och förbereda spelplanerna enligt ansvarig ledares anvisningar."
    },
    {
      "id": "dismantle",
      "name": "Sargrivning",
      "instructions": "Plocka ner och ställ undan sargen efter sista matchen. Hjälps åt och följ ansvarig ledares anvisningar."
    }
  ],
  "events": [],
  "history": [],
  "requests": [],
  "audit": []
}$state$::jsonb
) on conflict (id) do nothing;

-- First create the administrator in Auth / Users. Registration is disabled.
-- Then replace the placeholder and run this statement separately:
-- insert into portal_private.admin_memberships(team_id,user_id)
-- values ('landvetter-p2018','REPLACE-WITH-ADMIN-AUTH-UUID'::uuid) on conflict do nothing;
