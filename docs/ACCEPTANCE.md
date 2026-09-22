# Kontroll före verklig användning

Den lokala versionen har tester för regler, gränssnitt, kalender, behörighetsfunktioner, SQL-transaktioner och mejlarbetare. Anslutningarna nedan måste också kontrolleras innan föreningen går över till portalen.

## Kan kontrolleras i demot

- Välj familj, bekräfta ett pass och byt till en annan registrerad eller namngiven vuxen.
- Skicka en bytesförfrågan och hitta den i administrationen.
- Skapa och kopiera evenemang, lägg till egna uppgifter och ändra bemanningsantal och tider.
- Fördela tomma pass, kontrollera förslaget och publicera. Kontrollera att ett sparat utkast inte syns för föräldrarna.
- Ändra tid för ett bekräftat pass och publicera. Kontrollera att bara berörda familjer behöver bekräfta igen.
- Kontrollera historik, familjebalans, syskon och ledarundantag.
- Öppna två flikar, ändra i den ena och försök spara gamla uppgifter i den andra. Omläsning ska krävas.

## Kräver ansluten Supabase Free

- Anonym läsning visar bara publicerade uppgifter. Oinloggad administrativ ändring nekas.
- Inloggad person utan lagmedlemskap nekas. Administratör i ett testlag kan inte ändra ett annat lag.
- Råa privata tabeller och RPC-funktionen är stängda för `anon` och `authenticated`.
- Riktig lagförälder kan logga in, publicera och logga ut via rätt portaladress. Återställning via mejl provas först när mejlfunktionen aktiveras.
- Riktig förälder kan spara sin bekräftelse på en telefon och se samma svar på en annan enhet.
- Anslutningsavbrott ger felmeddelande och ingen falsk kvittens om sparande.
- Kör Supabase Advisors efter migration och konfiguration.

## Kräver valt Google-konto och godkänd testmottagare

- Sparad kontaktadress får rätt tilldelningsnotis och påminnelse. Äldre frivilliga prenumerationer aktiveras endast via bekräftelsemejlet.
- Publicering, byte, inställning och påminnelse ger rätt mottagare och rätt uppdrag.
- Borttagen kontaktadress stoppar redan köade kontaktutskick. Avregistrering stoppar äldre prenumerationsutskick.
- Avbruten kvittering efter en sändning orsakar inte automatisk dubbelsändning.
- Administratören kan hantera en osäker sändning och se senaste körning.

## Kräver riktiga mobiler

- iPhone/Safari: öppna kalenderfilen, kontrollera svenska tecken, datum och tider och slutför sparandet i Kalender.
- Android/Chrome: öppna Google Kalender-länken och spara en enda händelse med rätt start och slut.
- Testa sommartid och vintertid, upprepade klick och ett ändrat pass. Appen får aldrig påstå att klicket i sig bevisar sparande.
- Kontrollera meny, formulär, tangentbord, läsbarhet och att sidan inte får sidledes rullning vid 390 px bredd.

## Verifierad anslutning 2026-09-20

- Samtliga 108 automatiserade tester, SQL-kontrollerna och produktionsbygget passerar.
- Ett verkligt driftprov med ett isolerat fiktivt lag passerar: lösenordsinloggning, lagisolering, blockering av rå databasåtkomst, skyddade utkast, sparande, versionskonflikt, publicering och föräldrabekräftelse utan inloggning. Testlaget togs bort och Landvetter-lagets tillstånd ändrades inte. Inga utskick eller prenumerationer skapades.
- Supabase Auth bekräftar att självregistrering är avstängd och lösenordsinloggning är tillåten.
- Databasens behörigheter är verifierade: `anon` och `authenticated` saknar direkt åtkomst till privat schema och serverns RPC. Serverrollen har avsedd åtkomst.
- Fem index för främmande nycklar har lagts till efter Supabase Advisors granskning. De befintliga köindexen behålls trots att de ännu inte använts.
- Supabases information om **RLS utan policy** är avsiktlig för privata tabeller som bara serverrollen får använda. Öppna klientpolicyer ska inte läggas till för att tysta dessa meddelanden. [Förklaring](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Varningen om **skydd mot läckta lösenord** kvarstår eftersom funktionen kräver Pro eller högre. Ingen uppgradering görs. Administratören har ett långt slumpmässigt lösenord och självregistrering är stängd. [Supabases lösenordsskydd](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Matchdagen – ny utformning 2026-09-20

- Föräldrasidan utgår från ett publicerat evenemang. Familjens uppdrag visas före dagens rollgrupperade bemanning, med datumspalt, telefonlänkar och en separat ingång till administrationen.
- Familjen väljs med en enda sökning. Nästa egna kommande pass styr första evenemanget; alla publicerade evenemang och familjepass går att nå, även över flera dagar och med egna uppgifter.
- 114 automatiserade tester passerar (97 i Vitest och 17 för arbetare/återställning), samt SQL-kontrollen och produktionsbygget. Sex tillagda UI-fall täcker bland annat familjeval, flera pass/syskon, evenemangsbyte, externa lag, inställda pass och bytesförfrågan. Kalender- och administrationskontrollerna kvarstår.
- Den visuella webbläsargranskningen är fortfarande begränsad enligt nedan. Mobilmenyn har kontrollerats i kod för liten skärmhöjd och tangentbordsåtkomst.

## Aktuell avgränsning

Webbläsarens administratörsstyrda åtkomstkontroll gick inte att verifiera under bygget. Därför är visuell webbläsargranskning och faktiska mobilkalendrar ännu inte godkända. Komponenten testas separat med en simulerad DOM. Supabase-organisation, databas, Auth och Edge-funktion är driftsatta. Familjeimporten behöver granskas innan laget börjar använda portalen. Kontoägaren har godkänt Google-kopplingen och utskick har aktiverats 2026-09-21. Prov med leverans av ett verkligt mejl återstår.

## Mejladress och enskild påminnelse

- 134 automatiserade tester passerar (116 i Vitest och 18 för arbetare/återställning), samt SQL-kontrollen och produktionsbygget.
- Driftprovet efter uppdaterad databas och serverfunktion passerar: en tillfällig testfamilj måste ange mejladress vid bekräftelse, adressen normaliseras och sparas, och publika svar saknar adressen. Enskild påminnelse nekas tydligt medan utskick är avstängda. Testlaget togs bort, den riktiga lagdatan är oförändrad och inga mejljobb skapades. Databasbehörigheter och RLS är fortsatt verifierade; Advisors visar endast de redan dokumenterade notiserna ovan.
- Bekräfta med registrerad eller ny vuxen. Mejladress krävs, normaliseras och sparas privat. Publika svar och kalenderexport saknar mejladresser.
- Lägg till eller ändra mejladress i Barn & föräldrar. Återimport av äldre register utan mejlfält får inte radera adressen.
- Publicering med familjetilldelning mejlar familjens adresser; vald vuxen begränsar mottagaren. Gemensam adress inom familjen får ett utskick.
- Påminn ett framtida, obekräftat pass under Svar & uppföljning. Saknad adress och avstängd avsändare ger tydligt besked, aldrig falsk leveransstatus.
- Bekräfta eller flytta passet före worker-körningen: gammal påminnelse undertrycks. Ny adress, avslutad uppgift och återkallad kontakt kontrolleras vid sändning.
- Bara inloggad lagadministratör får begära påminnelse. Dubbelklick och gammal schemaversion ska inte skapa dubbla utskick.

## Automatiska påminnelser endast vid saknad bekräftelse 2026-09-21

- Bekräftade pass får inga nya automatiska påminnelser. En redan köad påminnelse stoppas om passet har bekräftats när utskicket förbereds, även för äldre köposter och prenumerationer.
- Andra obekräftade pass inom samma familj behåller sina påminnelser. Ändrade pass som kräver en ny bekräftelse kan påminnas igen.
- 139 tester passerar (121 i Vitest och 18 för arbetare/återställning), samt SQL-kontrollerna och produktionsbygget. Regressionstester täcker både skapande och förberedelse av automatiska och manuella påminnelser samt familjer med flera pass.

## Självbokning och förberedelser 2026-09-21

- 158 automatiserade tester passerar: 139 i Vitest och 19 för mejlarbetare/återställning. SQL-kontroller och produktionsbygge passerar.
- Testerna täcker bokning från föräldraflödet, obligatorisk kontaktinformation, skydd mot upptagen plats och versionskonflikt, dubbelbokning av samma vuxen, låsta och inställda platser, adminstyrda evenemang, samt bevarande av bokningar vid automatisk och manuell tilldelning.
- Stationernas gemensamma svar och varje förälders individuella svar bevaras och kan ändras utan ny bekräftelse. Kopiering rensar bokningar och svar.
- Förberedelser kan ha deadline före evenemanget. De undantas från dubbelbokningskontroll och passräkning, även efter genomförande. Deadline flyttas med svensk tidszon vid kopiering och stöds i säkerhetskopiering, kalenderexport och mejl.
- Mobilens faktiska kalenderappar och visuell webbläsargranskning har samma tidigare dokumenterade begränsning. Det nya föräldraflödet har verifierats med automatiserade komponenttester.

## Samtidig evenemangsredigering

- Öppna ett utkast, kör en SportAdmin-synkning eller ändra ett annat evenemang och spara sedan utkastet. Båda uppdateringarna ska behållas.
- Bekräfta en plats medan admin ändrar beskrivningen: bekräftelsen och den valda vuxna ska finnas kvar. Om admin samtidigt byter familj på just den platsen ska sparandet stoppas.
- Två administratörer ändrar olika fält: båda ändringarna behålls. Ändrar de samma fält till olika värden ska den andra få ett begripligt konfliktmeddelande och behålla sina osparade formulärvärden.
- En databasändring precis under sparandet ska kunna hanteras med en ny jämförelse, utan att dubbla utskick skapas eller SportAdmin-kopplingen skrivs över.
- Aktuella kallelsesvar, aktiva familjer och gränsen på ett bemanningspass gäller även efter omläsning.

## Manuell ändring efter automatisk fördelning

- Efter Fördela lediga pass ska admin kunna välja en annan behörig familj i passets familjelista och spara utkastet. Publicerat schema ändras först vid publicering.
- Planeringsvyn läser aktuella laguppgifter när den öppnas och en gång per minut. Uppdatera familjelistan hämtar dem direkt utan att skriva över osparade formulärändringar.
- Familjer med ett annat bemanningspass på evenemanget visas som avstängda alternativ med texten ”har redan ett pass”. Deras nuvarande plats behöver först göras ledig för att flytta familjen. Frivilliga förberedelser omfattas inte av begränsningen.
- Aktiva barn och aktuella ja-svar krävs fortfarande för synkade spelare på kopplade evenemang. Ett gammalt öppet formulär ska använda den senaste hämtade SportAdmin-informationen, inte sin ursprungliga kopia.
