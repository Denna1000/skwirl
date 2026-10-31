# Skwirl

Slim inslaan. Nooit te veel betalen.

Een gedeeld boodschappenlijstje voor twee, met vaste producten, je eigen plekken en wekelijkse aanbiedingen. De app draait gratis op GitHub Pages; alle gegevens staan in een **privé** GitHub-repository. Er is geen server en geen account bij een andere dienst nodig.

- **Boodschappen**: per winkel, tegels zoals in Bring. Tik erop of eraf; houd ingedrukt voor eigenschap (bio, 500 ml) of aantal. Producten kunnen voor "elke supermarkt" of "drogist of online" gelden.
- **Vandaag**: je lijstje, de beste winkel voor de aanbiedingen van nu, en wat bijna op is.
- **Producten**: wat je steeds opnieuw koopt. Tik je het van de lijst, dan weet Skwirl wanneer het weer op is.
- **Plekken**: je adressen en de winkels die je volgt, en een koppellink voor een tweede telefoon.

> Status: persoonlijke app voor twee gebruikers, geen product voor publiek. Zie [Bekende beperkingen](#bekende-beperkingen).

## Zo zet je het op

### 1. Twee repositories

Maak op GitHub (gratis account, geen creditcard nodig):

| Repository | Zichtbaarheid | Inhoud |
|---|---|---|
| `skwirl` | **openbaar** (GitHub Pages is alleen gratis voor openbare repositories) | deze code, zonder persoonlijke gegevens |
| `skwirl-data` | **privé** | `list.json`, `household.json`, `deals.json` |

Zet de code en de gegevens erin:

```bash
cd ~/skwirl && git add -A && git commit -m "feat: eerste versie van Skwirl" && git remote add origin https://github.com/<jouw-naam>/skwirl.git && git push -u origin main
```

```bash
cd ~/skwirl-data && git add -A && git commit -m "chore: startgegevens" && git remote add origin https://github.com/<jouw-naam>/skwirl-data.git && git push -u origin main
```

### 2. GitHub Pages aanzetten

In `skwirl` → **Settings → Pages → Build and deployment → Source: GitHub Actions**. Na de volgende push staat de app op `https://<jouw-naam>.github.io/skwirl/`.

### 3. Een sleutel maken

**Settings (van je account) → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**

- Repository access: **Only select repositories → `skwirl-data`**
- Permissions → Repository permissions → **Contents: Read and write** (Metadata: read gaat vanzelf mee)
- Expiration: bijvoorbeeld 1 jaar. Zet een herinnering om hem te vernieuwen.

Deze sleutel kan alleen bij `skwirl-data`, nergens anders.

### 4. Openen en koppelen

1. Open de app op je telefoon en vul je naam, GitHub-gebruikersnaam, `skwirl-data` en de sleutel in.
2. Zet hem op je beginscherm: Safari → Deel → **Zet op beginscherm** (Android: menu → App installeren).
3. Voor je vriendin: **Plekken → Telefoon koppelen** en stuur haar de link. Zij vult alleen haar naam in en heeft geen GitHub-account nodig.

### 5. Aanbiedingen

Zie [DEALS-TASK.md](DEALS-TASK.md) voor de wekelijkse Claude-taak die `deals.json` vult.

## Veiligheid en privacy

- De sleutel staat alleen op jullie telefoons (in de opslag van de browser) en in de koppellink. Deel die link alleen met je vriendin en verwijder het bericht daarna.
- Telefoon kwijt of link gelekt? Trek de sleutel in op GitHub en maak een nieuwe.
- In deze openbare repository staan geen adressen of andere persoonlijke gegevens. Die staan alleen in `skwirl-data`. Houd die repository privé.
- Adres zoeken gaat via [PDOK](https://www.pdok.nl/), de openbare adresdienst van de overheid; alleen wat je in het zoekveld typt gaat daarheen.
- Lettertypen komen van Google Fonts.

## Ontwikkelen

Vereist Node 24 of nieuwer. TypeScript is de enige afhankelijkheid; er is geen bundler.

```bash
corepack enable && pnpm install --ignore-scripts
```

```bash
pnpm test && pnpm run typecheck
```

Lokaal draaien met een nep-GitHub die de bestanden uit `../skwirl-data` in het geheugen houdt (er wordt niets naar GitHub geschreven):

```bash
pnpm run build && MOCK_DATA=../skwirl-data node scripts/serve.mjs
```

Zet daarna in de browserconsole op `http://127.0.0.1:5173` een testkoppeling en herlaad:

```js
localStorage.setItem('skwirl-config', JSON.stringify({ name: 'Test', owner: 'lokaal', repo: 'skwirl-data', token: 'nep', branch: 'main', api: 'http://127.0.0.1:5173/__mock' }))
```

| Map | Inhoud |
|---|---|
| `src/app.ts` | schermen, interactie |
| `src/github.ts` | opslag via de GitHub Contents API, met samenvoegen bij gelijktijdige wijzigingen en wachtrij zonder netwerk |
| `src/art.ts` | tekeningen in Skwirl-stijl per productsoort |
| `src/parse.ts` | "chiazaad, bio", "2 kg jonagold", "3x yoghurt" |
| `public/` | HTML, CSS, manifest, service worker, iconen |

## Bekende beperkingen

- **Niet live**: de app ververst elke 10 seconden en als je hem opent.
- **Elke tik is een commit** in `skwirl-data`. Dat is prima voor twee mensen, maar de geschiedenis groeit.
- **Eén gedeelde sleutel**: alle wijzigingen staan op GitHub op naam van de eigenaar; in de app staat wie iets toevoegde.
- **Aanbiedingen** zijn zo goed als wat de wekelijkse taak vindt. Controleer de prijs in de winkel.
- Nog niet gebouwd: kassabon scannen, bestellingen ophalen, besparingsoverzicht.
