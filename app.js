const DATA_URL = "./data/fuel-prices.json";
const LOCALE_STORAGE_KEY = "fuelscope.locale";
const WATCHLIST_STORAGE_KEY = "fuelscope.watchlist";
const I18N_BASE_PATH = "./assets/i18n";
const SUPPORTED_LOCALES = ["en-US", "en-GB", "de-DE", "fr-FR", "th-TH"];
const BRAND_ROWS_VISIBLE = 12;
const FALLBACK_MESSAGES = {
  "section.watchlist": "Price Alert Watchlist",
  "section.compareCities": "Compare Cities",
  "section.quickActions": "Quick Actions",
  "section.dataFreshness": "Data Freshness",
  "label.compareCities": "Compare cities",
  "hint.compareCities": "Tip: Cmd/Ctrl-click to select up to 4 cities.",
  "placeholder.watchThreshold": "Threshold",
  "button.addAlert": "Add Alert",
  "button.findNearby": "Find Nearby Cheapest City",
  "button.shareSnapshot": "Share Snapshot",
  "button.exportCsv": "Export Trend CSV",
  "button.showAllBrands": "Show all brands",
  "button.showFewerBrands": "Show fewer brands",
  "aria.watchFuelType": "Fuel type",
  "aria.watchThreshold": "Alert threshold",
};

const dataProviders = {
  static: {
    async loadCatalog() {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Could not load data: ${response.status}`);
      }
      return response.json();
    },
  },
};

const appState = {
  provider: "static",
  catalog: null,
  selectedCountryCode: "",
  selectedCityId: "",
  selectedBrandFuel: "",
  locale: "en-US",
  messages: {},
  mode: "current",
  watchlist: [],
  brandExpanded: false,
};

const el = {
  countrySelect: document.getElementById("countrySelect"),
  cityControl: document.getElementById("cityControl"),
  citySelect: document.getElementById("citySelect"),
  citySearch: document.getElementById("citySearch"),
  citySearchHint: document.getElementById("citySearchHint"),
  citySearchCount: document.getElementById("citySearchCount"),
  dateControl: document.getElementById("dateControl"),
  historicalDate: document.getElementById("historicalDate"),
  statusBanner: document.getElementById("statusBanner"),
  priceGrid: document.getElementById("priceGrid"),
  trendHead: document.querySelector("#trendTable thead"),
  trendBody: document.querySelector("#trendTable tbody"),
  stationStatusBar: document.getElementById("stationStatusBar"),
  nationalStatsSection: document.getElementById("nationalStatsSection"),
  nationalStatsGrid: document.getElementById("nationalStatsGrid"),
  zipSearchControl: document.getElementById("zipSearchControl"),
  zipInput: document.getElementById("zipInput"),
  zipHint: document.getElementById("zipHint"),
  languageSelect: document.getElementById("languageSelect"),
  brandComparisonSection: document.getElementById("brandComparisonSection"),
  brandFuelTabs: document.getElementById("brandFuelTabs"),
  brandComparisonChart: document.getElementById("brandComparisonChart"),
  brandExpandBtn: document.getElementById("brandExpandBtn"),
  brandReliabilityInfo: document.getElementById("brandReliabilityInfo"),
  watchFuelTypeSelect: document.getElementById("watchFuelTypeSelect"),
  watchThresholdInput: document.getElementById("watchThresholdInput"),
  addWatchBtn: document.getElementById("addWatchBtn"),
  watchlistAlerts: document.getElementById("watchlistAlerts"),
  watchlistList: document.getElementById("watchlistList"),
  compareCitySelect: document.getElementById("compareCitySelect"),
  comparisonTableWrap: document.getElementById("comparisonTableWrap"),
  findNearbyBtn: document.getElementById("findNearbyBtn"),
  nearbyResult: document.getElementById("nearbyResult"),
  shareSnapshotBtn: document.getElementById("shareSnapshotBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  freshnessInfo: document.getElementById("freshnessInfo"),
};

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  }
}

function t(id, vars = {}) {
  const template = appState.messages[id] || FALLBACK_MESSAGES[id] || id;
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] ?? "").toString());
}

function normalizeLocale(locale) {
  if (!locale) return null;
  const lower = locale.toLowerCase();
  const exact = SUPPORTED_LOCALES.find((entry) => entry.toLowerCase() === lower);
  if (exact) return exact;
  const lang = lower.split("-")[0];
  return SUPPORTED_LOCALES.find((entry) => entry.toLowerCase().startsWith(`${lang}-`)) || null;
}

function detectInitialLocale() {
  const stored = normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
  if (stored) return stored;

  const browserLocales = [navigator.language, ...(navigator.languages || [])];
  for (const candidate of browserLocales) {
    const matched = normalizeLocale(candidate);
    if (matched) return matched;
  }

  return "en-US";
}

function parseXliff(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid XLIFF format");
  }

  const messages = {};
  doc.querySelectorAll("trans-unit").forEach((unit) => {
    const id = unit.getAttribute("id");
    if (!id) return;
    const target = unit.querySelector("target")?.textContent?.trim();
    const source = unit.querySelector("source")?.textContent?.trim();
    messages[id] = target || source || id;
  });

  return messages;
}

async function loadLocale(locale) {
  const response = await fetch(`${I18N_BASE_PATH}/${locale}.xlf`);
  if (!response.ok) {
    throw new Error(`Could not load locale ${locale}: ${response.status}`);
  }
  appState.messages = parseXliff(await response.text());
  appState.locale = locale;
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.documentElement.lang = locale;
}

function applyStaticTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    node.textContent = t(key);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    const key = node.getAttribute("data-i18n-placeholder");
    node.setAttribute("placeholder", t(key));
  });

  document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
    const key = node.getAttribute("data-i18n-aria-label");
    node.setAttribute("aria-label", t(key));
  });

  document.title = t("meta.title");
}

function localeDisplayName(locale) {
  const names = {
    "en-US": "English (US)",
    "en-GB": "English (UK)",
    "de-DE": "Deutsch",
    "fr-FR": "Francais",
    "th-TH": "ไทย",
  };
  return names[locale] || locale;
}

function populateLanguageSelect() {
  if (!el.languageSelect) return;
  el.languageSelect.innerHTML = SUPPORTED_LOCALES
    .map((locale) => `<option value="${locale}">${localeDisplayName(locale)}</option>`)
    .join("");
  el.languageSelect.value = appState.locale;
}

function formatPrice(price, currencyCode) {
  return new Intl.NumberFormat(appState.locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
}

// Idea 3: format a lastChange object { timestamp, amount } into a human-readable string
function formatPriceChange({ timestamp, amount }) {
  const arrow = amount > 0 ? "↑" : amount < 0 ? "↓" : "→";
  const sign = amount > 0 ? "+" : "";
  const amtStr = `${sign}${Number(amount).toFixed(3)}`;
  const ago = formatRelativeTime(timestamp);
  return t("price.change.lastChanged", { arrow, amount: amtStr, ago });
}

function formatRelativeTime(isoTimestamp) {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return t("time.lt1hAgo");
  if (hours < 24) return t("time.hAgo", { hours });
  const days = Math.floor(hours / 24);
  return t("time.dAgo", { days });
}

function formatIsoTime(isoString) {
  return new Date(isoString).toLocaleTimeString(appState.locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function sortDatesDescending(entries) {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date));
}

function toDayStamp(dateValue) {
  return new Date(dateValue).toISOString().slice(0, 10);
}

function getCountryByCode(code) {
  return appState.catalog.countries.find((country) => country.code === code);
}

function getLocationData(country, selectedCityId) {
  if (country.supportsCities) {
    const city = country.cities.find((entry) => entry.id === selectedCityId) || country.cities[0];
    return {
      scopeLabel: `${city.name}, ${country.name}`,
      dataset: city,
    };
  }

  return {
    scopeLabel: country.name,
    dataset: country,
  };
}

function updateStatus(message) {
  el.statusBanner.textContent = message;
}

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    appState.watchlist = raw ? JSON.parse(raw) : [];
  } catch {
    appState.watchlist = [];
  }
}

function saveWatchlist() {
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(appState.watchlist));
}

function getSelectedDataset() {
  const country = getCountryByCode(appState.selectedCountryCode);
  if (!country) return null;
  return getLocationData(country, appState.selectedCityId);
}

function renderWatchFuelTypeSelect(country) {
  if (!el.watchFuelTypeSelect || !country) return;
  el.watchFuelTypeSelect.innerHTML = country.fuelTypes
    .map((fuel) => `<option value="${fuel}">${fuel}</option>`)
    .join("");
}

function evaluateWatchlistAlerts(country) {
  if (!country?.supportsCities) return [];
  return appState.watchlist
    .filter((w) => w.countryCode === country.code)
    .map((w) => {
      const city = country.cities.find((c) => c.id === w.cityId);
      const latest = city?.history?.[0];
      const price = latest?.prices?.[w.fuelType];
      return {
        ...w,
        cityName: city?.name || w.cityId,
        price,
        isMet: typeof price === "number" && price <= w.threshold,
      };
    });
}

function renderWatchlist() {
  const country = getCountryByCode(appState.selectedCountryCode);
  if (!el.watchlistList || !country) return;

  const evaluated = evaluateWatchlistAlerts(country);
  const inCountry = evaluated.filter((item) => item.countryCode === country.code || item.cityName);
  const met = inCountry.filter((item) => item.isMet);

  if (el.watchlistAlerts) {
    el.watchlistAlerts.textContent = met.length
      ? `${met.length} alert${met.length > 1 ? "s" : ""} triggered.`
      : "No alerts triggered right now.";
  }

  if (!inCountry.length) {
    el.watchlistList.innerHTML = `<li class="watch-empty">No watchlist entries for this country yet.</li>`;
    return;
  }

  el.watchlistList.innerHTML = inCountry
    .map(
      (item) => `<li class="watch-item${item.isMet ? " watch-met" : ""}">
        <span>${item.cityName} · ${item.fuelType} ≤ ${item.threshold.toFixed(3)}</span>
        <span>${typeof item.price === "number" ? item.price.toFixed(3) : "-"}</span>
        <button type="button" data-watch-id="${item.id}" class="watch-remove">Remove</button>
      </li>`,
    )
    .join("");
}

function renderComparisonTable() {
  const country = getCountryByCode(appState.selectedCountryCode);
  if (!country?.supportsCities || !el.compareCitySelect || !el.comparisonTableWrap) return;

  const sortedCities = getSortedCities(country);
  const currentlySelected = new Set(Array.from(el.compareCitySelect.selectedOptions).map((o) => o.value));
  el.compareCitySelect.setAttribute("aria-label", t("label.compareCities"));
  el.compareCitySelect.innerHTML = sortedCities
    .map((city) => `<option value="${city.id}"${currentlySelected.has(city.id) ? " selected" : ""}>${city.name}</option>`)
    .join("");

  let selectedIds = Array.from(el.compareCitySelect.selectedOptions).map((o) => o.value);
  if (!selectedIds.length && appState.selectedCityId) selectedIds = [appState.selectedCityId];
  if (selectedIds.length > 4) {
    selectedIds = selectedIds.slice(0, 4);
  }

  const rows = selectedIds
    .map((id) => {
      const city = country.cities.find((c) => c.id === id);
      const latest = city?.history?.[0];
      if (!city || !latest) return "";
      return `<tr>
        <td>${city.name}</td>
        ${country.fuelTypes
          .map((fuelType) => {
            const value = latest.prices?.[fuelType];
            return `<td>${typeof value === "number" ? formatPrice(value, country.currencyCode) : "-"}</td>`;
          })
          .join("")}
      </tr>`;
    })
    .filter(Boolean)
    .join("");

  el.comparisonTableWrap.innerHTML = rows
    ? `<table>
      <thead><tr><th>City</th>${country.fuelTypes.map((ft) => `<th>${ft}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`
    : `<p class="hint-line">Select at least one city to compare.</p>`;
}

function renderFreshnessInfo() {
  if (!el.freshnessInfo) return;
  const selected = getSelectedDataset();
  if (!selected?.dataset) {
    el.freshnessInfo.textContent = "No freshness info available.";
    return;
  }

  const latest = selected.dataset.history?.[0];
  const asOf = selected.dataset.latestUpdateAt || selected.dataset.stationStatus?.asOf;
  const parts = [];
  if (latest?.date) parts.push(`Latest daily record: ${latest.date}`);
  if (asOf) parts.push(`Latest station update: ${new Date(asOf).toLocaleString(appState.locale)}`);
  if (!parts.length) parts.push("No freshness info available.");
  el.freshnessInfo.textContent = parts.join(" | ");
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getCityConfigMap(country) {
  const list = country?.providerConfig?.cities || [];
  return new Map(list.map((entry) => [entry.id, entry]));
}

async function findNearbyCheapestCity() {
  const country = getCountryByCode(appState.selectedCountryCode);
  if (!country?.supportsCities) {
    if (el.nearbyResult) {
      el.nearbyResult.textContent = "Nearby search is available only for city-based countries.";
    }
    return;
  }

  if (el.nearbyResult) {
    el.nearbyResult.textContent = "Detecting your location...";
  }

  if (!window.isSecureContext) {
    if (el.nearbyResult) {
      el.nearbyResult.textContent = "Location requires a secure context (HTTPS).";
    }
    return;
  }

  if (!navigator.geolocation) {
    if (el.nearbyResult) {
      el.nearbyResult.textContent = "Geolocation is not supported by this browser.";
    }
    return;
  }

  if (navigator.permissions?.query) {
    try {
      const permission = await navigator.permissions.query({ name: "geolocation" });
      if (permission.state === "denied") {
        if (el.nearbyResult) {
          el.nearbyResult.textContent = "Location permission is blocked. Please allow it in browser settings.";
        }
        return;
      }
    } catch {
      // Ignore permissions API errors and continue with normal prompt flow.
    }
  }

  const position = await new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 }),
  );
  const { latitude, longitude } = position.coords;
  const cfgMap = getCityConfigMap(country);
  const targetFuel = country.fuelTypes.find((fuelType) =>
    country.cities.some((city) => typeof city.history?.[0]?.prices?.[fuelType] === "number"),
  );

  const nearest = country.cities
    .map((city) => {
      const cfg = cfgMap.get(city.id);
      if (!cfg || typeof cfg.lat !== "number" || typeof cfg.lng !== "number") return null;
      const d = distanceKm(latitude, longitude, cfg.lat, cfg.lng);
      const price = targetFuel ? city.history?.[0]?.prices?.[targetFuel] : undefined;
      return { city, d, price };
    })
    .filter(Boolean)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY))[0];

  if (!nearest) {
    if (el.nearbyResult) el.nearbyResult.textContent = "No nearby city match found.";
    return;
  }

  if (el.citySearch) {
    el.citySearch.value = "";
    const filtered = filterCityOptions(country, "");
    updateCitySearchHint("", filtered.length);
    announceCitySearchCount(filtered.length, country.cities.length, "");
  }

  appState.selectedCityId = nearest.city.id;
  if (el.citySelect) el.citySelect.value = nearest.city.id;
  announceSelection();
  if (el.nearbyResult) {
    const priceLabel = typeof nearest.price === "number" ? nearest.price.toFixed(3) : "n/a";
    const fuelLabel = targetFuel || "price";
    el.nearbyResult.textContent = `Nearest cheap option: ${nearest.city.name} (${nearest.d.toFixed(1)} km, ${fuelLabel} ${priceLabel})`;
  }
  render();
}

async function shareSnapshot() {
  const country = getCountryByCode(appState.selectedCountryCode);
  const selected = getSelectedDataset();
  if (!country || !selected?.dataset) return;

  const latest = selected.dataset.history?.[0];
  if (!latest) return;

  const lines = country.fuelTypes
    .map((ft) => {
      const v = latest.prices?.[ft];
      return `${ft}: ${typeof v === "number" ? v.toFixed(3) : "-"}`;
    })
    .join(" | ");
  const text = `${selected.scopeLabel} (${latest.date}) - ${lines}`;

  if (navigator.share) {
    await navigator.share({ title: "FuelScope Snapshot", text });
  } else if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    updateStatus("Snapshot copied to clipboard.");
  }
}

function exportTrendCsv() {
  const country = getCountryByCode(appState.selectedCountryCode);
  const selected = getSelectedDataset();
  if (!country || !selected?.dataset) return;

  const rows = sortDatesDescending(selected.dataset.history || []);
  const header = ["Date", ...country.fuelTypes].join(",");
  const body = rows
    .map((r) => [r.date, ...country.fuelTypes.map((ft) => r.prices?.[ft] ?? "")].join(","))
    .join("\n");
  const csv = `${header}\n${body}`;

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fuelscope-${selected.scopeLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderPriceCards({ latestRecord, previousRecord, fuelTypes, currency, priceChanges, nationalStats }) {
  const cards = fuelTypes
    .map((fuelType, index) => {
      const value = latestRecord?.prices?.[fuelType];
      if (typeof value !== "number") {
        return "";
      }

      const previous = previousRecord?.prices?.[fuelType];
      const diff = typeof previous === "number" ? value - previous : null;
      const diffText =
        diff === null
          ? ""
          : diff === 0
            ? t("price.delta.noChange")
            : t("price.delta.vsPrevious", {
                diff: `${diff > 0 ? "+" : ""}${diff.toFixed(2)}`,
              });
      const diffClass = diff === null ? "" : diff > 0 ? "delta-up" : "delta-down";

      // Idea 3: last API-reported price change with timestamp
      const change = priceChanges?.[fuelType];
      const changeHtml = change
        ? `<p class="last-change ${change.amount > 0 ? "change-up" : change.amount < 0 ? "change-down" : ""}">${formatPriceChange(change)}</p>`
        : "";

      // Idea 5: deviation from national average
      const nat = nationalStats?.[fuelType];
      const vsNatHtml =
        nat && typeof nat.mean === "number"
          ? (() => {
              const d = value - nat.mean;
              const cls = d > 0.005 ? "delta-up" : d < -0.005 ? "delta-down" : "";
              const sign = d >= 0 ? "+" : "";
              return `<p class="vs-national ${cls}">${t("price.delta.vsNationalAvg", {
                diff: `${sign}${d.toFixed(3)}`,
              })}</p>`;
            })()
          : "";

      return `<article class="price-card" style="animation-delay:${index * 40}ms">
        <p class="price-name">${fuelType}</p>
        <p class="price-value">${formatPrice(value, currency)}</p>
        <p class="delta ${diffClass}">${diffText}</p>
        ${changeHtml}
        ${vsNatHtml}
      </article>`;
    })
    .join("");

  el.priceGrid.innerHTML = cards || `<p>${t("price.noData")}</p>`;
}

// Idea 6: show open/closed status for Germany cities
function renderStationStatus(stationStatus) {
  if (!el.stationStatusBar) return;
  if (!stationStatus) {
    el.stationStatusBar.style.display = "none";
    return;
  }

  const { openCount, totalCount, nextClose, nextOpen, asOf } = stationStatus;
  const parts = [t("station.openCount", { openCount, totalCount })];
  if (nextClose) {
    parts.push(t("station.earliestClose", { time: formatIsoTime(nextClose) }));
  } else if (nextOpen) {
    parts.push(t("station.nextOpen", { time: formatIsoTime(nextOpen) }));
  }
  if (asOf) {
    const asOfLabel = new Date(asOf).toLocaleString(appState.locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    parts.push(t("station.asOf", { when: asOfLabel }));
  }

  el.stationStatusBar.textContent = parts.join(" · ");
  el.stationStatusBar.style.display = "";
}

// Idea 5: render national average cards for Germany
function renderNationalStats({ nationalStats, fuelTypes, currency }) {
  if (!el.nationalStatsSection) return;
  if (!nationalStats) {
    el.nationalStatsSection.style.display = "none";
    return;
  }

  const cards = fuelTypes
    .map((ft) => {
      const stat = nationalStats[ft];
      if (!stat) return "";
      return `<div class="nat-stat-card">
        <p class="nat-stat-name">${ft}</p>
        <div class="nat-stat-row">
          <span class="nat-stat-item"><span class="nat-label">${t("nat.avg")}</span> ${formatPrice(stat.mean, currency)}</span>
          <span class="nat-stat-item"><span class="nat-label">${t("nat.median")}</span> ${formatPrice(stat.median, currency)}</span>
          <span class="nat-stat-item"><span class="nat-label">${t("nat.stations")}</span> ${stat.count.toLocaleString(appState.locale)}</span>
        </div>
      </div>`;
    })
    .filter(Boolean)
    .join("");

  if (!cards) {
    el.nationalStatsSection.style.display = "none";
    return;
  }
  el.nationalStatsGrid.innerHTML = cards;
  el.nationalStatsSection.style.display = "";
}

// Idea 7: render per-brand price bar chart for the selected city
function renderBrandComparison({ brandComparison, fuelTypes, currency }) {
  if (!el.brandComparisonSection) return;
  if (!brandComparison || !Object.keys(brandComparison).length) {
    el.brandComparisonSection.style.display = "none";
    if (el.brandReliabilityInfo) el.brandReliabilityInfo.textContent = "";
    return;
  }

  // Pick selected fuel or default to first fuel that has brand data
  if (!appState.selectedBrandFuel || !brandComparison[appState.selectedBrandFuel]) {
    appState.selectedBrandFuel = fuelTypes.find((ft) => brandComparison[ft]) ?? "";
    appState.brandExpanded = false;
  }
  if (!appState.selectedBrandFuel) {
    el.brandComparisonSection.style.display = "none";
    return;
  }

  // Fuel type selector tabs
  el.brandFuelTabs.innerHTML = fuelTypes
    .filter((ft) => brandComparison[ft])
    .map(
      (ft) =>
        `<button class="brand-fuel-tab${ft === appState.selectedBrandFuel ? " active" : ""}" data-fuel="${ft}">${ft}</button>`
    )
    .join("");

  // Bar chart: bars span 30–100% of container so small price differences are visible
  const entries = brandComparison[appState.selectedBrandFuel];
  const roundedEntries = entries.map((e) => ({
    ...e,
    // Keep bar math consistent with displayed value (2 decimals)
    displayPrice: Number(e.price.toFixed(2)),
  }));
  const prices = roundedEntries.map((e) => e.displayPrice);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 0.001;

  const visibleEntries = appState.brandExpanded ? roundedEntries : roundedEntries.slice(0, BRAND_ROWS_VISIBLE);

  el.brandComparisonChart.innerHTML = visibleEntries
    .map(({ brand, price, count, displayPrice }) => {
      const barPct = (30 + ((displayPrice - minP) / range) * 70).toFixed(1);
      const cheapest = displayPrice === minP;
      return `<div class="brand-row${cheapest ? " brand-cheapest" : ""}">
        <span class="brand-name">${brand} <span class="brand-count">${t("brand.count", { count })}</span></span>
        <div class="brand-bar-wrap">
          <div class="brand-bar" style="width:${barPct}%"></div>
          <span class="brand-price">${formatPrice(price, currency)}</span>
        </div>
      </div>`;
    })
    .join("");

  if (el.brandExpandBtn) {
    if (roundedEntries.length > BRAND_ROWS_VISIBLE) {
      el.brandExpandBtn.style.display = "";
      el.brandExpandBtn.textContent = appState.brandExpanded ? t("button.showFewerBrands") : t("button.showAllBrands");
      el.brandExpandBtn.setAttribute("aria-expanded", appState.brandExpanded ? "true" : "false");
    } else {
      el.brandExpandBtn.style.display = "none";
    }
  }

  if (el.brandReliabilityInfo) {
    const ranked = roundedEntries
      .map((entry) => {
        const priceComponent = ((maxP - entry.displayPrice) / range) * 80;
        const coverageComponent = Math.min(entry.count, 5) * 4;
        return {
          brand: entry.brand,
          score: Math.round(priceComponent + coverageComponent),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    el.brandReliabilityInfo.textContent = ranked.length
      ? `Value score (${appState.selectedBrandFuel}): ${ranked.map((r) => `${r.brand} ${r.score}`).join(" · ")}`
      : "";
  }

  el.brandComparisonSection.style.display = "";
}

function renderTrendTable({ history, fuelTypes, currency }) {
  el.trendHead.innerHTML = `<tr>
    <th>${t("trend.date")}</th>
    ${fuelTypes.map((fuelType) => `<th>${fuelType} (${currency})</th>`).join("")}
  </tr>`;

  const rows = sortDatesDescending(history)
    .slice(0, 10)
    .map(
      (record) => `<tr>
        <td>${record.date}</td>
        ${fuelTypes
          .map((fuelType) => {
            const price = record.prices[fuelType];
            return `<td>${typeof price === "number" ? price.toFixed(2) : "-"}</td>`;
          })
          .join("")}
      </tr>`
    )
    .join("");

  el.trendBody.innerHTML = rows;
}

function getRecordForMode(history) {
  const ordered = sortDatesDescending(history);
  if (!ordered.length) {
    return { latestRecord: null, previousRecord: null };
  }

  if (appState.mode === "current") {
    const todayStamp = TODAY_STAMP();
    const currentIndex = ordered.findIndex((entry) => entry.date <= todayStamp);
    if (currentIndex === -1) {
      return {
        latestRecord: ordered[0],
        previousRecord: ordered[1] || null,
      };
    }

    return {
      latestRecord: ordered[currentIndex],
      previousRecord: ordered[currentIndex + 1] || null,
    };
  }

  const selectedDate = el.historicalDate.value;
  if (!selectedDate) {
    return { latestRecord: null, previousRecord: null };
  }

  const selectedStamp = toDayStamp(selectedDate);
  const selectedIndex = ordered.findIndex((entry) => entry.date <= selectedStamp);
  if (selectedIndex === -1) {
    return { latestRecord: null, previousRecord: null };
  }

  return {
    latestRecord: ordered[selectedIndex],
    previousRecord: ordered[selectedIndex + 1] || null,
  };
}

function TODAY_STAMP() {
  return new Date().toISOString().slice(0, 10);
}

function syncDateInputFromHistory(history) {
  const ordered = sortDatesDescending(history);
  if (!ordered.length) {
    el.historicalDate.value = "";
    return;
  }

  const minDate = ordered[ordered.length - 1].date;
  const maxDate = ordered[0].date;

  el.historicalDate.min = minDate;
  el.historicalDate.max = maxDate;

  if (!el.historicalDate.value) {
    el.historicalDate.value = maxDate;
  }
}

function populateCountrySelect(countries) {
  el.countrySelect.innerHTML = countries
    .map((country) => `<option value="${country.code}">${country.name}</option>`)
    .join("");

  appState.selectedCountryCode = countries[0]?.code || "";
  el.countrySelect.value = appState.selectedCountryCode;
}

function getSortedCities(country) {
  const collator = new Intl.Collator(appState.locale || "en-US", {
    sensitivity: "base",
    numeric: true,
  });
  return [...(country.cities || [])].sort((a, b) => collator.compare(a.name, b.name));
}

function filterCityOptions(country, query) {
  const q = query.trim().toLowerCase();
  const sorted = getSortedCities(country);
  const filtered = q ? sorted.filter((c) => c.name.toLowerCase().includes(q)) : sorted;
  el.citySelect.innerHTML = filtered
    .map((city) => `<option value="${city.id}">${city.name}</option>`)
    .join("");
  return filtered;
}

function updateCitySearchHint(query, matchCount) {
  if (!el.citySearchHint) return;
  if (query.trim() && matchCount === 0) {
    const translated = t("city.noMatches");
    el.citySearchHint.textContent = translated === "city.noMatches" ? "No matching cities" : translated;
  } else {
    el.citySearchHint.textContent = "";
  }
}

function announceCitySearchCount(matchCount, totalCount, query) {
  if (!el.citySearchCount) return;
  if (!query.trim()) {
    el.citySearchCount.textContent = `${totalCount} cities available.`;
    return;
  }
  el.citySearchCount.textContent = `${matchCount} matching ${matchCount === 1 ? "city" : "cities"}.`;
}

function announceSelection() {
  if (!el.citySearchCount) return;
  const country = getCountryByCode(appState.selectedCountryCode);
  if (!country?.supportsCities) return;
  const city = country.cities.find((c) => c.id === appState.selectedCityId);
  if (!city) return;
  const fuel = appState.selectedBrandFuel || country.fuelTypes?.[0] || "";
  el.citySearchCount.textContent = `Selected ${city.name}${fuel ? `, fuel ${fuel}` : ""}.`;
}

function populateCitySelect(country) {
  if (!country.supportsCities) {
    el.cityControl.style.display = "none";
    el.citySelect.innerHTML = "";
    appState.selectedCityId = "";
    if (el.citySearchHint) el.citySearchHint.textContent = "";
    if (el.zipSearchControl) el.zipSearchControl.style.display = "none";
    return;
  }

  if (el.citySearch) el.citySearch.value = "";
  const filtered = filterCityOptions(country, "");
  updateCitySearchHint("", country.cities.length);
  announceCitySearchCount(filtered.length, country.cities.length, "");

  appState.selectedCityId = getSortedCities(country)[0]?.id || "";
  el.citySelect.value = appState.selectedCityId;
  el.cityControl.style.display = "";

  // Idea 2: show ZIP input if any city in this country has a postalCode field
  const hasZip = country.cities.some((c) => c.postalCode);
  if (el.zipSearchControl) {
    el.zipSearchControl.style.display = hasZip ? "" : "none";
    if (el.zipInput) el.zipInput.value = country.cities[0]?.postalCode ?? "";
    if (el.zipHint) el.zipHint.textContent = "";
  }
}

function setModeUI() {
  const isHistorical = appState.mode === "historical";
  el.dateControl.hidden = !isHistorical;
}

function render() {
  const country = getCountryByCode(appState.selectedCountryCode);
  if (!country) {
    updateStatus(t("status.chooseCountry"));
    return;
  }

  const { scopeLabel, dataset } = getLocationData(country, appState.selectedCityId);
  const history = dataset.history || [];

  syncDateInputFromHistory(history);
  const { latestRecord, previousRecord } = getRecordForMode(history);

  if (!latestRecord) {
    updateStatus(t("status.noData"));
    renderPriceCards({ latestRecord: null, previousRecord: null, fuelTypes: country.fuelTypes, currency: country.currencyCode });
    renderStationStatus(null);
    renderNationalStats({ nationalStats: null, fuelTypes: country.fuelTypes, currency: country.currencyCode });
    renderBrandComparison({ brandComparison: null, fuelTypes: country.fuelTypes, currency: country.currencyCode });
    renderTrendTable({ history, fuelTypes: country.fuelTypes, currency: country.currencyCode });
    return;
  }

  const todayIso = TODAY_STAMP();
  let dateLabel;
  if (appState.mode === "historical") {
    dateLabel = t("status.historical", { date: latestRecord.date });
  } else if (latestRecord.date < todayIso) {
    dateLabel = t("status.currentAsOf", { date: latestRecord.date });
  } else {
    dateLabel = t("status.current", { date: latestRecord.date });
  }
  updateStatus(t("status.withScopeUnit", { label: dateLabel, scope: scopeLabel, unit: country.unit }));

  const priceChanges = appState.mode === "current" ? (latestRecord.priceChanges ?? null) : null;

  renderPriceCards({
    latestRecord,
    previousRecord,
    fuelTypes: country.fuelTypes,
    currency: country.currencyCode,
    priceChanges,
    nationalStats: country.nationalStats ?? null,
  });

  renderStationStatus(appState.mode === "current" ? (dataset.stationStatus ?? null) : null);

  renderNationalStats({
    nationalStats: country.nationalStats ?? null,
    fuelTypes: country.fuelTypes,
    currency: country.currencyCode,
  });

  renderBrandComparison({
    brandComparison: appState.mode === "current" ? (dataset.brandComparison ?? null) : null,
    fuelTypes: country.fuelTypes,
    currency: country.currencyCode,
  });

  renderTrendTable({
    history,
    fuelTypes: country.fuelTypes,
    currency: country.currencyCode,
  });

  renderWatchlist();
  renderComparisonTable();
  renderFreshnessInfo();
}

function bindEvents() {
  el.countrySelect.addEventListener("change", (event) => {
    appState.selectedCountryCode = event.target.value;
    appState.selectedBrandFuel = "";
    appState.brandExpanded = false;
    const country = getCountryByCode(appState.selectedCountryCode);
    renderWatchFuelTypeSelect(country);
    populateCitySelect(country);
    render();
  });

  el.citySelect.addEventListener("change", (event) => {
    appState.selectedCityId = event.target.value;
    appState.brandExpanded = false;
    announceSelection();
    render();
  });

  el.citySelect.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && el.citySearch) {
      event.preventDefault();
      el.citySearch.focus();
      el.citySearch.select();
    }
  });

  if (el.citySearch) {
    el.citySearch.addEventListener("input", () => {
      const query = el.citySearch.value;
      const country = getCountryByCode(appState.selectedCountryCode);
      if (!country) return;

      const filtered = filterCityOptions(country, query);
      updateCitySearchHint(query, filtered.length);
      announceCitySearchCount(filtered.length, country.cities.length, query);

      const selectedStillVisible = Array.from(el.citySelect.options).some(
        (option) => option.value === appState.selectedCityId,
      );
      if (selectedStillVisible) {
        el.citySelect.value = appState.selectedCityId;
      } else {
        const first = el.citySelect.options[0];
        if (first) {
          appState.selectedCityId = first.value;
          el.citySelect.value = first.value;
          appState.brandExpanded = false;
        }
      }

      render();
    });

    el.citySearch.addEventListener("keydown", (event) => {
      const country = getCountryByCode(appState.selectedCountryCode);
      if (!country) return;

      const isArrowDown = event.key === "ArrowDown" || event.key === "Down" || event.code === "ArrowDown";

      if (isArrowDown) {
        event.preventDefault();
        if (el.citySelect.options.length > 0) {
          if (el.citySelect.selectedIndex < 0) {
            el.citySelect.selectedIndex = 0;
          }
          el.citySelect.focus();
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        const first = el.citySelect.options[0];
        if (first) {
          appState.selectedCityId = first.value;
          el.citySelect.value = first.value;
          appState.brandExpanded = false;
          announceSelection();
          render();
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        el.citySearch.value = "";
        const filtered = filterCityOptions(country, "");
        updateCitySearchHint("", filtered.length);
        announceCitySearchCount(filtered.length, country.cities.length, "");
        if (filtered[0]) {
          appState.selectedCityId = filtered[0].id;
          el.citySelect.value = filtered[0].id;
          appState.brandExpanded = false;
          announceSelection();
          render();
        }
      }
    });
  }

  document.querySelectorAll("input[name='mode']").forEach((input) => {
    input.addEventListener("change", (event) => {
      appState.mode = event.target.value;
      setModeUI();
      render();
    });
  });

  el.historicalDate.addEventListener("change", () => {
    render();
  });

  // Idea 2: ZIP code search — switch city when a known postal code is typed
  if (el.zipInput) {
    el.zipInput.addEventListener("input", () => {
      const zip = el.zipInput.value.trim();
      const country = getCountryByCode(appState.selectedCountryCode);
      if (!country?.cities) return;
      const matched = country.cities.find((c) => c.postalCode === zip);
      if (matched) {
        appState.selectedCityId = matched.id;
        el.citySelect.value = matched.id;
        if (el.zipHint) el.zipHint.textContent = "";
        render();
      } else if (zip.length === 5) {
        if (el.zipHint) el.zipHint.textContent = t("zip.noData");
      } else {
        if (el.zipHint) el.zipHint.textContent = "";
      }
    });
  }

  // Idea 7: Brand fuel tab selection (event delegation)
  if (el.brandFuelTabs) {
    el.brandFuelTabs.addEventListener("click", (e) => {
      const tab = e.target.closest(".brand-fuel-tab");
      if (!tab) return;
      appState.selectedBrandFuel = tab.dataset.fuel;
      appState.brandExpanded = false;
      announceSelection();
      render();
    });
  }

  if (el.brandExpandBtn) {
    el.brandExpandBtn.addEventListener("click", () => {
      appState.brandExpanded = !appState.brandExpanded;
      render();
    });
  }

  if (el.languageSelect) {
    el.languageSelect.addEventListener("change", async (event) => {
      const nextLocale = normalizeLocale(event.target.value) || "en-US";
      try {
        await loadLocale(nextLocale);
        applyStaticTranslations();
        render();
      } catch (error) {
        console.error(error);
      }
    });
  }

  if (el.addWatchBtn) {
    el.addWatchBtn.addEventListener("click", () => {
      const country = getCountryByCode(appState.selectedCountryCode);
      if (!country?.supportsCities) return;
      const fuelType = el.watchFuelTypeSelect?.value;
      const threshold = Number(el.watchThresholdInput?.value || "");
      if (!fuelType || !Number.isFinite(threshold) || threshold <= 0) {
        updateStatus("Enter a valid threshold to add an alert.");
        return;
      }
      appState.watchlist.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        countryCode: country.code,
        cityId: appState.selectedCityId,
        fuelType,
        threshold,
      });
      saveWatchlist();
      renderWatchlist();
    });
  }

  if (el.watchlistList) {
    el.watchlistList.addEventListener("click", (event) => {
      const btn = event.target.closest(".watch-remove");
      if (!btn) return;
      const id = btn.getAttribute("data-watch-id");
      appState.watchlist = appState.watchlist.filter((w) => w.id !== id);
      saveWatchlist();
      renderWatchlist();
    });
  }

  if (el.compareCitySelect) {
    el.compareCitySelect.addEventListener("change", () => {
      const selected = Array.from(el.compareCitySelect.selectedOptions);
      if (selected.length > 4) {
        selected[selected.length - 1].selected = false;
      }
      renderComparisonTable();
    });
  }

  if (el.findNearbyBtn) {
    el.findNearbyBtn.addEventListener("click", () => {
      el.findNearbyBtn.disabled = true;
      findNearbyCheapestCity().catch((error) => {
        if (el.nearbyResult) el.nearbyResult.textContent = `Could not get location: ${error.message}`;
      }).finally(() => {
        el.findNearbyBtn.disabled = false;
      });
    });
  }

  if (el.shareSnapshotBtn) {
    el.shareSnapshotBtn.addEventListener("click", () => {
      shareSnapshot().catch((error) => {
        updateStatus(`Share failed: ${error.message}`);
      });
    });
  }

  if (el.exportCsvBtn) {
    el.exportCsvBtn.addEventListener("click", () => {
      exportTrendCsv();
    });
  }
}

async function bootstrap() {
  try {
    const initialLocale = detectInitialLocale();
    await loadLocale(initialLocale);
    applyStaticTranslations();
    populateLanguageSelect();

    const provider = dataProviders[appState.provider];
    if (!provider) {
      throw new Error(`Unknown provider: ${appState.provider}`);
    }

    appState.catalog = await provider.loadCatalog();
    if (!appState.catalog?.countries?.length) {
      throw new Error("No countries found in dataset");
    }

    loadWatchlist();

    populateCountrySelect(appState.catalog.countries);
    renderWatchFuelTypeSelect(appState.catalog.countries[0]);
    populateCitySelect(appState.catalog.countries[0]);
    setModeUI();
    bindEvents();
    render();
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    updateStatus(t("bootstrap.loadFail"));
  }
}

bootstrap();
