# Kostnadsfria mejlpåminnelser

**Landvetter-installationens mejl är aktiverat från 2026-09-21**, efter kontoägarens Google-godkännande. En ny installation ska däremot börja med `MAIL_ENABLED=false` och `VITE_MAIL_ENABLED=false`. Inga nya utskick köas i avstängt läge och lösenordsåterställning via mejl väntar. Nedan beskrivs hur Google-avsändaren konfigureras.

Mejl skickas från ett Google-konto med Google Apps Script och MailApp. Ingen köpt domän behövs. Ett vanligt Gmail-konto har för närvarande en kvot på **100 mottagare per dag**. Kvoten delas med kontots andra skript. När kvoten tar slut väntar återstående mejl i kön. Detta är ingen garanti för omedelbar leverans; kalenderknappen fungerar oberoende av mejltjänsten.

Koden i repositoryt gör inga utskick eller kontoändringar av sig själv. Aktivering görs när Supabase är konfigurerat och kontoägaren har godkänt avsändaren. Verkliga testmejl skickas bara till en uttryckligen vald testmottagare.

## Kontaktuppgifter och mottagare

Föräldern anger alltid mejladress när ett pass bekräftas. Adressen sparas på vald vuxen; en annan namngiven vuxen läggs till i familjens register. Den är privat och ingår varken i föräldrasidans API-svar eller kalenderfiler. Administratören kan lägga till eller rätta adressen under **Barn & föräldrar**. För den första tilldelningsnotisen behöver adressen finnas redan före publiceringen, eller läggas till av administratören efteråt.

Publicerad tilldelning till en familj meddelar familjens aktiva vuxna som har mejladress. Är en viss vuxen vald går mejlet till den vuxna. Samma adress inom samma familj får ett meddelande, även om två vuxna delar inkorg. En förälders bekräftelse sparar kontakten utan att skicka en omedelbar tilldelningsnotis till samma person.

Automatiska påminnelser före passet gäller endast publicerade uppdrag som fortfarande saknar bekräftelse. Bekräftade pass får inga nya påminnelser, och redan köade påminnelser stoppas vid kontrollen före utskick. Har samma familj andra obekräftade pass kan de fortfarande få påminnelser för dessa. Om ett ändrat pass kräver en ny bekräftelse gäller påminnelserna igen för den nya versionen. Information om ändring eller avbokning skickas även för tidigare bekräftade pass.

Under **Evenemang → Svar & uppföljning** kan administratören trycka **Påminn via mejl** för ett publicerat, framtida pass utan svar. Adress måste finnas och utskick måste vara aktiverade. Schemat och köposten sparas atomiskt. Nytt försök till samma pass begränsas i tio minuter. Strax före utskick kontrolleras på nytt att svaret fortfarande saknas, att uppdragets uppgifter stämmer och att mottagaradressen fortfarande gäller.

De här verksamhetsmeddelandena använder sparade kontaktadresser direkt. Den äldre, frivilliga prenumerationsfunktionen stöds fortfarande på servern för befintliga länkar men erbjuds inte längre som ett separat steg på föräldrasidan. Kontaktmejl hänvisar till lagföräldern för adressändring. Tas adressen bort stoppas väntande kontaktmejl vid kontrollen före utskick.

## Förbered servern

1. Följ projektets instruktioner för Supabase Free och publicera Edge-funktionen `portal`.
2. Skapa en slumpmässig, minst 32 tecken lång hemlighet. Sätt den som `MAIL_WORKER_SECRET` på servern och som `WORKER_SECRET` i Google-skriptets egenskaper. Lägg aldrig värdet i koden, GitHub Pages eller ett offentligt ärende. Hemligheten får endast ge åtkomst till utskickskön; använd inte Supabases `service_role` som worker-hemlighet. Serverns separata `MAIL_TOKEN_SECRET` ska ha ett annat slumpmässigt värde.
3. När avsändaren är konfigurerad och kontoägaren godkänt Google-kopplingen, sätt `MAIL_ENABLED=true` på servern och `VITE_MAIL_ENABLED=true` i ett nytt webbbygge. Granska eventuell gammal kö innan arbetaren startas. Händelser under den avstängda perioden får inga retroaktiva notiser. Leverans till en inkorg kontrolleras separat med en uttryckligen vald testmottagare.
4. Servern ska acceptera arbetarkontraktet nedan och kunna prioritera återställningsmejl och adressbekräftelser före vanliga påminnelser.

## Installera Google-skriptet

1. Logga in på det Google-konto som ska stå som avsändare. Välj helst ett konto som lagets ansvariga kan förvalta över tid. Föräldrarna behöver inga Google-behörigheter för detta.
2. Skapa ett separat projekt på [script.google.com](https://script.google.com/). Kopiera `apps-script/Code.gs` till projektets `Code.gs`.
3. Öppna projektinställningarna, visa manifestfilen `appsscript.json` och ersätt den med repositoryts manifest.
4. Lägg till två **skriptegenskaper** under projektinställningarna:

   | Namn            | Värde                                                                                                                                                 |
   | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `PORTAL_URL`    | Hela adressen till Edge-funktionen, exempelvis `https://projekt-id.supabase.co/functions/v1/portal`. Detta är inte webbportalens GitHub Pages-adress. |
   | `WORKER_SECRET` | Samma värde som serverns `MAIL_WORKER_SECRET`.                                                                                                        |

5. Kör `installMailTrigger` manuellt en gång. Godkänn behörigheterna för att skicka mejl, ansluta till den externa servern och hantera skriptets tidsutlösare. Funktionen skapar en körning var femte minut; upprepad installation ersätter tidigare utlösare för samma funktion.
6. Skicka ett uttryckligen valt testjobb från portalens testmiljö till en egen adress. Kör `processMailQueue` manuellt och kontrollera mottaget mejl samt serverns utskicksstatus. Installationsfunktionen skickar inget mejl själv, men den installerade utlösaren börjar därefter behandla kön automatiskt.

Skriptet ska **inte** publiceras som webbapp. Det hämtar kön med utgående HTTPS-anrop. Bara betrodda förvaltare får tillgång till Google-skriptprojektet: skriptegenskaperna är tillgängliga för projektets användare.

Mejlen skickas från kontot som skapade utlösaren, med visningsnamnet ”Landvetter IS – bemanning”. Ett annat visningsnamn ändrar inte avsändaradressen. `noReply` används inte eftersom det inte stöds för vanliga Gmail-konton. Utskicksägaren kan få Googles felmeddelanden om automatiska körningar misslyckas.

## Behörigheter

Manifestet innehåller endast dessa tre OAuth-behörigheter:

- `script.send_mail`: skicka mejl. Ingen åtkomst till inkorgen.
- `script.external_request`: hämta och kvittera köjobb på Supabase-servern.
- `script.scriptapp`: skapa och ta bort den egna automatiska körningen.

## Kön och leveransstatus

- Högst fem jobb reserveras åt gången, i serverns prioritetsordning. Skriptet kontrollerar kvarvarande mottagarkvot och lämnar arbete till nästa körning när kvoten eller körtiden inte räcker.
- Servern kontrollerar aktuellt schema, prenumeration och eventuell avregistrering precis före sändning. Inaktuella påminnelser undertrycks.
- Ett lås förhindrar överlappande körningar. En lokal kvittens sparas i skriptegenskaper före sändning och uppdateras när MailApp returnerat.
- Förlorad serverkvittens leder till nytt försök att **kvittera**, inte att skicka mejlet igen.
- Om körningen avbryts mitt i sändningen blir status **osäker**. Sådana jobb skickas inte om automatiskt. Administratören granskar dem och kan fatta beslut om ett nytt utskick. MailApp saknar meddelande-id och idempotensnyckel, så ”exakt en leverans” kan inte garanteras.
- ”Skickat” betyder att MailApp accepterade anropet. Tjänsten ger ingen bekräftelse på att mottagaren har läst mejlet eller att det nådde inkorgen.
- Loggar innehåller endast antal och allmänna felkoder. Mejltext, adresser, återställningslänkar och worker-hemligheten ska aldrig loggas.
- När äldre kvittenser inte kan kvitteras hämtar skriptet inga nya jobb. Åtgärda serveranslutningen eller felaktig konfiguration; radera inte kvittenser för att få kön att fortsätta, eftersom det kan dölja osäkra utskick.

Administratörens återställningslänk genereras på servern först när mejlet förbereds. Länken återges aldrig i portalens öppna svar. Endast befintliga administratörer får återställningsmejl; en neutral användartext och serverns anropsgränser hindrar att konton kartläggs. Återställning använder samma gratisgränser och kan därför också fördröjas.

## API-kontrakt för arbetaren

Alla anrop är HTTPS POST med JSON till `PORTAL_URL` och innehåller `workerSecret`. Servern måste verifiera hemligheten innan köåtkomst. Meddelandets mottagare och innehåll kommer endast från servern.

| Åtgärd         | Parametrar utöver hemligheten           | Svar                                                                                                                               |
| -------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `mail_claim`   | `limit: 0..5`                           | `{ messages: [{ id, leaseToken }], claimedAt? }`. Noll registrerar att arbetaren lever utan att ta jobb.                           |
| `mail_prepare` | `id`, `leaseToken`                      | `{ skip: true }` om servern redan avslutat jobbet som inaktuellt, annars `{ skip: false, message: { to, subject, text, html? } }`. |
| `mail_ack`     | `id`, `leaseToken`, `outcome`, `error?` | `{ ok: true }`, också vid upprepad identisk kvittering.                                                                            |

Tillåtna resultat är `sent`, `failed`, `uncertain`, `deferred`. `deferred` återgår till kö; `uncertain` förblir stoppat för granskning. Servern ska behålla lease-token och acceptera en sen kvittens från samma reservation efter timeout, så att arbetaren kan städa sin lokala kvittens. En utgången reservation får aldrig automatiskt återföras till kön om sändning kan ha påbörjats.

## Pausa och överlämna

Kör `removeMailTrigger` för att pausa den automatiska behandlingen. Den tar bara bort utlösare till `processMailQueue`. Kön finns kvar på servern. Återuppta med `installMailTrigger`.

För att även stoppa skapandet av nya mejljobb: avsluta först pågående worker-körningar och stäm av alla lokala kvittenser, sätt sedan `MAIL_ENABLED=false` på servern och `VITE_MAIL_ENABLED=false` i ett nytt webbbygge. Även kvitteringsanrop blockeras när serverflaggan är av. Behåll `MAIL_TOKEN_SECRET` så att gamla avregistreringslänkar fungerar. Granska kvarvarande kö före återaktivering; gamla poster finns kvar, medan ändringar under pausen inte har köats.

Vid byte av avsändarkonto: pausa gamla utlösaren, säkerställ att dess lokala kvittenser hanterats, kopiera skriptet till det nya kontot, konfigurera egenskaper och skapa en ny utlösare under den nya ägaren. Rotera worker-hemligheten vid behov. Radera inte gamla lokala kvittenser utan att först stämma av dem mot servern.

## Verifiering utan verkliga utskick

Kör `node --test apps-script/worker.test.mjs`. Testerna använder falska Google-tjänster och omfattar normal sändning, förlorad kvittens, avbrott mitt i sändning, kvotbrist, föråldrade jobb, felaktiga mottagare och samtidiga körningar. Ingen nätverksanslutning eller verklig MailApp används.

Källor: [Googles kvoter](https://developers.google.com/apps-script/guides/services/quotas), [MailApp](https://developers.google.com/apps-script/reference/mail/mail-app), [tidsutlösare](https://developers.google.com/apps-script/guides/triggers/installable), [Script Properties](https://developers.google.com/apps-script/guides/properties), [Supabase återställningslänkar](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).
