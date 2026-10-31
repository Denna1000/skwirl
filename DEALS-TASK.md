# Wekelijkse taak: aanbiedingen ophalen

Een geplande Claude-taak vult `deals.json` in de privé-repository `skwirl-data`. Plan hem in met `/schedule` in Claude Code, bijvoorbeeld elke maandag om 07:00. Geef de taak toegang tot de repository `skwirl-data` en gebruik onderstaande tekst als opdracht.

> Controleer eerst of je Claude-account hiervoor gebruikt mag worden. Een Hypersolid-licentie is voor werk; vraag het na in #ai-guild of gebruik een eigen account.

---

## Opdracht voor Claude

Je werkt in de repository `skwirl-data`. Daarin staat `household.json` met adressen, winkels (`stores`, met `follow`), ketens (`chains`) en vaste producten (`products`, met `where` = soorten winkels waar het mag).

1. Lees `household.json`. Neem alleen gevolgde winkels (`follow: true`) en alleen de vaste producten.
2. Zoek per product de **aanbiedingen van deze week** bij de ketens van de gevolgde winkels waar het product mag (`where`; leeg = alle ketens). Gebruik alleen openbare pagina's zoals de bonus- of actiepagina's en folders van de ketens. Log nergens in en haal niet meer dan ongeveer 30 pagina's op.
3. Neem een aanbieding alleen op als je redelijk zeker bent dat het om hetzelfde product gaat (merk, soort, maat). Bij losse producten zoals Jonagold telt de soort, niet de verpakking.
4. Schrijf `deals.json` opnieuw, in deze vorm:

```json
{
  "updatedAt": "2026-11-02T07:00:00Z",
  "source": "Claude, wekelijkse taak",
  "deals": [
    {
      "id": "2026-45-etos-hauschka",
      "productId": "hauschka",
      "title": "Dr. Hauschka Rozen dagcrème 30 ml",
      "chain": "etos",
      "price": 21.56,
      "normal": 26.95,
      "mech": "20% korting",
      "until": "zo 9 nov",
      "url": "https://..."
    }
  ]
}
```

   - `id`: `<jaar>-<weeknummer>-<keten>-<productId>`, zodat dezelfde actie dezelfde id houdt.
   - `chain`: een sleutel uit `chains`.
   - `price` en `normal` in euro's per verpakking (of per kg bij los). Onbekend = `null`.
   - `url`: de pagina waar je de actie zag.
5. Laat verlopen acties weg. Verander niets aan `list.json` of `household.json`.
6. Commit met het bericht `Aanbiedingen week <nummer>` en push naar `main`.
7. Geef een korte samenvatting: hoeveel acties, voor welke producten, en wat je niet kon vinden.
