# FuelScope (Vanilla JS PWA)

FuelScope is a lightweight Progressive Web App for showing current and historical fuel prices.
It starts with Thailand data and already supports countries that require city-level prices.

## Features

- Vanilla HTML, CSS, JavaScript (no framework)
- Progressive Web App support via `manifest.json` and `sw.js`
- Current and historical views
- Optional city selector for country-specific behavior
- Flexible data model for adding countries and future API providers
- Offline-first app shell caching

## Run locally

Because this app uses `fetch`, run it behind a local web server:

```bash
python3 -m http.server 8080
```

Open: `http://localhost:8080`

If localhost does not open, ensure the server process is still running in your terminal.

## Local git safety hook

To prevent committing personal paths or accidental secrets, enable the lightweight pre-commit hook:

```bash
./scripts/setup-git-hooks.sh
```

The hook in `.githooks/pre-commit` scans staged added lines for obvious personal path and secret patterns.

## Free hosting (GitHub Pages)

This project is configured for automatic free deployment via GitHub Pages.

Added files:

- `.github/workflows/deploy.yml`
- `.nojekyll`

Steps:

1. Create a new GitHub repository and push this project to branch `main`.
2. In GitHub, open **Settings > Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Push to `main` (or run the workflow manually from the **Actions** tab).
5. Your site will be published at:

  `https://<your-github-username>.github.io/<your-repo-name>/`

After each push to `main`, the site redeploys automatically.

## Live API ingestion (production)

This repository now includes automated ingestion from live data providers:

- Thailand: Bangchak public JSON endpoint
  - `https://oil-price.bangchak.co.th/ApiOilPrice2/thai`
  - No API key required
  - Ingests `PriceYesterday`, `PriceToday`, and `PriceTomorrow` into three dated history points
  - Includes: Gasohol 91, Gasohol 95, Gasohol E20, Gasohol E85, Diesel, Premium Diesel
- France: official Roulez Eco government feed
  - `https://donnees.roulez-eco.fr/opendata/instantane`
  - No API key required
  - ZIP-compressed XML feed decoded from ISO-8859-1
  - Aggregates station prices by configured city radius
  - Includes: Diesel, SP95, E10, SP98, E85, GPLc
  - Does not expose brand names, so brand comparison remains unavailable for France
- Germany: Tankerkonig API (station-based city aggregation)
  - `https://creativecommons.tankerkoenig.de`
  - API key required

Ingestion script:

- `scripts/ingest-fuel-prices.mjs`

Automation workflow:

- `.github/workflows/ingest-fuel-prices.yml`

### Configure GitHub credentials for Germany ingestion

In GitHub repository settings, add one of these:

- Secret: `TANKERKOENIG_API_KEY`
- Variable: `TANKERKOENIG_API_KEY`

Without one of these values, Thailand and France will still refresh and Germany will be skipped safely.
France will still refresh without any secrets.

### Run ingestion locally

```bash
node ./scripts/ingest-fuel-prices.mjs
```

### Run ingestion in GitHub

1. Open **Actions**.
2. Run workflow **Ingest Fuel Prices** manually, or wait for the daily schedule.
3. Workflow updates `data/fuel-prices.json` and pushes changes automatically.

## Data model

Main dataset: `data/fuel-prices.json`

### Country without city split

```json
{
  "code": "TH",
  "name": "Thailand",
  "currencyCode": "THB",
  "unit": "THB per liter",
  "supportsCities": false,
  "fuelTypes": [
    "Gasohol 91",
    "Gasohol 95",
    "Premium 97 Gasohol 95",
    "Gasohol E20",
    "Gasohol E85",
    "Diesel",
    "Premium Diesel"
  ],
  "history": [
    {
      "date": "2026-03-26",
      "prices": {
        "Gasohol 91": 40.68,
        "Gasohol 95": 41.05,
        "Premium 97 Gasohol 95": 57.54,
        "Gasohol E20": 36.05,
        "Gasohol E85": 32.79,
        "Diesel": 38.94,
        "Premium Diesel": 56.84
      }
    }
  ]
}
```

### Country with city split

```json
{
  "code": "DE",
  "name": "Germany",
  "currencyCode": "EUR",
  "unit": "EUR per liter",
  "supportsCities": true,
  "fuelTypes": ["Super E5", "Super E10", "Diesel"],
  "cities": [
    {
      "id": "berlin",
      "name": "Berlin",
      "history": [
        {
          "date": "2026-03-27",
          "prices": {
            "Super E5": 1.86,
            "Super E10": 1.79,
            "Diesel": 1.69
          }
        }
      ]
    }
  ]
}
```

## Adding another country

1. Add a new object under `countries` in `data/fuel-prices.json`.
2. Set `supportsCities` to `true` only if city-level pricing is needed.
3. Keep date format as `YYYY-MM-DD`.
4. Add all fuel types in `fuelTypes` and align `history[*].prices` keys.

## Connecting real-time APIs later

The loading layer in `app.js` uses a provider object:

- `dataProviders.static.loadCatalog()` currently loads local JSON.
- You can add additional providers like `dataProviders.thailandApi`.
- Switch `appState.provider` to route the app to a different source.

This makes the app extensible without rewriting UI rendering code.
