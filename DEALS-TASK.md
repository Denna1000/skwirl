# Aanbiedingen ophalen

De aanbiedingen komen van Claude, via een GitHub Actions-workflow in de privé-repository `skwirl-data`:

| Wanneer | Wat |
|---|---|
| werkdagen, het eerste moment na 9:30 dat je Mac aanstaat | je **Mac** haalt de folders op die GitHub-servers niet mogen ophalen (AH, Vomar via supermarktaanbiedingen.com) en zet ze in `bron/folders.json`. Daarna start op GitHub een **volledige scan** |
| zaterdag 08:00 | **volledige scan** met de laatste folders van de Mac (tot 4 dagen oud), Ekoplaza en zoekmachines |
| direct als je in de app een vast product toevoegt of aanpast | **snelle scan** voor alleen dat product (na ±2 tot 5 minuten zichtbaar) |
| "Nu zoeken" in de app | volledige scan op GitHub; staat je Mac aan, dan haalt die binnen een kwartier ook verse folders op (daarna nog een scan) |
| met de hand | GitHub → `skwirl-data` → **Actions → Aanbiedingen → Run workflow** (optioneel met product-id's) |

De opdracht voor Claude staat in `skwirl-data/SCAN.md`. De workflow staat in `skwirl-data/.github/workflows/aanbiedingen.yml`.

## Eenmalig instellen

1. **Token voor Claude maken.** Open Terminal en typ `claude setup-token`. Log in met je Claude-account en kopieer de token die verschijnt.
   > Dit gebruikt het abonnement van dat Claude-account. Een Hypersolid-licentie is voor werk: vraag in #ai-guild of dit mag, of gebruik een eigen Claude-account.
2. **Token in GitHub zetten.** Ga naar `github.com/<jouw-naam>/skwirl-data` → **Settings → Secrets and variables → Actions → New repository secret**. Naam: `CLAUDE_CODE_OAUTH_TOKEN`, waarde: de token. Plak hem nergens anders.
3. **Claude-app toegang geven.** Installeer de GitHub-app van Claude op `skwirl-data`: `github.com/apps/claude` → **Install** → kies alleen `skwirl-data`.
4. **Testen.** Actions → Aanbiedingen → **Run workflow**. Na een paar minuten staat er een commit "Aanbiedingen …" en zie je de acties in de app.

## Kosten

GitHub Actions is gratis tot 2.000 minuten per maand voor privé-repositories; een scan duurt een paar minuten. Claude rekent af via het abonnement van het account waarvan de token is.

## De Mac als bron (eenmalig instellen)

Sommige sites weigeren de servers van GitHub. Daarom haalt je Mac die pagina's op, zoals een gewone bezoeker. De Mac kijkt elk kwartier dat hij aanstaat of het tijd is: op werkdagen het eerste moment na 9:30 (één keer per dag), of als iemand in de app op "Nu zoeken" tikte. Ben je vrij en staat de Mac pas om 14:00 aan, dan gebeurt het om 14:00.

1. **Sleutel voor de Mac.** Maak op GitHub een fine-grained token die alleen bij `skwirl-data` mag, met **Contents: Read and write** (zoals die voor de app; je mag ook dezelfde gebruiken).
2. **Sleutel in de sleutelhanger zetten.** Open Terminal en typ (je plakt de token twee keer; je ziet niets terwijl je plakt):

   ```bash
   security add-generic-password -a skwirl -s skwirl-github -T /usr/bin/security -w
   ```

3. **Testen:**

   ```bash
   node ~/skwirl-data/scripts/mac-bron.mjs
   ```

   Je ziet per keten het aantal regels en daarna "Verstuurd". Een paar minuten later staat er op GitHub een commit "Aanbiedingen …".

De taak staat in `~/Library/LaunchAgents/nl.skwirl.folders.plist`; het logboek in `~/Library/Logs/skwirl-folders.log`.

**Stoppen:**

```bash
launchctl bootout gui/$(id -u)/nl.skwirl.folders
```

