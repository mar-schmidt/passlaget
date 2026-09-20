# Sätt Passlaget i drift

Budget: **0 kr**. Använd ett publikt repository på GitHub Free, en separat organisation med **Supabase Free**, och aktivera mejl först senare när avsändare har valts. Aktivera ingen betalplan eller provperiod som övergår i betalning.

## Aktuell driftsättning

- Portal: https://mar-schmidt.github.io/passlaget/
- Supabase: **Passlaget**, organisation **Passlaget**, projekt `erddjmgwlwdcqtunlepa`, Stockholm (`eu-north-1`), **Free / 0 kr per månad** vid skapandet 2026-09-20.
- Lag: Landvetter IS P2018 (`landvetter-p2018`), med sex grunduppdrag och ett administratörskonto. Familjer och historik har inte importerats ännu.
- Serverfunktionen `portal` är publicerad. Självregistrering och anonym Auth-inloggning är avstängda; de öppna föräldraåtgärderna kräver inget konto.
- Både `MAIL_ENABLED` och `VITE_MAIL_ENABLED` är `false`. Ingen mejlarbetare är installerad.
- GitHub Pages använder `gh-pages`. Repositoryts publika anslutningsvariabler är konfigurerade; Actions-mallen väntar fortfarande på `workflow`-behörighet.
- `.env.production.local` konfigurerar produktionsbygget på den här Macen. Vanlig lokal utveckling visar fortsatt demo. Privata inloggningsuppgifter och driftfiler ligger under `.local/supabase-production/`, som inte följer med Git eller webbbygget.

Supabase CLI är inloggat lokalt. Projektet är ännu inte länkat för direkt databasanslutning; vid underhåll via Management API används alltid `--project-ref erddjmgwlwdcqtunlepa`, och för SQL även `--linked`. Kör inte kommandon utan att kontrollera målet. Webbbygget publiceras separat från serverfunktionen.

## 1. Skapa databasen

1. Skapa organisationen **Passlaget** hos Supabase och välj Free. Skapa ett projekt i en tillgänglig EU-region. Den nuvarande installationen är redan skapad enligt uppgifterna ovan; stegen här används vid en ny installation.
2. Anslut med Supabase CLI och kontrollera projektreferensen innan migrationen körs. Ersätt platshållare, använd inga hemligheter i källkod.

```sh
npx supabase login
npx supabase link --project-ref DIN_PROJEKTREFERENS
npx supabase db push
```

3. Kör `supabase/bootstrap.example.sql` i projektets SQL-editor. Det skapar ett tomt lag med grunduppdrag. Samma skript ersätter aldrig ett befintligt lag.
4. Skapa administratören under Authentication → Users och koppla användarens UUID till laget enligt kommentaren i bootstrapfilen. Inget publikt registreringsflöde behövs. Stäng av nya registreringar i Auth-inställningarna.
   För CLI-konfiguration: behåll `[auth].enable_signup=false`, men använd `[auth.email].enable_signup=true` för att låta befintliga konton logga in. Den senare inställningen styr även e-postleverantörens inloggning; den globala spärren hindrar nya konton.
5. Ange portalens slutliga adress som Auth Site URL och tillåten redirect, exempelvis `https://mar-schmidt.github.io/passlaget/`. Den måste matcha `APP_URL` exakt.

## 2. Koppla serverfunktionen

Skapa en privat fil `.local/backend.env` utifrån `supabase/functions/.env.example`. Sätt `APP_URL` till portalens fullständiga adress och `PORTAL_ORIGINS` till dess ursprung. Behåll `MAIL_ENABLED=false`. Inga mejlhemligheter behövs då. När mejl senare aktiveras behövs två separata slumpmässiga hemligheter på minst 32 tecken för `MAIL_WORKER_SECRET` och `MAIL_TOKEN_SECRET`. [Backendguiden](BACKEND.md) beskriver alla värden.

```sh
npx supabase secrets set --env-file .local/backend.env
npx supabase functions deploy portal --use-api
```

Flaggan `--use-api` använder CLI:ns stöd för att paketera de delade TypeScript-filerna utanför själva funktionskatalogen. Kör kommandot från projektroten. `verify_jwt = false` finns i funktionskonfigurationen eftersom föräldraåtgärderna är öppna; administratörens JWT och lagbehörighet kontrolleras inne i funktionen.

Kör Supabase Security/Performance Advisors och anslutningskontrollerna i [ACCEPTANCE.md](ACCEPTANCE.md) före riktiga uppgifter. En godkänd lokal SQL-kontroll ersätter inte detta.

## 3. Publicera på GitHub Pages

Portalen publiceras manuellt från grenen `gh-pages`. Nuvarande GitHub-inloggning nekade uppladdning av `.github/workflows/pages.yml` eftersom dess `workflow`-behörighet saknas. Definitionen finns därför redo i `deployment/pages.yml`. När kontoägaren har gett den rättigheten flyttas filen till `.github/workflows/pages.yml` och GitHub Pages ändras från grenen `gh-pages` till **GitHub Actions**.

Det medföljande arbetsflödet bygger enbart `dist/`. Det laddar inte upp `.local/`, PDF-filer, serverhemligheter eller databasen. Backend publiceras separat.

I repositoryts Settings → Secrets and variables → Actions → **Variables**, ange:

| Variabel                        | Värde                                                                  |
| ------------------------------- | ---------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | Projektets `https://…supabase.co`-adress                               |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publicerbar Supabase-nyckel, aldrig secret/service_role                |
| `VITE_MAIL_ENABLED`             | `false` tills mejl aktiveras på servern och avsändaren är konfigurerad |
| `VITE_TEAM_SLUG`                | `landvetter-p2018`                                                     |

Efter aktivering av arbetsflödet: välj **GitHub Actions** som källa i GitHub Pages. Kör sedan arbetsflödet **Publicera Passlaget**. Det kör tester, bygger med `/passlaget/` som bas och publicerar. Ändra basadressen om repositoryt byter namn. Saknas båda Supabase-värdena publiceras en tydligt märkt, lokal demonstration; om bara ett värde finns avbryter byggkontrollen.

En publicerbar nyckel är avsedd för webbläsaren. Säkerheten ligger i behörighetskontrollerna och de privata tabellerna. **Lägg aldrig en hemlig backendnyckel i en `VITE_`-variabel.**

Hashadresser, till exempel `#/foraldrar`, fungerar utan serveromskrivningar på GitHub Pages. Återställning och mejlverifiering landar på portalens vanliga basadress.

Till dess uppdateras `gh-pages` från ett kontrollerat `npm run build` med `VITE_BASE_PATH=/passlaget/`. Lägg bara `dist/` och en tom `.nojekyll` på den grenen, aldrig projektroten. Bevara branchhistoriken och kontrollera publiceringens status i GitHub Pages.

För lokal anslutning kopieras `.env.example` till `.env.local`, fylls i och utvecklingsservern startas om. Håll `VITE_BASE_PATH=/` lokalt.

## 4. Importera och aktivera mejl senare

Första driftsättningen sker utan mejl. Kalenderexport, bekräftelser, planering och kontaktuppgifter fungerar ändå. Nya mejljobb skapas inte under tiden. Lösenordsåterställning via mejl är inte tillgänglig; kontoägaren kan hjälpa administratören via Supabase Auth.

När mejl ska aktiveras: följ [MAIL.md](MAIL.md) och installera Google-arbetaren. Kontoägaren behöver själv godkänna Google-behörigheten. Använd en testadress som kontoägaren har godkänt för det första verkliga utskicket. UI:ns status "Skickat" betyder att MailApp accepterat sändningen, inte att mottagaren läst eller fått den.

Förbered och granska importen enligt [IMPORT.md](IMPORT.md). Riktiga personuppgifter finns endast i den lokala privata mappen, inte i demot. Kontrollera oklarheter innan registret sparas. Bekräfta historiska genomföranden per familj innan de räknas.

## Backup och återställning

Ta en JSON-export via **Rättvis fördelning → Säkerhetskopia** före större registerändringar och efter genomförda evenemang. Den innehåller portalens register och historik, men **inte** Auth-användare, prenumerationer och mejljournal. För fullständig backup behövs även en privat databasexport.

Använd Supabases anslutningssträng från Connect och en lokal `pg_dump` med samma huvudversion som databasen. Ange lösenord med lokal säker inmatning eller `.pgpass` med rättigheter `0600`; lägg det aldrig i en sparad kommandofil. Förvara exporten utanför repositoryt.

```sh
pg_dump --host=DIN_POOLER_HOST --port=5432 --username=postgres.DIN_PROJEKTREFERENS --dbname=postgres --schema=portal_private --format=custom --file=.local/passlaget-private.dump
```

Återställ först i en **isolerad lokal Supabase-miljö**, med mejlarbetaren pausad. Tillämpa migrationerna, skapa testadministratören, återställ privata tabellers data och återknyt medlemskapet till rätt Auth-UUID. `auth.users` omfattas inte av portalexporten och ska hanteras enligt Supabases rekommenderade kontoåterställning. Läs igenom `pg_restore --list` och kontrollera att exporten avser rätt lag innan data återställs. Återställ aldrig gamla köposter direkt till en aktiv avsändare.

Pausa utskicksrutinen, stäm av dess lokala kvitton och låt ingen administratör redigera medan återställning pågår. Att pausa en trigger avbryter inte en redan pågående körning; aktiva mejllås måste avslutas eller stämmas av först.

En JSON-export kan kontrolleras och återställas lokalt med det medföljande verktyget:

```sh
node scripts/restore-backup.mjs .local/passlaget-sakerhetskopia.json .local/restore-portal.sql
```

Verktyget skriver en transaktion som återställer portalens lagdata. Den ska först provas lokalt. Den återställer inte mejlprenumerationer eller Auth och tar inte bort ett lag. En återställning höjer den aktuella versionen så gamla öppna webbläsarfönster måste läsa om. Gamla väntande utskick stoppas och skickade bevaras. Granska schemat och kön före omstart: stoppade påminnelser återköas inte automatiskt, eftersom deras dubblettskydd finns kvar. En uttrycklig ny planering av påminnelser kan behövas.

## Avbrott och överlämning

- Om projektet pausats: återaktivera det i Supabase, kontrollera att läsning och sparande fungerar, granska osäkra utskick och aktivera Google-arbetaren igen. Det finns ingen garanti att bakgrundskörningar förhindrar paus.
- Vid full mejlkvot ligger väntande utskick kvar. Granska kön innan sena notiser skickas; passerade rutinpåminnelser stoppas vid sändningskontrollen.
- Om en sändning är osäker: pausa Google-triggern, kontrollera dess kvitton och avsändarkontot, välj sedan **Redan skickat**, **Försök igen** eller **Stoppa** i portalen.
- Vid ny lagförälder: lägg till den nya administratören, prova behörigheten, överlämna privat backup och kontrollera avsändarkonto och trigger. Ta bort den gamla administratörens medlemskap när överlämningen är klar.
- Följ kvoter på tjänsternas egna Free-översikter. Byt aldrig till en betalnivå automatiskt.

Officiella referenser: [GitHub Pages med Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Supabase CLI](https://supabase.com/docs/reference/cli/introduction), [Supabase-backuper](https://supabase.com/docs/guides/platform/backups), [Google-kvoter](https://developers.google.com/apps-script/guides/services/quotas).
