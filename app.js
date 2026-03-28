const DATA_URL = "./data/fuel-prices.json";

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
};

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  }
}

function formatPrice(price, currencyCode) {
  return new Intl.NumberFormat("en", {
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
  return `${arrow} ${amtStr} · last changed ${ago}`;
}

function formatRelativeTime(isoTimestamp) {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatIsoTime(isoString) {
  return new Date(isoString).toLocaleTimeString("en", {
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
            ? "No change from previous period"
            : `${diff > 0 ? "+" : ""}${diff.toFixed(2)} vs previous period`;
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
              return `<p class="vs-national ${cls}">${sign}${d.toFixed(3)} vs national avg</p>`;
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

  el.priceGrid.innerHTML = cards || "<p>No price data available for this selection.</p>";
}

// Idea 6: show open/closed status for Germany cities
function renderStationStatus(stationStatus) {
  if (!el.stationStatusBar) return;
  if (!stationStatus) {
    el.stationStatusBar.style.display = "none";
    return;
  }

  const { openCount, totalCount, nextClose, nextOpen, asOf } = stationStatus;
  const parts = [`${openCount} of ${totalCount} stations open`];
  if (nextClose) {
    parts.push(`earliest close at ${formatIsoTime(nextClose)}`);
  } else if (nextOpen) {
    parts.push(`next opens at ${formatIsoTime(nextOpen)}`);
  }
  if (asOf) {
    const asOfLabel = new Date(asOf).toLocaleString("en", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    parts.push(`(as of ${asOfLabel})`);
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
          <span class="nat-stat-item"><span class="nat-label">avg</span> ${formatPrice(stat.mean, currency)}</span>
          <span class="nat-stat-item"><span class="nat-label">median</span> ${formatPrice(stat.median, currency)}</span>
          <span class="nat-stat-item"><span class="nat-label">stations</span> ${stat.count.toLocaleString("en")}</span>
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

function renderTrendTable({ history, fuelTypes, currency }) {
  el.trendHead.innerHTML = `<tr>
    <th>Date</th>
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
    return;
  }

  el.citySelect.innerHTML = country.cities
    .map((city) => `<option value="${city.id}">${city.name}</option>`)
    .join("");

  appState.selectedCityId = country.cities[0]?.id || "";
  el.citySelect.value = appState.selectedCityId;
  el.cityControl.style.display = "";
}

function setModeUI() {
  const isHistorical = appState.mode === "historical";
  el.dateControl.hidden = !isHistorical;
}

function render() {
  const country = getCountryByCode(appState.selectedCountryCode);
  if (!country) {
    updateStatus("Please choose a country.");
    return;
  }

  const { scopeLabel, dataset } = getLocationData(country, appState.selectedCityId);
  const history = dataset.history || [];

  syncDateInputFromHistory(history);
  const { latestRecord, previousRecord } = getRecordForMode(history);

  if (!latestRecord) {
    updateStatus("No data found for this date. Try another date or switch to Current view.");
    renderPriceCards({ latestRecord: null, previousRecord: null, fuelTypes: country.fuelTypes, currency: country.currencyCode });
    renderStationStatus(null);
    renderNationalStats({ nationalStats: null, fuelTypes: country.fuelTypes, currency: country.currencyCode });
    renderTrendTable({ history, fuelTypes: country.fuelTypes, currency: country.currencyCode });
    return;
  }

  const todayIso = TODAY_STAMP();
  let dateLabel;
  if (appState.mode === "historical") {
    dateLabel = `Historical (${latestRecord.date})`;
  } else if (latestRecord.date < todayIso) {
    dateLabel = `Current · prices as of ${latestRecord.date} (unchanged since last update)`;
  } else {
    dateLabel = `Current (${latestRecord.date})`;
  }
  updateStatus(`${dateLabel} — ${scopeLabel}. Unit: ${country.unit}`);

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

  renderTrendTable({
    history,
    fuelTypes: country.fuelTypes,
    currency: country.currencyCode,
  });
}

function bindEvents() {
  el.countrySelect.addEventListener("change", (event) => {
    appState.selectedCountryCode = event.target.value;
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
}

async function bootstrap() {
  try {
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
    updateStatus("Failed to load fuel prices. Check local data or provider configuration.");
  }
}

bootstrap();
