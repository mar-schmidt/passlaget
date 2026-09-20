Implementationsplan för Landvetter IS bemanningsportal

Version 2 • 20 september 2026 • Uppdaterad med kravet på gratisdrift och kalenderknapp per enskilt pass.

Planen omfattar hela första versionen för ett lag: register, historik, manuell och automatisk planering, öppen föräldrasida, bekräftelser, bytesförfrågningar, tillägg av enskilda pass i mobilens kalender och frivilliga mejlpåminnelser. Flera lag förbereds i datamodellen. Självbetjäning för att ansluta nya lag ingår inte i första versionen. Driftbudgeten är 0 kr: endast kostnadsfria tjänster används, utan automatisk uppgradering eller debiterbar överförbrukning.

**Föreslagen lösning**

| Del                     | Val och ansvar                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Webbsidor               | React och TypeScript, byggda med Vite. Mobilanpassat gränssnitt på svenska.                                                              |
| Hosting                 | GitHub Pages på GitHub Free, med publikt kodrepository och kostnadsfri github.io-adress.                                                 |
| Register och historik   | Supabase Free med PostgreSQL, i en tillgänglig EU-region.                                                                                |
| Administration          | Supabase Auth med mejladress och lösenord, samt behörighet till det aktuella laget.                                                      |
| Sparande                | Supabase Edge Functions med avgränsade funktioner för föräldrar respektive administratörer, inom gratisnivåns kvoter.                    |
| Kalender                | Knapp per pass som erbjuder en Google Kalender-länk eller en kalenderfil (.ics). Ingen kalenderprenumeration.                            |
| Automatiska påminnelser | Google Apps Script och MailApp hämtar och skickar väntande mejl från en beständig kö i Supabase. Ett kostnadsfritt Google-konto används. |
| Uppdatering av portalen | GitHub Actions kontrollerar och publicerar en ny version av webbsidorna.                                                                 |

GitHub Pages är en tjänst för statiska webbsidor. Sparande och inloggning placeras därför hos Supabase Free. Kalenderexporten skapas i webbläsaren och behöver ingen separat kalendertjänst. Bakgrundsutskick hanteras med Google Apps Script, utan krav på köpt domän. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Supabase Edge Functions](https://supabase.com/docs/guides/functions), [Google MailApp](https://developers.google.com/apps-script/reference/mail/mail-app).

Alla föräldrar använder samma portaladress och väljer familj utan identitetskontroll. De kan se hela publicerade evenemangets bemanning med namn och telefonnummer och även bekräfta åt andra familjer. Familjevalet är ett filter, inte en behörighetskontroll. Administrationen skyddas separat; inga föräldrakonton eller personliga inloggningslänkar införs.

**1. Sätt upp grund och åtkomst**

- Skapa ett separat kodprojekt, en lokal testmiljö med påhittade personer och ett Supabase Free-projekt för produktion. Inga betalda testmiljöer behövs. Referensmaterialet och filerna under `sources/` lämnas oförändrade.
- Sätt upp webbsidornas grund, databasändringar med versionshistorik och automatisk kontroll före publicering. Anpassa adresserna till GitHub Pages så att omladdning av en undersida fungerar. Använd hashbaserad navigering i första versionen och rätt Vite-basadress. [Vites anvisningar](https://vite.dev/guide/static-deploy.html#github-pages).
- Skapa administratörsinloggning, utloggning och återställning av lösenord. Endast tillagda administratörer får administrationsbehörighet; registrering som vanlig besökare ger aldrig sådan behörighet. [Supabase Auth](https://supabase.com/docs/guides/auth/passwords).
- Skicka administratörens återställningsmejl via samma kostnadsfria utskickstjänst. Återställningslänk genereras på servern strax före sändning, enbart för en befintlig administratör, med begränsning av upprepade försök och neutralt svar som inte avslöjar konton. Hemliga länkar får inte hamna i publika svar eller vanliga loggar. [Supabase generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).
- Kontrollera administratörens identitet och lagtillhörighet vid varje skyddad åtgärd. Använd databasens behörighetsregler och RLS för exponerade tabeller. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- Ge den öppna föräldradelen begränsade tjänster för publicerad information, bekräftelse, val av ansvarig vuxen, bytesförfrågan och önskemål om mejlpåminnelser. Besökare får inte skriva fritt i register eller schema. Begränsa upprepade anrop och validera tillåtna fält på servern.
- Håll mejladresser, interna kommentarer, utkast, importmaterial och hemliga nycklar utanför publika svar och GitHub Pages-filer. Endast valet av familj och liknande enhetsinställningar sparas lokalt i webbläsaren; gemensamma uppgifter sparas i databasen.

Klart när: en besökare kan läsa ett publicerat testschema och bekräfta ett pass, men inte ändra tider, familjeregister eller utkast. En administratör kan bara ändra sitt eget lag.

**2. Bygg register och tillförlitlig historik**

| Uppgift                        | Hur den representeras                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Lag och administratörer        | Laginställningar och uttryckliga administratörsbehörigheter.                                                      |
| Bemanningsfamilj               | Enheten för rättvisa, med ett eller flera barn och eventuell befrielse från automatisk planering.                 |
| Barn                           | Namn, medlemsstatus och koppling till familjen.                                                                   |
| Vuxen                          | Namn och kontaktuppgifter, kopplad till ett eller flera barn.                                                     |
| Evenemang                      | Datum, plats, information och aktuell publicerad version. Kan omfatta flera dagar.                                |
| Uppdrag och pass               | Uppdragstyp, instruktioner, start, slut och antal personer.                                                       |
| Bemanningsplats                | En av personplatserna i ett pass. Tre personer i kiosken innebär tre platser.                                     |
| Tilldelning                    | Familj, eventuell ansvarig vuxen, ändringsversion och aktuell status.                                             |
| Genomförd insats               | Tillgodoräknas den familj som faktiskt utförde platsens uppdrag. Räknas bara en gång.                             |
| Bekräftelse och bytesförfrågan | Separata uppgifter, kopplade till tilldelningen och den version som besvarades.                                   |
| Mejlprenumeration och utskick  | Vald mottagare, familj eller vuxen, utskicksstatus och avregistrering. Kalenderexport kräver ingen prenumeration. |
| Ändrings- och importhistorik   | Vad som ändrades, när, källa och eventuell administratör. Öppna svar markeras som självdeklarerade.               |

- Använd beständiga ID:n. Namn och telefonnummer får ändras utan att historiken bryts. Delat telefonnummer betyder inte automatiskt att två personer är samma person.
- Koppla syskon till samma bemanningsfamilj. Visa gemensamt saldo vid barnen, men summera aldrig saldot en gång per syskon.
- Avaktivering stoppar nya automatiska tilldelningar och bevarar tidigare insatser. Kommande tilldelningar flaggas för omplanering och försvinner inte tyst.
- Undantag för ledarfamiljer gäller automatiken. Manuellt utförda pass räknas som vanligt.
- Använd lagkoppling och kontrollerade relationer genom hela datamodellen, även när bara ett lag används.

Klart när: samma familj behåller sitt saldo efter telefonbyte, tillagt syskon eller avslutat medlemskap, och uppgifter för två testlag inte blandas.

**3. Förbered och granska importen från underlaget**

- Läs PDF-exportens register, evenemang och historiska schemarader till ett granskningsunderlag. En senare Excel-export kan användas om den blir tillgänglig, men behövs inte för att påbörja arbetet.
- Identifiera återkommande kopior av samma pass i olika sammanställningar. Använd summerade antal som kontrollvärden, inte som ytterligare pass.
- Granska namnvarianter, olika ansvariga vuxna, telefonändringar, markeringar om avslutat medlemskap och ledarundantag. Otydliga matchningar slås inte ihop automatiskt.
- Koppla syskonparets gemensamma historik till en familj. Fem gemensamma insatser får inte bli tio.
- Skilj mellan vakant plats, saknad vuxen, okänt telefonnummer och en tom extrarad. En tom rad betyder inte automatiskt att en extra person behövs.
- Markera platser som andra lag ansvarar för. Bevara instruktioner som inventering vid stängning och förberedelser dagen före evenemanget.
- Hantera osäkra datum och tider, exempelvis ”stängning”, som granskningspunkter. Framtida publicerade pass behöver konkreta tider för kalender och krockkontroll. Registerfältet ”Skapad” används inte som barnets startdatum.
- Visa antal barn, familjer, vuxna, evenemang och unika pass samt beräknat saldo per familj före slutlig import. Äldre schemalagda pass markeras som genomförda först efter att underlagets betydelse har stämts av.
- Gör importen upprepningsbar utan att samma källa skapar dubbletter. Import av historik skickar inga mejl och aktiverar inga prenumerationer.

Klart när: avvikelserna är hanterade eller tydligt markerade, familjesaldona kan förklaras från unika insatser och samma import kan köras igen utan att ändra antalen.

**4. Bygg evenemang och manuell planering**

- Gör en enkel evenemangsguide: namn och datum → uppgifter och tider → antal personer → bemanning → granska och publicera.
- Stöd caféveckor, sammandrag, förberedelser och egna uppgifter. Lägg in de godkända instruktionerna för kiosk, löpare och parkeringsvärd samt stöd för matchvärd, sargbygge och sargrivning.
- Låt administratören tilldela familj och vid behov en namngiven vuxen. Visa obemannade platser, saknad vuxen, obesvarade pass och krockar.
- Kopiera tidigare evenemang med tider och uppgifter som mall, men utan gamla tilldelningar, bekräftelser eller genomförandestatusar.
- Markera andra lags platser så att de inte visas som egna vakanser.
- Spara ändringar i ett arbetsutkast. Ett redan publicerat schema fortsätter visas tills ändringarna publiceras tillsammans. Besökare får aldrig se halvfärdiga uppdateringar.
- Skydda mot att samtidiga redigeringar skriver över varandra. Publicering ska vara en sammanhängande operation som också sparar aktuella passuppgifter och utskicksjobb. Nya kalenderexporter använder den senast publicerade versionen.

Klart när: en hel cafévecka kan skapas, bemannas, kopieras och publiceras, samtidigt som föräldrar bara ser den publicerade versionen.

**5. Lägg till automatisk fördelning och statistik**

Automatiken räknar antal pass, aldrig timmar eller uppgiftens vikt. En familjs planeringssaldo är:

`genomförda insatser + aktiva ännu oavslutade tilldelningar + nya förslag i den aktuella planeringen`

- Varje bemanningsplats räknas en gång för den familj som ansvarar för den. Två angränsande pass samma dag räknas som två insatser. Bekräftelse ger ingen extra insats.
- När ett pass markeras genomfört flyttas det från planerat till genomfört; det läggs inte till en gång till. Ett passerat men ännu oavslutat pass flaggas för uppföljning och behåller sin reservation.
- Välj aktiva familjer med lägst saldo. Ta bort ledarfamiljer och registrerade förhinder från kandidaterna. Vid lika saldo väljs längst tid sedan senaste tilldelade eller genomförda insats, därefter en reproducerbar skiljeregel.
- Bevara manuellt låsta tilldelningar och fyll återstående platser. Höj det tillfälliga saldot direkt efter varje nytt förslag.
- Undvik överlappande familjeuppdrag när vuxen inte är bestämd och blockera överlappande uppdrag för samma vuxen. Administratören kan uttryckligen lägga parallella familjeuppdrag om olika vuxna ansvarar.
- Räkna andra evenemangs publicerade scheman och det aktuella evenemangets valda arbetsversion. Övriga opublicerade utkast reserverar inte familjer i första versionen. Kör kontrollen igen före publicering och visa om ett annat schema har ändrat förutsättningarna.
- Inställda, avbokade eller ersatta tilldelningar belastar inte den tidigare familjen. En väntande bytesförfrågan ändrar däremot inte saldot förrän den godkänts.
- Visa skälet bakom förslagen samt genomförda och planerade pass separat i statistiken. Om kandidater saknas lämnas tydliga luckor för manuell hantering.

Klart när: samma testunderlag ger ett förklarligt förslag utan dubbelräkning, och manuell justering alltid går att göra.

**6. Bygg föräldrarnas flöde och hantering av ändringar**

- Startsidan visar kommande evenemang och en sökbar lista för val av barn/familj. Valet kan kommas ihåg på enheten och ska vara lätt att byta.
- Familjevyn visar tid, plats, uppgift, instruktioner, ansvarig vuxen och bekräftelsestatus. Hela evenemangets bemanning med namn och telefonnummer är tillgänglig.
- Föräldern anger vem som kommer och bekräftar uppdraget. Redan registrerad vuxen kan väljas. Nya kontaktuppgifter för ett pass får inte tyst skriva över grundregistret; registerändringen hanteras av administratören.
- Knyt bekräftelsen till den aktuella tilldelningsversionen. En gammal öppen sida får inte bekräfta ett pass som därefter ändrats.
- Ändrad tid, plats, uppgift eller ansvarig familj/vuxen kräver ny bekräftelse för berörda tilldelningar. Små stavningsrättningar och andra familjers ändringar återställer inte allas svar.
- ”Jag behöver byta / har förhinder” skapar en förfrågan till administratörens översikt. Schemat gäller tills administratören godkänt en ändring.
- Vid godkänt byte uppdateras familj, vuxen, reservation, bekräftelsestatus, underlag för nya kalenderexporter och utskick tillsammans. En redan sparad kalenderkopia hos föräldern ändras inte. Föräldrar ändrar inte själva tider, bemanningsantal eller familjetilldelningar.
- Administratören avslutar evenemanget genom att markera vilka pass som genomfördes och hantera avvikelser. Bekräftelse likställs aldrig automatiskt med genomfört arbete.

Klart när: en förälder kan hitta och bekräfta ett pass i mobilen utan konto, och ett godkänt byte ger rätt resultat för både tidigare och ny familj.

**7. Lägg till kalenderknapp och kostnadsfria mejlpåminnelser**

- Varje enskilt publicerat åtagande får knappen ”Lägg till i kalender”. Exempel: ”Parkeringsvärd – Landvetter IS”, den aktuella lördagen 11.00–13.00. Endast det valda passet tas med.
- Föräldern erbjuds Google Kalender eller en kalenderfil (.ics) för Apple Kalender och andra kompatibla appar. Händelsen innehåller exakt datum, start och slut, plats, uppgift, instruktioner och länk till aktuell information i portalen. Föräldern slutför sparandet i sin kalender.
- Använd Googles mallänk för en förifylld engångshändelse. Portalen behöver ingen anslutning till förälderns Google-konto. Kalenderfilen genereras direkt i webbläsaren med stabilt `UID`, `DTSTAMP`, korrekt textkodning och start/slut beräknade från Europe/Stockholm. [Google om tillägg via länk](https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events#provide_a_link_for_users_to_add_the_event), [iCalendar-standarden](https://www.rfc-editor.org/rfc/rfc5545.html).
- Kontrollera att passet fortfarande är aktuellt före export. Avbokade pass ska inte kunna läggas till och utkast exporteras aldrig.
- Visa kort information: ”En kopia sparas i din kalender. Om passet ändras eller ställs in behöver du uppdatera kalendern själv.” Ändringsmejl och meddelanden i portalen påminner om att rätta eller ta bort en tidigare sparad kalenderpost. Automatisk synkronisering ingår inte längre. [Google om den separata kalenderkopian](https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events#provide_a_link_for_users_to_add_the_event).
- Testa faktisk öppning och sparande på iPhone/Safari och Android/Chrome. Filhanteringen varierar mellan appar; ge kort hjälp och alternativet Google Kalender vid behov. Visa aldrig ”Sparat i kalendern” enbart efter klicket, eftersom portalen inte vet om användaren slutförde sparandet. Ett stabilt fil-ID garanterar inte att alla kalenderappar förhindrar dubbletter.
- Låt varje vuxen välja mejlnotiser för familjen eller egna uppdrag. En bekräftelse av mejladressen aktiverar endast mejlprenumerationen, inte portalåtkomsten. Mejladresser visas inte i det öppna schemat.
- Använd Google Apps Script med en tidsstyrd körning, som standard var femte minut, under ett Google-konto som du eller laget väljer. Körningen hämtar väntande meddelanden från en skyddad serverfunktion, skickar med MailApp och rapporterar resultat. Ingen offentlig Apps Script-webbapp behövs. [Google om tidsstyrda körningar](https://developers.google.com/apps-script/guides/triggers/installable).
- Ge utskickstjänsten en separat, begränsad hemlighet för att hämta och kvittera kön. Spara den i Apps Script Properties och på servern, aldrig i webbsidan. Den ska inte ge administratörsbehörighet eller fri databasåtkomst. Google-behörigheterna begränsas till sändning och nödvändiga externa anrop; inkorgen behöver inte läsas.
- Skicka valda notiser vid publicering, väsentlig ändring och inställning, samt påminnelser före pass. Mottagare ska kunna avsluta prenumerationen från mejlet och hantera sitt önskemål i portalen. Sammanför flera samtidiga uppdrag till ett mejl per mottagare när det går.
- Behåll beständig kö, unika meddelandenycklar, låsning och utskicksjournal i Supabase. Kontrollera aktuellt schema, återstående mejlkvot och prenumeration precis före sändning. Om sändning kan ha lyckats men kvitteringen misslyckas markeras resultatet som osäkert för granskning; skicka inte automatiskt samma mejl igen.
- Prioritera lösenordsåterställning, sena ändringar och inställda pass före rutinpåminnelser när kvoten är knapp. Visa väntande, skickade, osäkra och misslyckade utskick samt senaste lyckade körning. MailApp ger inte något generellt kvitto på faktisk leverans eller läsning. [Google MailApp](https://developers.google.com/apps-script/reference/mail/mail-app).

Klart när: ett valt pass kan sparas som en enskild händelse på mobilen med korrekta tider, och frivilliga mejl fungerar inom gratisgränserna med tydlig hantering av avbrott och osäkra sändningar.

**8. Verifiera, kör pilot och sätt i drift**

- Automatisera tester för rättviseräkning, behörigheter, publicering, samtidiga ändringar och utskick. Kontrollera huvudflödena i mobil- och datorvy, med tangentbord och tydliga felmeddelanden.
- Testa ”Lägg till i kalender” på iPhone och Android, inklusive svenska tecken, sommar- och vintertid, upprepade klick och ett pass som ändrats efter en tidigare export.
- Bygg administratörsexport och en dokumenterad kostnadsfri rutin för lokal databasbackup. Exportera före större import eller ändring och efter avslutat evenemang; prova återställning i testmiljön. Backupfiler med personuppgifter sparas inte i det publika kodrepositoryt. Dokumentera även kontoöverlämning, byte av Google-avsändare och återskapande av utskickstrigger.
- Kontrollera kvoter och avbrottsbeteende. Om Supabase är pausat eller en gratiskvot är slut ska sparande inte ge falska kvittenser och väntande mejl inte tappas bort. Beskriv hur administratören återaktiverar projektet och granskar försenade utskick.
- Publicera webbsidorna via GitHub Pages och kontrollera rätt adresser, serveranslutning och lösenordsåterställning på den riktiga domänen.
- Kör ett verkligt evenemang som pilot med registrerade och kontrollerade uppgifter. Stäm av import, familjesaldon, bekräftelser och påminnelser. Övergå därefter till portalen som den plats där nya ändringar görs, så att två parallella scheman inte utvecklas åt olika håll.

Klart när: alla godkända funktioner fungerar tillsammans för ett evenemang och kontrollerna nedan är godkända. Stegen är byggordning; kalender, mejl och automatisk fördelning ingår i första fullständiga leveransen.

**Acceptanskontroller före drift**

- Ett en- och ett fyratimmarspass ger samma saldo. Två pass samma dag ger två insatser.
- Två syskon och två föräldrar skapar inte fler insatser än de unika uppdrag familjen faktiskt utfört.
- Bekräftelse, upprepad bekräftelse och avslut av samma pass dubblerar inte saldot.
- Ledarfamiljer väljs inte automatiskt men kan bemannas manuellt.
- Historik finns kvar efter namnbyte, telefonbyte och avslutat medlemskap.
- Importen kan upprepas utan dubbletter; oklara källuppgifter redovisas.
- Utkast syns inte för föräldrar och kan varken kalenderexporteras eller starta mejlutskick.
- Publicering och byte uppdaterar berörda uppgifter sammanhängande, även vid samtidiga anrop.
- En inaktuell bekräftelse kan inte acceptera en ny version av passet.
- En öppen besökare kan göra de avtalade föräldraåtgärderna men inte ändra administrationen eller läsa privata registerfält.
- Administratörer kan inte ändra ett annat lags uppgifter; offentliga åtgärder kan inte koppla ett lags familjer till ett annat lags pass.
- Knappen för lördagens parkeringspass 11.00–13.00 skapar exakt en kalenderhändelse med rätt datum, tidszon, plats och uppgift.
- Nya exporter använder ändrade passuppgifter; tidigare sparade kalenderkopior ändras inte automatiskt. Upplysningen om manuell uppdatering visas och klick rapporteras inte som bevis på sparande.
- Upprepade säkra köförsök skapar inte dubbla mejl; osäkra sändningar stoppas för granskning. Avregistrering stoppar även väntande utskick och flyttat ansvar ger inte påminnelser till fel mottagare.
- Förbrukad kvot eller pausat projekt utlöser ingen debitering, förlorar inga köposter och visas som ett driftproblem. Återstart skickar inte gamla rutinpåminnelser om passerade pass.
- Backup kan återställas och gränssnittet fungerar på både mobil och dator.

**Standardvärden att utgå från vid bygget**

- Nya familjer börjar på noll dokumenterade insatser och deltar från aktivt medlemskap. Det kan ge dem fler tidiga förslag när all historik används; inget påhittat startsaldo införs.
- Automatiken kan föreslå flera pass för en familj med lågt saldo, om tiderna fungerar. Saldot räknas om efter varje förslag. Administratören ser fördelningen och kan justera den före publicering; ingen dold gräns ändrar den beslutade prioriteringen efter antal pass.
- Föreslagna mejlpåminnelser är sju dagar och ett dygn före passet, ändringsbart per lag. Om ett pass publiceras sent skickas inte redan passerade påminnelser i efterhand.
- Administratören kan avsluta flera genomförda pass samtidigt, men historiska och nya uppdrag räknas inte som utförda enbart för att tiden har passerat.

**Förutsättningar och gratisdrift**

- Budgeten är 0 kr. Använd GitHub Free, Supabase Free och ett kostnadsfritt Google-konto. Ingen köpt domän, betalplan, provperiod som övergår till betalning eller automatisk överförbrukningsdebitering får krävas. Om gratisvillkor ändras behöver lösningen omprövas innan någon kostnad uppstår.
- GitHub Pages använder ett publikt kodrepository och den inkluderade github.io-adressen. Personregister, backupfiler, PDF-export och hemliga nycklar ligger utanför repositoryt och de publicerade webbfilerna. [GitHubs villkor för Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
- Supabase Free används även i produktion. Gratisnivån omfattar bland annat 500 MB databas och 5 GB utgående trafik. Den kan pausas efter en veckas inaktivitet och saknar automatiska backuper. Planen innehåller därför egen export/backup och en rutin för återaktivering. Vanlig användning eller bakgrundskörningar antas inte garantera att projektet aldrig pausas. [Supabase Free](https://supabase.com/pricing).
- Google Apps Script skickar från kontot som äger utskickstriggern. Ett vanligt kostnadsfritt Google-konto har för närvarande en MailApp-kvot på 100 mottagare per dygn; den delas med kontots övriga skript. En mottagare i två mejl förbrukar två mottagarplatser. Kontrollera återstående kvot, samla lämpliga notiser och visa väntande utskick när gränsen nås. [Googles kvoter](https://developers.google.com/apps-script/guides/services/quotas), [MailApp](https://developers.google.com/apps-script/reference/mail/mail-app).
- Kontoägaren behöver vid uppsättning godkänna sändningsbehörighet och externa anrop för skriptet. Inga föräldrar behöver ansluta sina Google-konton till portalen för mejl eller kalenderexport.
- Gratisdrift innebär att köade mejl kan försenas vid kvotbrist, paus eller driftavbrott. Portalen visar status när servern kan nås och ett tydligt fel vid avbrott; kalenderknappen är användbar så länge aktuella passuppgifter kan hämtas. Ingen garanti om ständig tillgänglighet eller exakt utskicksminut lämnas.
- Kontrollerat 20 september 2026. Före faktisk datainläsning behöver återstående person- och historikavvikelser hanteras. De hindrar inte gränssnitts- och funktionsbygget med testdata.

Denna leverans är en implementationsplan. Inga externa projekt, abonnemang, utskick eller publiceringar har skapats.
