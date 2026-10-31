# Aanbiedingen ophalen

De aanbiedingen komen van Claude, via een GitHub Actions-workflow in de privé-repository `skwirl-data`:

| Wanneer | Wat |
|---|---|
| maandag, donderdag en zaterdag, 06:00 | **volledige scan**: alle folders van je winkels, dag- en weekendacties, de folder van volgende week en online acties |
| direct als je in de app een vast product toevoegt of aanpast | **snelle scan** voor alleen dat product (na ±2 tot 5 minuten zichtbaar) |
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
