# Självbokning och särskilda evenemang

Under evenemangets **Grunduppgifter → Hur bokas uppdragen?** väljer administratören om familjerna får boka lediga platser själva. Det gäller först när schemat publiceras. Standard för befintliga och nya evenemang är att administratören tilldelar.

Föräldern väljer familj på den gemensamma sidan och trycker **Boka platsen**. Namn, telefon, mejl och godkännande krävs. Bokningen blir direkt bekräftad. En upptagen, låst, inställd eller påbörjad plats kan inte bokas. Två samtidiga bokningar kan inte ta samma plats. Undantagna familjer får frivilligt boka. Överlappande pass för samma vuxen nekas.

Administratören kan fortfarande tilldela valfri familj och använda **Fördela lediga pass**. Befintliga bokningar och låsta platser bevaras. Frivilliga bidrag lämnas för självbokning eller manuell tilldelning.

Varje pass kan ha eget stationsnamn, grupp, instruktioner och ungefärlig sluttid. Grupp används för att samla exempelvis Skogen, A-plan och Förberedelser i föräldraschemat. Stationsnamnet visas även i kalender, mejl och genomförandehistorik.

Under **Instruktioner, frågor till föräldrar & annat lag** kan administratören lägga in:

- En gemensam fråga för stationen, exempelvis **Tema**. Bokade familjer delar ett svar.
- En individuell fråga, exempelvis **Vad bakar du?**. Varje bokning har eget svar.

Svaren är valfria vid bokning och kan fyllas i senare med **Skriv / ändra uppgifter**. De visas i schemat. Ett nytt svar kräver ingen ny bekräftelse. Administratören kan redigera svaren i utkastet; dessa ändringar visas efter publicering.

**Frivillig förberedelse med deadline** har ett enda sista datum och klockslag, även före själva evenemanget. Det är inte ett arbetspass med start och slut. Det påverkar inte passräkningen, vare sig planerat eller genomfört. Kalenderknappen skapar en händelse vid deadline. Vanliga bemanningspass kan också undantas från passräkningen med kryssrutan i redigeraren.

Automatiska mejlpåminnelser går endast till uppdrag som ännu inte är bekräftade. Kontroll sker även precis före utskick. Bekräftad självbokning skickar inget extra tilldelningsmejl till den registrerade ansvariga.

## Tekniska kontrakt

- `EventDetails.bookingMode` är `admin` (även saknat fält) eller `self`.
- `Shift.kind` är `shift` (även saknat fält) eller `task`. En uppgift har `startsAt === endsAt` som deadline och `countsTowardBalance: false`.
- Normala pass räknas om inte `countsTowardBalance` uttryckligen är `false`.
- `book` och `update_answers` valideras i serverns domänlager, använder befintlig frekvensbegränsning och versionskontroll och svarar med offentlig projektion. Mejladresser förblir privata.
- Bokning synkas till utkastet endast om platsen fortfarande är vakant och kompatibel. Pågående administratörsändringar får inte ersättas.
- Kopior behåller frågor och upplägg men rensar bokningar och föräldrars svar. Deadlines förskjuts med evenemangets datum och svensk sommar-/vintertid.
