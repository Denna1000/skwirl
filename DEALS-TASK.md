# Geplande taak: aanbiedingen ophalen

Een geplande Claude-taak vult `deals.json` in de privé-repository `skwirl-data`. Plan hem in met `/schedule` in Claude Code en geef de taak toegang tot `skwirl-data`.

**Hoe vaak?** Dag- en weekendacties (Kruidvat, Vomar-dagknallers) veranderen elke dag. Daarom draait de taak bij voorkeur **elke ochtend om 07:00**. Wil je minder tokens gebruiken, kies dan maandag, donderdag en zaterdag: dan mis je sommige dagacties, maar wel de weekfolders en het weekend.

> Controleer eerst of je Claude-account hiervoor gebruikt mag worden. Een Hypersolid-licentie is voor werk; vraag het na in #ai-guild of gebruik een eigen account.

---

## Opdracht voor Claude

Je werkt in de repository `skwirl-data`. Daarin staat `household.json` met adressen, winkels (`stores`), ketens (`chains`) en vaste producten (`products`, met `where` = soorten winkels waar het mag; leeg = overal).

1. Lees `household.json` en de bestaande `deals.json`.
2. Zoek voor de vaste producten acties bij de ketens van de winkels in `stores`, alleen waar het product mag volgens `where`. Kijk naar:
   - **lopende acties** van deze week;
   - **komende acties**: de folder van volgende week zodra die online staat, bijvoorbeeld de AH-bonusfolder (`https://www.ah.nl/bonus/folder`) en de Vomar-folder van volgende week;
   - **dag- en weekendacties**, zoals de Vomar-dagknallers en de dag- en weekendacties van Kruidvat.

   Gebruik alleen openbare pagina's (actiepagina's en folders). Log nergens in en haal per run niet meer dan ongeveer 30 pagina's op.
3. Neem een actie alleen op als je redelijk zeker bent dat het om hetzelfde product gaat (merk, soort, maat). Bij losse producten zoals Jonagold telt de soort, niet de verpakking.
4. Schrijf `deals.json` opnieuw:
   - Houd acties uit de bestaande `deals.json` die nog niet verlopen zijn, tenzij je nu iets beters of juisters vindt voor dezelfde `id`.
   - Laat verlopen acties weg (`until` ligt voor vandaag).
   - Vorm:

```json
{
  "updatedAt": "2026-11-02T07:00:00Z",
  "source": "Claude, geplande taak",
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
      "url": "https://www.ah.nl/bonus/folder"
    }
  ]
}
```

   | Veld | Betekenis |
   |---|---|
   | `id` | `<jaar>-<weeknummer>-<keten>-<productId>`; voor dag- en weekendacties plak je de begindatum erachter, bijv. `2026-44-kruidvat-hauschka-2026-10-31` |
   | `chain` | een sleutel uit `chains` |
   | `price`, `normal` | euro's per verpakking (of per kg bij los); onbekend = `null` |
   | `from`, `until` | eerste en laatste dag, als `YYYY-MM-DD`. Altijd invullen als de folder het noemt; een AH-week loopt van maandag t/m zondag |
   | `span` | `"week"`, `"dag"` (één dag, zoals een dagknaller) of `"weekend"` |
   | `url` | de pagina waar je de actie zag |

5. Verander niets aan `list.json` of `household.json`.
6. Commit met het bericht `Aanbiedingen <datum>` en push naar `main`.
7. Geef een korte samenvatting: hoeveel acties nu, hoeveel komende, welke dag- of weekendacties, en wat je niet kon vinden.

De app laat komende acties zien onder **Binnenkort in de aanbieding**, met de begindatum en een advies om te wachten als je nog genoeg hebt. Dag- en weekendacties krijgen een eigen label.
