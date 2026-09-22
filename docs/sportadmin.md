# SportAdmin i Passlaget

## För administratören

1. Öppna **SportAdmin** i adminmenyn och anslut ditt konto.
2. Välj rätt lag om kontot har flera medlemskap.
3. Under **Spelarinventeringen** aktiverar du inventeringen. Befintliga ID-kopplingar och entydiga namnträffar behålls. **Uppdatera nu** läser både registret och kallelsesvaren; därefter sker uppdatering varje timme.
4. Öppna **Evenemang** och skapa eller redigera ett evenemang. Välj aktivitet i **Koppla till SportAdmin** och tryck **Spara utkast**. Kopplingen sparas tillsammans med evenemanget, även för helt nya evenemang. **Fördela lediga pass** sparar först kopplingen och fördelar sedan bland rätt familjer.

Du kan ändra eller ta bort kopplingen i samma vy. Valet visas både vid Grunduppgifter och Pass & bemanning. Om SportAdmin inte kan läsas sparas ingen halvfärdig ändring av kopplingen; dina osparade val finns kvar i formuläret.

Nya pass får bara tilldelas en aktiv familj med minst ett aktivt, kopplat barn som svarat ja, eller en manuell spelare vars deltagande admin markerat på evenemanget. Det gäller automatisk tilldelning, manuell tilldelning och självbokning. Ett ja från ett av tvillingarna räcker. Lagets undantag från automatisk tilldelning gäller fortfarande.

Befintliga pass behålls när ett svar ändras. Admin får en varning och ordnar ersättare. Inga ändringsmejl skickas enbart för att ett kallelsesvar ändras.

Svar uppdateras varje timme och med **Uppdatera nu**. Misslyckad synkning, okända svar eller uppgifter äldre än två timmar stoppar nya bokningar för det kopplade evenemanget. Bekräftelse av ett redan tilldelat pass är fortfarande möjlig. Vid fel visas orsaken i admin.

**Ingen koppling** tar bort evenemangets SportAdmin-filter när du sparar evenemanget. **Koppla från SportAdmin** tar bort den sparade sessionen men behåller filtren, så att avbrottet inte öppnar bemanningen för alla.

## Spelarinventeringen

- **synka:** SportAdmins fullständiga register för det valda lagets aktiva period styr spelarens namn och medlemsstatus samt föräldrarnas namn, telefonnummer och mejladresser. Dessa fält är låsta i Passlaget.
- **manuell:** spelaren och föräldrarna sköts i Passlaget via **Lägg till manuell spelare**. Manuella spelare påverkas inte när de saknas i SportAdmin.
- På ett kopplat evenemang markerar admin **Manuella spelare som deltar**. Markeringen gäller just det evenemanget och sparas tillsammans med det. Dessa familjer kan därefter tilldelas pass automatiskt, manuellt eller genom självbokning.
- Om en manuell spelare senare finns med samma namn i SportAdmin stoppas inventeringen med en tydlig uppmaning att bekräfta spelarens koppling. Admin väljer rätt post under **Koppla en befintlig spelare till SportAdmin**. Det skapas ingen dubblett som kan få dubbelt bemanningsansvar.
- Nya registerspelare importeras med föräldrakontakter. Syskon med entydigt gemensamma föräldrakontakter får samma familj. Befintliga familjer, undantag från automatisk tilldelning, passhistorik och tilldelningar behålls.
- En synkad spelare som har slutat eller saknas i ett fullständigt register markeras inaktiv. Familjer utan aktiva barn kan inte få nya pass. Befintliga pass ligger kvar och behöver granskas av admin.
- Ett nekat, tomt, felaktigt eller ofullständigt API-svar avaktiverar inga spelare. Alla kontaktanrop måste lyckas innan en inventering sparas. Senaste fungerande inventering behålls vid fel.
- När en synkad förälder bekräftar används kontakterna i SportAdmin direkt. Mejladressen visas inte publikt och kan inte skrivas över från bekräftelseformuläret. Saknade kontaktuppgifter kompletteras i SportAdmin. Annan ansvarig vuxen kan fortfarande anges för ett pass.

Kallelselistor används aldrig som bevis för att ett barn har slutat. Registerinventering och deltagande i ett visst evenemang är separata kontroller. En administratörs markering för en manuell spelare gäller även om SportAdmin för tillfället inte kan läsas.

## Server och drift

- `portal_sportadmin` och `portal_private.sportadmin_connections` får endast användas av serverns service-roll. Ingen browserroll får läsa tabellen eller anropa databasfunktionen.
- SportAdmin-lösenordet används en gång för inloggning och sparas inte. Åtkomsttoken och förnyelsetoken lagras i den privata tabellen, utanför portalens JSON-data och export. SportAdmin-kontot kan fortfarande ge sessionen åtkomst till fler föreningar; adaptern begränsar läsningen till det valda medlemskapet.
- En tidsbegränsad låsning per lag förhindrar samtidiga förnyelser av samma token. Rotering sparas före övriga nätverksanrop. Tilldelning och synkning använder samma versionskontroll för att undvika förlorade schemaändringar.
- Registerläsningen sparar spelar-ID, namn, medlemsstatus och föräldrarnas namn, telefonnummer och mejladresser. Personnummer, födelsedatum, adresser, hälsouppgifter och bilder kopieras inte till portalen. Kallelseläsningen sparar ID, namn, födelseår, svar och medlemsstatusflaggor.
- Adaptern har en fast tillåtelselista med läsmetoder. Skrivmetoder nekas innan något nätverksanrop görs, även med ledarbehörighet. Ingen operation ändrar SportAdmin.
- Inventeringen och ID-kopplingarna sparas i en gemensam transaktion med versionskontroll. Kontaktläsning sker i grupper om fyra för att passa Supabase Free. Den första inventeringen aktiveras uttryckligen; därefter ingår den i timsynkningen.
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

Automatiska tester täcker protokollets ramar/statusar, dataminimering, familjeurval, tvillingar, inaktiva barn, för gamla/nekade svar, bevarande av pass, manuell och publik bokning, adminflödet, lagseparering, privata token, sessionslåsning och versionskonflikter. Läsprover mot Landvetter-kontot har verifierat aktiviteter, kallelsesvar, förnyelse av sessionen samt P2018:s fullständiga register och föräldrakontakter med ledarbehörighet. Inga uppgifter i SportAdmin har ändrats.
