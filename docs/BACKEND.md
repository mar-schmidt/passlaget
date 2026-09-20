# Backend för Passlaget

Backend är byggd för ett separat **Supabase Free-projekt**. Filerna skapar inga molnresurser eller betaltjänster. Samma domänregler används i webbdemot och serverfunktionen; servern läser alltid det lagrade tillståndet och kör kommandot igen. Klientens färdigberäknade schema accepteras aldrig som auktoritet.

## Databas och lagisolering

`portal_private.teams` lagrar ett versionerat `PortalState` som JSONB per lag. Familj, barn, vuxna, evenemang, historik och ändringslogg hör därmed till en enda sammanhängande transaktion. Upplägget är avsiktligt enkelt för små lag: varje ändring skriver om lagets tillstånd och kräver rätt versionsnummer. Även aktivering av en mejlprenumeration höjer versionen, så att en samtidig publicering inte missar den nya mottagaren. Samtidiga ändringar av samma lag ger HTTP 409 och kräver omläsning, aldrig tyst överskrivning. Servern tar inte automatiskt om ett inaktuellt beslut.

Fältet `team.id` och lagets `slug` är oföränderliga. JSONB har en gräns på 4 MB per sparning; det är ett skydd mot orimliga begäranden, inte en ersättning för Supabase-kvoter. Vid många lag eller mycket stor historik kan evenemang och historik flyttas till normaliserade tabeller utan att ändra portalens kommandon.

Separata privata tabeller innehåller:

- `admin_memberships`: vilka Auth-användare som får administrera vilket lag.
- `subscriptions`: familj/vuxen, mejladress, val och bekräftat medgivande.
- `outbox`: beständiga mejljobb, schemalagd tid, utskicksstatus och låsning.
- `mail_resolutions`: spårbar administratörsbedömning av misslyckade/osäkra utskick.
- `rate_limits` och `worker_health`: begränsning av försök och senaste körning.

Alla privata tabeller har RLS och saknar rättigheter och policyer för `anon`/`authenticated`. Schemat exponeras inte via Data API. Den enda RPC-funktionen i `public`, `portal_backend`, är `SECURITY INVOKER` och har uttryckligen återkallad `EXECUTE` för alla browserroller. Bara `service_role` får köra den. Backendnyckeln stannar i Edge Functions. En begränsad kolumnrättighet till `auth.users(id,email)` gör att återställning kan matchas mot aktuell mejladress och en existerande administratörskoppling.

Edge-funktionen verifierar JWT med `auth.getUser()` och kontrollerar medlemskap på nytt för varje skyddad operation. En inloggad användare får inte automatiskt läsa eller ändra något lag. Skyddet bygger inte på `user_metadata`. `publicState()` bygger ett separat tillåtet svar utan utkast, intern historik, förhinder, interna meddelanden eller utskicksuppgifter. Telefonnummer och rollbeskrivningar hämtas bara från publicerade pass; opublicerade ändringar i kontaktregistret följer inte med.

## Lokal start och kontroller

Använd Node för webbprojektet, Supabase CLI 2.117 eller senare och Docker för en komplett lokal Supabase-miljö. Migrationens filnamn skapades med CLI-kommandot `supabase migration new portal_backend`.

```sh
npx supabase start
npx supabase db reset
cp supabase/functions/.env.example supabase/functions/.env.local
# Behåll MAIL_ENABLED=false för start utan mejltjänst eller mejlhemligheter.
npx supabase functions serve portal --env-file supabase/functions/.env.local
```

`seed.sql` är avsiktligt tom. Använd `bootstrap.example.sql` för Landvetter IS P2018 med sluggen `landvetter-p2018` och sex standardroller. Koppla därefter en uttryckligen skapad Auth-administratör. `VITE_TEAM_SLUG` ska motsvara lagets slug. Exemplet innehåller inga verkliga föräldrar eller barn.

Testa utan Docker:

```sh
npx vitest run supabase/tests
npx deno check --lock supabase/functions/portal/deno.lock --config supabase/functions/portal/deno.json supabase/functions/portal/index.ts
npm install --prefix /tmp/passlaget-backend-tests --no-save @electric-sql/pglite
PGLITE_MODULE=/tmp/passlaget-backend-tests/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/sql-smoke.mjs
```

Vitest testar också den verkliga HTTP-handlern med ersatt databasklient: publik dataprojektion, verifierad adminbehörighet, fast anropsbegränsning, mottagarvalidering och skyddad mejlworker. SQL-testet kör hela migrationen i en riktig inbäddad Postgres-motor med en liten testmotsvarighet till Supabase Auth-tabellen. Det verifierar rollrättigheter, lagisolering, versionskonflikt och återställning av transaktion, ködeduplicering, medgivande, låsning, osäkra utskick, kvittenser och administratörens beslut. Det ersätter inte ett sista anslutningstest mot den driftsatta Supabase-funktionen eller Supabase Advisors.

## Konfiguration för gratisdrift

Skapa eller välj en separat kostnadsfri organisation och ett Free-projekt i EU enligt huvudplanen. Koppla inte projektet till en betalorganisation. Ingen automatisk uppgradering behövs. Låt registrering vara avstängd och skapa endast godkända administratörer i Supabase Auth.

Konfigurera följande hemligheter för Edge-funktionen:

| Namn                   | Innehåll                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `APP_URL`              | Exakt publicerad portalbas, exempelvis `https://konto.github.io/passlaget/`. Inga parametrar eller hashfragment.  |
| `PORTAL_ORIGINS`       | Kommaseparerade tillåtna ursprung, exempelvis `https://konto.github.io`. Vid frånvaro används APP_URL:s ursprung. |
| `MAIL_ENABLED`         | `false` vid första driftsättningen. Endast exakt `true` aktiverar mejlfunktionerna.                               |
| `MAIL_WORKER_SECRET`   | Krävs när mejl aktiveras: slumpmässig hemlighet på minst 32 tecken för Apps Script.                               |
| `MAIL_TOKEN_SECRET`    | Krävs när mejl aktiveras: en annan slumpmässig hemlighet på minst 32 tecken som signerar avregistreringslänkar.   |
| `SUPABASE_URL`         | Tillhandahålls automatiskt av Supabase.                                                                           |
| `SUPABASE_SECRET_KEYS` | Supabases JSON-objekt med den nya backendnyckeln under `default`.                                                 |

`PORTAL_SUPABASE_SECRET_KEY` kan anges som uttryckligt lokalt alternativ. Äldre `SUPABASE_SERVICE_ROLE_KEY` stöds som reserv, men nya projekt bör använda publicerbar frontendnyckel och hemlig backendnyckel. Ingen av mailhemligheterna eller backendnyckeln får ha `VITE_`-prefix eller läggas i GitHub Pages-filer.

Auth Site URL och tillåtna redirects ska motsvara `APP_URL` exakt. Servern ignorerar användarskickad `returnUrl`; återställning får aldrig skicka en användare till en godtycklig adress. Inställningarna i `config.toml` gäller lokalt; ange motsvarande inställningar i det verkliga projektet.

Funktionen `portal` har `verify_jwt = false` eftersom föräldrafunktionerna är öppna och worker använder en egen begränsad hemlighet. Detta innebär inte att adminfunktionerna är öppna: dessa verifierar JWT och lagmedlemskap i handlern. Skicka publicerbar API-nyckel i `apikey`, aldrig som JWT. Administratörer skickar dessutom `Authorization: Bearer <session access token>`.

## Drift utan mejl

`MAIL_ENABLED` är avstängt om värdet saknas eller inte är exakt `true`. Kärnflödena startar utan mejlhemligheter och sparar alltid en tom lista med nya mejljobb; gamla köposter ändras inte. Prenumeration, adressverifiering, lösenordsåterställning, workeråtgärder och köbeslut svarar då HTTP 503 med `code: mail_disabled`, utan framgångsbesked eller köskrivningar. Skyddad `mail_status` fungerar fortfarande och visar verkliga köuppgifter med `enabled: false`.

Befintliga avregistreringslänkar fortsätter fungera om `MAIL_TOKEN_SECRET` behålls; utan nyckeln ges ett tydligt avslag. För en senare paus i redan aktiv drift måste worker stoppas och dess pågående kvittenser stämmas av **innan** `MAIL_ENABLED` stängs av, eftersom även `mail_ack` då blockeras. Läs [mejlguiden](MAIL.md) före återaktivering. Aktivering skapar inga nya jobb för ändringar som gjordes medan mejl var avstängt; befintlig kö måste granskas innan en worker startas igen.

Webbbygget använder dessutom `VITE_MAIL_ENABLED=false` så att föräldrar inte erbjuds prenumeration eller lösenordsmejl. Båda flaggorna måste sättas till `true` när en fungerande mejlavsändare tas i bruk. Kalenderknappen är oberoende av dem.

## HTTP-kontrakt

Alla anrop är `POST <SUPABASE_URL>/functions/v1/portal` med JSON. CORS tillåter bara konfigurerade browserursprung. Worker får anropa utan `Origin`. CORS är ett browserskydd, inte en identitetskontroll. Svar är `Cache-Control: no-store`.

Varje publik åtgärd har en fast global anropsgräns som inte kan kringgås genom att byta mejladress, familj eller IP-header. Därutöver finns begränsningar per mejladress och pass. IP-header används endast som kompletterande signal och betraktas inte som betrodd identitet. Gränserna begränsar missbruk men kan också tillfälligt stoppa legitima besök vid en attack; den öppna familjeväljaren ger enligt kravet ingen säker identifiering av vem som bekräftat.

- `{action:'read',teamSlug,admin:false}` → `{state: PublicState}`.
- `{action:'read',teamSlug,admin:true}` + admin-JWT → `{state: PortalState}`.
- `{action:'command',teamSlug,expectedVersion,command}` → `{state}`. `confirm` och `request_change` är publika och returnerar publik data; övriga kräver admin.
- `{action:'subscribe',teamSlug,familyId,adultId?,email,scope:'family'|'adult'}` → neutralt `{ok:true,message}`. Endast mejlprenumerationen behöver bekräftas; portalåtkomst är fortsatt öppen.
- `{action:'verify_subscription',token}` → `{ok:true}`. Token gäller i 48 timmar och används en gång. Länken är `APP_URL?subscription=...`; UI bekräftar via POST.
- `{action:'unsubscribe',token}` → `{ok:true}`. Signerad länk är `APP_URL?unsubscribe=...`; UI visar först en knapp. Ingen GET ändrar prenumeration.
- `{action:'request_recovery',email,returnUrl?}` → neutralt `{ok:true,message}`. Bara befintliga administratörer får köposter.
- `{action:'mail_status',teamSlug}` + admin-JWT → `{enabled,counts,lastWorkerAt,lastSentAt,messages}`. `messages` innehåller senaste 100 poster med `id,kind,status,to,subject,createdAt,sentAt,error`, aldrig hemliga payloads.
- `{action:'mail_resolve',teamSlug,id,outcome:'sent'|'retry'|'suppress'}` + admin-JWT → `{ok:true}`. Gäller endast lagets misslyckade/osäkra utskick. Ett uttryckligt administratörsbeslut loggas.

Fel är `{error:svensk text,code}` med HTTP 400, 401, 403, 404, 409, 413, 429 eller 503. Vid 409 ska klienten läsa om och låta användaren ta ställning; en nyare bekräftelse får inte automatiskt antas accepterad.

## Mejlkö och Google-worker

Se även [MAIL.md](./MAIL.md) för Apps Script-installation. Alla workeranrop har `workerSecret: MAIL_WORKER_SECRET` i JSON; den får bara tillgång till köhämtning och kvittenser.

1. `{action:'mail_claim',workerSecret,limit:0..5}` → `{messages:[{id,leaseToken}],claimedAt}`. `limit:0` registrerar endast hjärtslag. Låsning är atomisk med `FOR UPDATE SKIP LOCKED`.
2. Direkt före varje sändning: `{action:'mail_prepare',workerSecret,id,leaseToken}` → `{skip:boolean,message?:{to,subject,text}}`. Servern kontrollerar aktuellt publicerat schema och aktiv prenumeration. `skip:true` betyder att posten är stoppad/suppressed eller uncertain och kan släppas av worker.
3. Efter sändningsförsök: `{action:'mail_ack',workerSecret,id,leaseToken,outcome:'sent'|'failed'|'uncertain'|'deferred',error?:kod}` → `{ok:true}`. Samma kvittens kan upprepas säkert. Inga mejladresser, länkar eller felstackar ska skickas i `error`.

En lease gäller i tio minuter. Utgången lease blir **uncertain**, inte automatiskt queued. Samma token kan kvitteras även efter utgången lease. `deferred` betyder att worker säkert vet att ingen sändning gjorts och återställer köposten för nytt försök efter fem minuter. `failed` och `uncertain` kräver granskning.

`mail_resolve: retry` ska bara användas när administratören kontrollerat att mejlet inte skickats. Pausa worker och stäm av dess lokala kvitton före en sådan bedömning, särskilt vid en pågående störning; fördröjda kvitton från en gammal lease ska inte kunna ändra ett nytt utskicksförsök. `sent` betyder att sändning har bekräftats, inte att mejlet har levererats eller lästs. `suppress` avstår vidare utskick.

När mejl är aktiverat skapas köposter i samma databastransaktion som publiceringen. Meddelanden till samma prenumeration om flera samtidigt publicerade pass sammanförs. Påminnelser får unika nycklar baserade på passets publicerade uppgifter och tidsavstånd. Opublicerade utkast, importerad historik och bekräftelse utan relevant ändring skapar inga nya tilldelningsnotiser. Gamla påminnelsetider skapas inte i efterhand, och passerade pass undertrycks före sändning. Medgivande kontrolleras igen vid `mail_prepare`.

Ändrings- och borttagningsnotiser kan skickas även medan passet pågår. En familj som avaktiverats får fortfarande veta att dess pass tagits bort, förutsatt att mejlmedgivandet finns kvar. Ett sådant mejl säger tydligt att passet inte längre ska bemannas och att en sparad kalenderkopia behöver tas bort manuellt. Mejladressen måste vara en enda giltig mottagare; mottagarlistor och kontrolltecken avvisas.

Mellan sista kontrollen och själva MailApp-anropet finns alltid ett kort nätverksintervall. Systemet kan inte göra en databastransaktion tillsammans med en extern mejlleverantör; därför prioriteras synliga osäkra sändningar och inga automatiska dubbelsändningar vid avbrott.

Återställningslänken genereras av Supabase Auth precis före sändning efter ny kontroll av administratörens medlemskap och aktuella mejladress. Länken lagras inte i kö eller normala loggar. Verifieringstokens lagras tillfälligt i privat kö för leverans och tas bort ur payload efter kvitterad sändning. Avregistreringstokens signeras och kan inte användas för administration. Byte av `MAIL_TOKEN_SECRET` gör äldre avregistreringslänkar ogiltiga; behåll nyckeln vid vanliga utrullningar.

## Backup och driftsättning

Kör `npx supabase functions deploy portal --use-api` från hela projektet när driftsättning är godkänd. Edge-funktionen importerar samma `src/domain` som webbappen. Supabase CLI följer dessa importvägar även utanför `supabase/functions` och inkluderar filerna vid API-baserad deploy; kopior eller symlänkar behövs inte. Ladda därför inte upp en ensam `index.ts` via Dashboard. Stödet framgår av [Supabases CLI-källkod](https://github.com/supabase/cli/blob/develop/apps/cli/src/shared/functions/deploy.ts) och [annonseringen av API-baserad deploy](https://github.com/orgs/supabase/discussions/33613). Funktionen har även driftsatts med den här metoden i projektet `erddjmgwlwdcqtunlepa`; se driftguiden för miljö och återstående pilotkontroller.

Backa upp både `portal_private` och administratörskopplingar före större ändringar; frontendens JSON-export ersätter inte utskicks- och prenumerationshistoriken. Spara aldrig personuppgifter, hemligheter eller databasexporter i det publika repositoryt. Återställ backup i en isolerad lokal miljö med worker avstängd för att undvika att gamla köposter skickas igen. Supabase Free ger ingen garanti om ständig aktivitet eller automatiska backuper.

Efter tillämpad migration och deploy ska ett testlag verifiera: publik läsning, blockerad rådatabasåtkomst, adminmedlemskap, stale-version 409, publicering, bekräftelse, mejlverifiering, återställningslänk och adminbeslut om osäker sändning. Kör även Supabase Advisors när det faktiska projektet finns. Den lokala PGlite-kontrollen verifierar SQL-logiken men har ingen riktig Supabase Auth/API-gateway.

Tekniska referenser: [API-nycklar](https://supabase.com/docs/guides/getting-started/api-keys), [Edge-auth](https://supabase.com/docs/guides/functions/auth-headers), [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Privata kontaktadresser och begärd bekräftelsepåminnelse

`Adult.email` är frivilligt för äldre register och adminimport. `confirm.adultEmail` är däremot obligatoriskt. Servern accepterar en enda giltig adress och sparar normaliserat värde på den vuxna. Nya namngivna vuxna får en registerkoppling. Den explicita publika projektionen utelämnar mejladressen och intern påminnelsemetadata.

`remind_confirmation` är ett administratörskommando med `eventId`, `slotId`, `familyId` och `revision`. Det kräver aktiverad avsändare, rätt lagbehörighet, aktuell version, framtida publicerat pass med `pending` och en användbar kontaktadress. `reminderRequestedAt`/`reminderRevision` ger tio minuters spärr och beskriver en begärd köläggning, inte leverans.

Direkta kontaktjobb använder `outbox.subscription_id = null`, en serverberäknad `recipient` samt `payload.contact` med familj och vuxen-ID:n. SQL-kopplingen kontrollerar att adressen verkligen hör till en sparad aktiv vuxen i familjen innan tillstånd och jobb kan committas tillsammans. Ingen browserroll får RPC-behörighet. Worker-kontrollen läser den aktuella kontakten igen och undertrycker gamla adresser, omfördelningar, inaktuella uppdrag och besvarade bekräftelsepåminnelser. `payload.confirmationOnly` skiljer manuella svarspåminnelser från vanliga kommande-pass-påminnelser.
