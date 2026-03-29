const DATA_URL = "./data/fuel-prices.json";
const LOCALE_STORAGE_KEY = "fuelscope.locale";
const I18N_BASE_PATH = "./assets/i18n";
const SUPPORTED_LOCALES = ["en-US", "en-GB", "de-DE", "fr-FR", "th-TH"];

const dataProviders = {
  static: {
    async loadCatalog() {
      const response = await fetch(DATA_URL);
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
};

const el = {
  countrySelect: document.getElementById("countrySelect"),
  cityControl: document.getElementById("cityControl"),
  citySelect: document.getElementById("citySelect"),
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
};

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  }
}

function t(id, vars = {}) {
  const template = appState.messages[id] || id;
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
    return;
  }

  // Pick selected fuel or default to first fuel that has brand data
  if (!appState.selectedBrandFuel || !brandComparison[appState.selectedBrandFuel]) {
    appState.selectedBrandFuel = fuelTypes.find((ft) => brandComparison[ft]) ?? "";
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
  const prices = entries.map((e) => e.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 0.001;

  el.brandComparisonChart.innerHTML = entries
    .map(({ brand, price, count }) => {
      const barPct = (30 + ((price - minP) / range) * 70).toFixed(1);
      const cheapest = price === minP;
      return `<div class="brand-row${cheapest ? " brand-cheapest" : ""}">
        <span class="brand-name">${brand} <span class="brand-count">${t("brand.count", { count })}</span></span>
        <div class="brand-bar-wrap">
          <div class="brand-bar" style="width:${barPct}%"></div>
          <span class="brand-price">${formatPrice(price, currency)}</span>
        </div>
      </div>`;
    })
    .join("");

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

function populateCitySelect(country) {
  if (!country.supportsCities) {
    el.cityControl.style.display = "none";
    el.citySelect.innerHTML = "";
    appState.selectedCityId = "";
    if (el.zipSearchControl) el.zipSearchControl.style.display = "none";
    return;
  }

  el.citySelect.innerHTML = country.cities
    .map((city) => `<option value="${city.id}">${city.name}</option>`)
    .join("");

  appState.selectedCityId = country.cities[0]?.id || "";
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
}

function bindEvents() {
  el.countrySelect.addEventListener("change", (event) => {
    appState.selectedCountryCode = event.target.value;
    appState.selectedBrandFuel = "";
    const country = getCountryByCode(appState.selectedCountryCode);
    populateCitySelect(country);
    render();
  });

  el.citySelect.addEventListener("change", (event) => {
    appState.selectedCityId = event.target.value;
    render();
  });

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

    populateCountrySelect(appState.catalog.countries);
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
