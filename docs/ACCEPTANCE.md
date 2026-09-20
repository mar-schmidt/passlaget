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
- Riktig lagförälder kan logga in, publicera, logga ut och återställa lösenord via rätt portaladress.
- Riktig förälder kan spara sin bekräftelse på en telefon och se samma svar på en annan enhet.
- Anslutningsavbrott ger felmeddelande och ingen falsk kvittens om sparande.
- Kör Supabase Advisors efter migration och konfiguration.

## Kräver valt Google-konto och godkänd testmottagare

- Prenumeration aktiveras endast via bekräftelsemejlet.
- Publicering, byte, inställning och påminnelse ger rätt mottagare och rätt uppdrag.
- Avregistrering stoppar redan köade utskick.
- Avbruten kvittering efter en sändning orsakar inte automatisk dubbelsändning.
- Administratören kan hantera en osäker sändning och se senaste körning.

## Kräver riktiga mobiler

- iPhone/Safari: öppna kalenderfilen, kontrollera svenska tecken, datum och tider och slutför sparandet i Kalender.
- Android/Chrome: öppna Google Kalender-länken och spara en enda händelse med rätt start och slut.
- Testa sommartid och vintertid, upprepade klick och ett ändrat pass. Appen får aldrig påstå att klicket i sig bevisar sparande.
- Kontrollera meny, formulär, tangentbord, läsbarhet och att sidan inte får sidledes rullning vid 390 px bredd.

## Aktuell avgränsning

Webbläsarens administratörsstyrda åtkomstkontroll gick inte att verifiera under bygget. Därför är visuell webbläsargranskning och faktiska mobilkalendrar ännu inte godkända. Komponenten testas separat med en simulerad DOM. Supabase-organisation, riktig Auth/Edge-anslutning, Google-behörighet och verkliga utskick behöver färdigställas när kontoanslutningarna finns. Inga verkliga familjer eller mejlaktiveringar finns i demot.
