# SportAdmin i Passlaget

## För administratören

1. Öppna **SportAdmin** i adminmenyn och anslut ditt konto.
2. Välj rätt lag om kontot har flera medlemskap.
3. Välj en aktivitet och tryck **Hämta spelare**. Koppla spelarna till barnen i Passlaget. **Koppla entydiga namnträffar** hjälper när fullständiga namn är identiska och unika. Övriga kopplas manuellt. Ett SportAdmin-ID kan bara tillhöra ett barn.
4. Öppna **Evenemang** och skapa eller redigera ett evenemang. Välj aktivitet i **Koppla till SportAdmin** och tryck **Spara utkast**. Kopplingen sparas tillsammans med evenemanget, även för helt nya evenemang. **Fördela lediga pass** sparar först kopplingen och fördelar sedan bland rätt familjer.

Du kan ändra eller ta bort kopplingen i samma vy. Valet visas både vid Grunduppgifter och Pass & bemanning. Om SportAdmin inte kan läsas sparas ingen halvfärdig ändring av kopplingen; dina osparade val finns kvar i formuläret.

Nya pass får bara tilldelas en aktiv familj med minst ett aktivt, kopplat barn som svarat ja. Det gäller automatisk tilldelning, manuell tilldelning och självbokning. Ett ja från ett av tvillingarna räcker. Lagets undantag från automatisk tilldelning gäller fortfarande.

Befintliga pass behålls när ett svar ändras. Admin får en varning och ordnar ersättare. Inga ändringsmejl skickas enbart för att ett kallelsesvar ändras.

Svar uppdateras varje timme och med **Uppdatera nu**. Misslyckad synkning, okända svar eller uppgifter äldre än två timmar stoppar nya bokningar för det kopplade evenemanget. Bekräftelse av ett redan tilldelat pass är fortfarande möjlig. Vid fel visas orsaken i admin.

**Ingen koppling** tar bort evenemangets SportAdmin-filter när du sparar evenemanget. **Koppla från SportAdmin** tar bort den sparade sessionen men behåller filtren, så att avbrottet inte öppnar bemanningen för alla.

## Spelarinventering: väntar på ledarbehörighet

Den automatiska inventeringen är inte aktiverad. Kontots ledarprofil för Landvetter IS saknas. API-metoden för lagmedlemmar och dess modeller har identifierats, men en fullständig, behörig läsning av rätt lag måste verifieras innan den används för automatisk avaktivering.

Kallelselistor används aldrig som bevis för att ett barn har slutat. Saknade spelare, nekad åtkomst eller tomma svar ändrar inte spelarregistret. Under tiden kan barn markeras inaktiva manuellt i Familjer; en familj utan aktiva barn kan inte få nya pass.

## Server och drift

- `portal_sportadmin` och `portal_private.sportadmin_connections` får endast användas av serverns service-roll. Ingen browserroll får läsa tabellen eller anropa databasfunktionen.
- SportAdmin-lösenordet används en gång för inloggning och sparas inte. Åtkomsttoken och förnyelsetoken lagras i den privata tabellen, utanför portalens JSON-data och export. SportAdmin-kontot kan fortfarande ge sessionen åtkomst till fler föreningar; adaptern begränsar läsningen till det valda medlemskapet.
- En tidsbegränsad låsning per lag förhindrar samtidiga förnyelser av samma token. Rotering sparas före övriga nätverksanrop. Tilldelning och synkning använder samma versionskontroll för att undvika förlorade schemaändringar.
- Läsningen sparar bara spelar-ID, namn, födelseår, svar och medlemsstatusflaggor. SportAdmins kontaktuppgifter, kommentarer, personnummer och bilder kopieras inte till portalen.
- Inventeringsdelen kräver fortsatt verifiering enligt ovan. Ingen automatisk avaktivering sker i denna version.
- API:t är SportAdmins app-protokoll, inte ett utlovat stabilt integrationsavtal. Oväntade svar stoppas och visas som ett synkfel.

### Installera timsynkning

1. Kör databasändringen `sportadmin_connection` och publicera Edge-funktionen `portal`.
2. Skapa en slumpmässig hemlighet med minst 32 tecken. Spara samma värde som Edge-hemligheten `SPORTADMIN_WORKER_SECRET` och som Vault-hemligheten `passlaget_sportadmin_worker_secret`.
3. Spara portalens Edge-URL i Vault som `passlaget_sportadmin_endpoint`.
4. Kör `deployment/sportadmin-cron.sql`. Namnet gör upprepad installation idempotent. Jobbet körs minut 17 varje timme, oberoende av dator och webbläsare.
5. Kontrollera både senaste körningen i Supabase Cron och **Senast uppdaterat** i Passlaget. Ett lyckat HTTP-anrop kan fortfarande innehålla ett SportAdmin-fel som visas i admin.

Kostnadsfri drift använder det befintliga Supabase Free-projektet. Ingen ny betaltjänst används. Ett pausat eller otillgängligt Supabase-projekt kan inte synka förrän det åter är i drift.

### Återställning och borttagning

Portalens säkerhetskopia innehåller inte SportAdmin-sessionen eller de privata ID-kopplingarna. Efter en fullständig återställning av servermiljön behöver kontot anslutas och spelarkopplingarna återställas separat. Ta aldrig med anslutningstabellen i en offentlig export. SportAdmin-inställningar ska administreras via backend och lagets autentiserade adminbehörighet.

## Verifiering

Automatiska tester täcker protokollets ramar/statusar, dataminimering, familjeurval, tvillingar, inaktiva barn, för gamla/nekade svar, bevarande av pass, manuell och publik bokning, adminflödet, lagseparering, privata token, sessionslåsning och versionskonflikter. Läsprover mot Landvetter-kontot har verifierat aktiviteter, kallelsesvar och förnyelse av sessionen. Inga SportAdmin-svar har ändrats.
