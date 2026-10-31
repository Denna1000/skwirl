# Geplande taak: aanbiedingen ophalen

Een geplande Claude-taak vult `deals.json` in de privé-repository `skwirl-data`. Plan hem in met `/schedule` in Claude Code en geef de taak toegang tot `skwirl-data`.

**Hoe vaak?** Dag- en weekendacties (Kruidvat, Vomar-dagknallers) veranderen elke dag. Daarom draait de taak bij voorkeur **elke ochtend om 07:00**. Wil je minder tokens gebruiken, kies dan maandag, donderdag en zaterdag: dan mis je sommige dagacties, maar wel de weekfolders en het weekend.

> Controleer eerst of je Claude-account hiervoor gebruikt mag worden. Een Hypersolid-licentie is voor werk; vraag het na in #ai-guild of gebruik een eigen account.

---

## Opdracht voor Claude

Je werkt in de repository `skwirl-data`. Daarin staat `household.json` met adressen, winkels (`stores`), ketens (`chains`) en vaste producten (`products`). Per product:

| Veld | Betekenis |
|---|---|
| `name`, `cat` | naam en categorie |
| `where` | soorten winkels waar het mag (`super`, `drogist`, `online`, `slager`, `bouw`); leeg = overal |
| `brand` | voorkeursmerk; leeg = maakt niet uit |
| `wants` | wat de gebruiker precies wil, bijv. "groot stuk, jong belegen", "halfvol", "voor avondeten" |
| `avoid` | wat juist niet, bijv. "plakken", "vleeswaren voor op brood" |
| `loose` | los product zonder barcode (bijv. Jonagold): de soort telt, niet de verpakking |

1. Lees `household.json` en de bestaande `deals.json`.
2. Lees per keten van de winkels in `stores` de **hele folder**: alle acties, niet alleen die voor de vaste producten. Kijk naar:
   - **lopende acties** van deze week;
   - **komende acties**: de folder van volgende week zodra die online staat, bijvoorbeeld de AH-bonusfolder (`https://www.ah.nl/bonus/folder`) en de Vomar-folder van volgende week;
   - **dag- en weekendacties**, zoals de Vomar-dagknallers en de dag- en weekendacties van Kruidvat.

   Gebruik alleen openbare pagina's (actiepagina's en folders). Log nergens in. Neem per keten en per week hooguit 60 acties op; kies dan eerst eten, drinken, drogisterij en huishouden.
3. **Zoek voor elk vast product altijd naar acties**, ook als het niet op de boodschappenlijst staat, en koppel ze met `productId`. Denk na over wat er echt in de aanbieding is:
   - Past het bij `wants` en niet bij `avoid`? Bijvoorbeeld: bij kaas met "groot stuk" en niet "plakken" telt "Old Amsterdam plakken 150 g" **niet**, en "Beemster jong belegen stuk 500 g" wel. Bij kipfilet "voor avondeten" telt "kipfilet naturel 1 kg" wel en "gerookte kipfilet broodbeleg" niet. Bij melk "halfvol" telt volle melk niet.
   - Klopt het merk als `brand` is ingevuld? Een ander merk mag alleen als `wants` dat toelaat.
   - Twijfel je, koppel dan niet en zet de actie zonder `productId` in de lijst.
   - Schrijf in `note` in één korte zin waarom de actie past, bijv. "Stuk jong belegen 500 g, geen plakken".
   - Acties voor vaste producten tellen niet mee voor de grens van 60 per keten: neem ze altijd op.

   Andere acties krijgen `"productId": null` en een duidelijke `title` met merk en maat.

   **Online:** voor producten met `online` in `where` zoek je breed bij Nederlandse webshops (bijvoorbeeld bol, Douglas, ICI Paris XL, Holland & Barrett, de webshops van drogisterijen, en prijsvergelijkers zoals beslist.nl of kieskeurig.nl). Zet zulke acties op `"chain": "online"` met de naam van de webshop in `shop`. Neem alleen echte acties op (korting, x+1 gratis, tijdelijk lagere prijs), niet de gewone prijs.
4. Schrijf `deals.json` opnieuw:
   - Houd acties uit de bestaande `deals.json` die nog niet verlopen zijn, tenzij je nu iets beters of juisters vindt voor dezelfde `id`.
   - Laat verlopen acties weg (`until` ligt voor vandaag).
   - Vorm:

```json
{
  "updatedAt": "2026-11-02T07:00:00Z",
  "source": "Claude, geplande taak",
  "folders": [
    { "chain": "ah", "from": "2026-11-02", "until": "2026-11-08", "url": "https://www.ah.nl/bonus/folder" }
  ],
  "deals": [
    {
      "id": "2026-45-ah-jonagold",
      "productId": "jonagold",
      "title": "Jonagold appels 1,5 kg",
      "chain": "ah",
      "price": 1.99,
      "normal": 2.79,
      "mech": "25% korting",
      "from": "2026-11-02",
      "until": "2026-11-08",
      "span": "week",
      "url": "https://www.ah.nl/bonus/folder",
      "note": "Losse Jonagold, geen sap of moes",
      "amount": 1.5,
      "unit": "kg",
      "effPrice": null
    }
  ]
}
```

   | Veld | Betekenis |
   |---|---|
   | `id` | `<jaar>-<weeknummer>-<keten>-<productId of korte naam>`, bijv. `2026-45-ah-jonagold` of `2026-45-ah-hertog-jan-krat`; voor dag- en weekendacties plak je de begindatum erachter, bijv. `2026-44-kruidvat-hauschka-2026-10-31` |
   | `chain` | een sleutel uit `chains` |
   | `price`, `normal` | euro's per verpakking (of per kg bij los); onbekend = `null` |
   | `from`, `until` | eerste en laatste dag, als `YYYY-MM-DD`. Altijd invullen als de folder het noemt; een AH-week loopt van maandag t/m zondag |
   | `span` | `"week"`, `"dag"` (één dag, zoals een dagknaller) of `"weekend"` |
   | `url` | de pagina waar je de actie zag |
   | `shop` | alleen bij `"chain": "online"`: de naam van de webshop |
   | `note` | bij vaste producten: waarom de actie past |
   | `amount`, `unit` | inhoud per verpakking in `kg` of `l`, multipacks opgeteld: 500 g = `0.5` + `"kg"`, 2 × 1,5 L = `3` + `"l"`. Leeg laten bij stuks (zoals een tube crème) |
   | `effPrice` | prijs per verpakking als je de actie benut: bij "2e halve prijs" 0,75 × `price`, bij "1+1 gratis" 0,5 × `price`, bij "3 voor € 5" € 1,67. Leeg als `price` al de actieprijs is |

   De app rekent hiermee de prijs per kilo of liter uit en zet de voordeligste bovenaan. Vul `amount` en `unit` dus altijd in als de folder het gewicht of de inhoud noemt.

   Zet in `folders` per keten de link naar de folder of actiepagina van deze week, en van volgende week als die al online staat, met `from` en `until`. De app toont die als knop **Folder openen**.

5. Verander niets aan `list.json` of `household.json`. Haal per run niet meer dan ongeveer 80 pagina's op in totaal.
6. Commit met het bericht `Aanbiedingen <datum>` en push naar `main`.
7. Geef een korte samenvatting: hoeveel acties nu, hoeveel komende, welke dag- of weekendacties, en wat je niet kon vinden.

De app toont alles per winkel op het tabblad **Folders** (dag- en weekendacties, deze week, volgende week). Komende acties voor je vaste producten staan ook op Vandaag onder **Binnenkort in de aanbieding**, met de begindatum en een advies om te wachten als je nog genoeg hebt. Dag- en weekendacties krijgen een eigen label.
