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
cd /Users/walter/Documents/akquinet/Projects/FuelPrices
python3 -m http.server 8080
```

Open: `http://localhost:8080`

If localhost does not open, ensure the server process is still running in your terminal.

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
  "fuelTypes": ["Gasohol 91", "Gasohol 95", "Diesel"],
  "history": [
    {
      "date": "2026-03-27",
      "prices": {
        "Gasohol 91": 37.28,
        "Gasohol 95": 37.55,
        "Diesel": 32.12
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
