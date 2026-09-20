# Import från PDF-exporten

Importen har två skilda steg: ta fram ett privat granskningsunderlag och föra in granskade uppgifter i portalen. Ett gammalt schema visar planerad bemanning; det räcker inte som bevis på att arbetet utfördes.

## Skapa privat underlag

Använd Python 3.9 eller senare med `pypdf` installerat. Ingen databasanslutning behövs. Kör från projektets rot:

```sh
python3 scripts/prepare-import.py '/sökväg/till/Schema Bemanning 2026.pdf'
```

På Codex-datorn kan den befintliga paketerade Python-miljön användas:

```sh
/Users/marcus/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/prepare-import.py '/sökväg/till/Schema Bemanning 2026.pdf'
```

Skriptet läser alla PDF-sidor. Svenskspråkiga kolumnrubriker identifierar register och scheman. Ändras PDF-layouten måste granskningsunderlaget kontrolleras igen. Tidszon är `Europe/Stockholm`; sommar- och vintertid följer kalenderdatumet.

Allt resultat hamnar i **`.local/import/`**, som ska finnas i `.gitignore`. Skriptet tillåter inte resultat utanför en `.local`-katalog. Kontrollera att katalogen verkligen är ignorerad innan du sparar eller skickar kod. Lägg aldrig export-PDF, personuppgifter eller importfiler under `src`, `public`, dokumentation, testdata eller GitHub Actions-artifakter.

| Fil               | Innehåll                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `candidate.json`  | Importkandidat med `families`, `children`, `adults`, `history`. Alla historikposter har `verified: false`. |
| `review.md`       | Läsbar genomgång av antal, familjesaldon och osäkra uppgifter.                                             |
| `review.json`     | Fullständiga avvikelser, årtalslösa schemarader, möjliga dubbletter och bortvalda rader.                   |
| `page-1.txt` osv. | Text från varje PDF-sida för jämförelse med originalet.                                                    |

`candidate.json` har också `_review` med originalfilens namn, kontrollsumma och sid-/radhänvisningar. Detta är granskningsmetadata; grundmodellen använder de fyra importlistorna. ID:n bygger på normaliserade namn och innehåll, så samma oförändrade underlag skapar samma ID:n vid en ny körning. Om ett namn rättas i en redan importerad post ska befintligt ID bevaras för att undvika en ny person.

## Granska innan import

1. Öppna `review.md` bredvid original-PDF:en. Kontrollera att antal registerrader och historikposter stämmer med de aktuella sidorna.
2. Kontrollera familjekopplingar. Ett uttryckligt syskonpar i underlaget kan dela familj. Två barn med samma efternamn eller telefonnummer kopplas inte automatiskt ihop. Gemensamma pass räknas en gång, även om de två barnens sammanställningar visar samma saldo.
3. Granska aktiva och avslutade barn. Namn som bara finns i äldre historik läggs in som inaktiva tills statusen bekräftats. Liknande stavningar och motstridiga medlemsmarkeringar hålls isär; de kan avse olika barn.
4. Granska ledarundantagen utifrån det aktuella registrets markeringar. Äldre sidotabeller i PDF:en kan vara inaktuella.
5. Kontrollera vuxnas namn och telefonnummer. En annan namngiven förälder blir en separat vuxen, även om familjen delar nummer. Ett gammalt annat nummer bevaras som en konflikt i granskningsfilen. Saknas namn sparas kontakten för granskning, utan att en person hittas på.
6. Kontrollera de årtalslösa schemaraderna. De finns i `review.json` och påverkar inte historiksaldot. Möjliga kopior av daterade schemarader räknas inte igen. Ge eventuella kommande evenemang ett verifierat årtal och konkreta sluttider när de skapas i portalen. ”Stängning” är ingen exakt tid.
7. Kontrollera varje historikpost som ska påverka rättvisefördelningen, men behåll `verified: false` i importfilen. Bekräfta genomförandet per familj i portalens historik efter importen. Nya poster från en fil räknas inte automatiskt som genomförda, även om filen innehåller `verified: true`. Redan verifierade poster i portalen behåller sin verifiering vid återimport. Registerkolumnen ”Tillfällen” används bara för jämförelse och skapar aldrig ytterligare insatser. ”Skapad” används inte som barnets startdatum.
8. Kontrollera att tomma extrarader, andra lags bemanning och allmänna rader som ”ledare” inte har blivit extra personplatser eller insatser. Daterad historik med samma familj, roll och tid dedupliceras. Om samma familj faktiskt bemannade två olika personplatser samtidigt behöver detta bekräftas och ges olika tilldelnings-ID:n manuellt.

Spara godkända ändringar i en separat **`.local/import/approved.json`** så att nästa körning av förberedelseskriptet inte skriver över granskningen. Behåll gamla ID:n när du rättar namn, kopplingar och telefonnummer. Vid sammanslagning av familjer uppdateras `familyId` på barn och historik samt `familyIds` på vuxna; ta bort den överflödiga familjen och eventuella dubbla historikposter.

## För in granskad fil

1. Logga in som administratör och öppna importfunktionen i portalen. Välj `approved.json` från den egna datorn. Filen ska inte laddas upp som offentlig webbfil.
2. Granska förhandsvisade antal, familjekopplingar och kontaktuppgifter. Nya historikposter börjar som okontrollerade och ska inte påverka fördelningen ännu.
3. Bekräfta importen. Uppgifter kopplas till det valda laget. Importen aktiverar inga mejlprenumerationer, skickar inga påminnelser och publicerar inga evenemang.
4. Öppna **Rättvis fördelning**, välj familjen och använd **Bekräfta genomförande** för varje historiskt pass som har stämts av. Låt osäkra poster vara okontrollerade. Läs särskilt igenom familjer med två barn, två olika vuxna och ledarundantag. Bekräfta att endast godkända genomförda pass påverkar saldot.
5. Gör om importen med samma fil i en testmiljö: antalen och saldona ska vara oförändrade. Om något redan har redigerats i portalen bör en ny import först jämföras mot de aktuella uppgifterna så att äldre kontaktuppgifter inte återinförs.

Spara privat backup före större registerimport. Behåll original och granskning på en lämplig privat plats. Skriptet läser referens-PDF:en utan att ändra den.
