# Passlaget

**Små insatser. Mer plats för laget.**

[GitHub-projekt](https://github.com/mar-schmidt/passlaget)

En svensk, mobilanpassad portal för föreningens bemanning. Planera cuper, caféveckor och egna evenemang, fördela uppdrag mellan familjer och låt föräldrar bekräfta vem som kommer via en gemensam länk.

Den publicerade portalen är ansluten till Supabase Free i Stockholm. Administration kräver inloggning. Laget är skapat med grunduppdrag; familjeregistret och historiken väntar på granskning av importunderlaget. Mejl är avstängt.

## Prova lokalt

Kräver Node.js 22.12 eller senare och npm.

```sh
npm ci
npm run dev
```

Öppna adressen som visas, normalt `http://127.0.0.1:5173/`. Utan anslutningsuppgifter startar ett **tydligt märkt demo med påhittade familjer**. Välj en familj för att bekräfta pass eller tryck på **Administration** för att prova planeringen. Demot behöver inget lösenord och sparar bara i den egna webbläsaren. Det skickar inga mejl.

En ansluten portal använder Supabase Auth för administration. Föräldrasidan är öppen enligt produktens krav: familjeval är ett filter, inte en kontroll av vem besökaren är. Telefonuppgifter i publicerade uppdrag är synliga för alla som besöker portalen. Privat historik, utkast, mejladresser och administrativa uppgifter skyddas separat på servern.

## Funktioner

- Familjeregister med barn, vuxna, syskon, kontaktuppgifter, avslutat medlemskap och undantag för exempelvis ledarfamiljer.
- Flerdagarsevenemang, egna uppdrag, pass med exakta tider och valfritt antal vuxna, kopiering och markering av andra lags bemanning.
- Manuell bemanning och automatisk fördelning efter genomförda och reserverade pass. Varje pass väger lika; syskon delar saldo. Hänsyn till förhinder och överlappande uppdrag.
- Arbetsutkast och separat publicerat schema. Förändrade uppdrag kräver ny bekräftelse. Samtidiga ändringar får en tydlig konflikt i stället för att skriva över varandra.
- Enkel föräldrabekräftelse, byte av ansvarig vuxen, bytesförfrågningar och gemensamt schema.
- Matchdagen: välj familj en gång och se det egna uppdraget tillsammans med evenemangets bemanning. Datumspalt, tydliga rollrader och samtliga familjepass samlade i en enkel lista. Administrationen har en separat meny.
- En kalenderknapp för varje uppdrag: Google Kalender eller ICS för kompatibla kalenderappar. Kopian uppdateras inte automatiskt.
- Privat mejladress per vuxen, obligatorisk vid bekräftelse. Tilldelningar och ändringar skickas till familjens kontaktadresser, eller vald vuxen. Enskilda påminnelser om saknade svar finns under **Svar & uppföljning**. Gmail behöver vara anslutet för själva utskicken.
- Historik, kontroll av importerade insatser, balans per familj och export.

## Kostnadsfri drift

Portalen använder **GitHub Pages + Supabase Free**. Ingen köpt domän eller betalplan behövs. Ett anslutet Supabase-projekt krävs för gemensam lagring. Google Apps Script/MailApp används som kostnadsfri mejlavsändare. Portalen fungerar även utan mejl. Gratiskvoter och eventuellt pausat Supabase-projekt kan ge tillfälliga avbrott.

1. Följ [driftguiden](docs/DEPLOYMENT.md) för GitHub Pages och Supabase Free.
2. Vid en ny installation: behåll `MAIL_ENABLED=false` på servern och `VITE_MAIL_ENABLED=false` i webbbygget tills avsändaren är ansluten enligt [mejlguiden](docs/MAIL.md). I avstängt läge skapas inga mejljobb och lösenordsåterställning via mejl väntar. Landvetter-installationens avsändare har godkänts och mejl är aktiverat från 2026-09-21.
3. Granska och importera det privata underlaget enligt [importguiden](docs/IMPORT.md).
4. Genomför [kontrollerna före pilot](docs/ACCEPTANCE.md), inklusive faktiska mobilkalendrar. Utskick kontrolleras först när mejl ska aktiveras.

Portalen publiceras manuellt från `gh-pages`. Det automatiska publiceringsflödet finns färdigt i `deployment/pages.yml`; nuvarande GitHub-inloggning saknar rättigheten att aktivera workflow-filer. Se driftguiden för aktivering.

Källkod och demo får ligga publikt. **Käll-PDF, riktiga familjer, importfiler, säkerhetskopior och hemligheter får aldrig läggas i repositoryt eller webbbygget.** Lokala privata filer ligger i `.local/`, som ignoreras av Git. Frontendens `VITE_`-värden blir offentliga; använd bara projektadress och publicerbar nyckel där.

## Kontroller och struktur

```sh
npm run check
```

Det kör domän-, kalender-, gränssnitts- och serverhjälpartester, tester av Google-arbetaren, databasbehörigheter och verklig återställning i lokal Postgres-testmotor samt ett produktionsbygge. [Backendguiden](docs/BACKEND.md) beskriver separat Deno-kontroll och SQL-test i en inbäddad Postgres-motor. Ingen test skickar riktiga mejl.

| Katalog         | Innehåll                                                         |
| --------------- | ---------------------------------------------------------------- |
| `src/features/` | Föräldrasida, administration och svenska formulär                |
| `src/domain/`   | Gemensamma regler, kalenderexport, påhittad demo och tester      |
| `supabase/`     | Migration, behörigheter, serverfunktion, utskickskö och SQL-test |
| `apps-script/`  | Google MailApp-arbetare och dess tester                          |
| `scripts/`      | Lokal förberedelse av privata importfiler                        |
| `docs/`         | Drift, import, mejl och acceptanskontroller                      |

[Den godkända implementationsplanen](IMPLEMENTATIONSPLAN.md) beskriver avgränsningar och produktval. Flera lag är förberedda i serverns behörighetsmodell; självbetjäning för att ansluta nya lag ingår inte.

## Namnet

Passlaget valdes som ett namn som fungerar även för andra föreningar. Vid kontroll på GitHub den 20 september 2026 hittades inget publikt repository med namnet, och `mar-schmidt/passlaget` var ledigt. Det är en kontroll av GitHub-namnet, inte en varumärkesundersökning.
