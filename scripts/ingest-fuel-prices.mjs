import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DATA_FILE = path.resolve(process.cwd(), "data", "fuel-prices.json");
const TODAY = new Date().toISOString().slice(0, 10);

// Maps Tankerkoenig /stats API keys → our canonical Germany fuel type names
const TANKERKOENIG_STATS_KEY_MAP = { E5: "Super E5", E10: "Super E10", Diesel: "Diesel" };

const THAILAND_FUEL_MAP = [
  { key: "Gasohol 91", markers: ["แก๊สโซฮอล์ 91 S EVO"] },
  { key: "Gasohol 95", markers: ["แก๊สโซฮอล์ 95 S EVO"] },
  { key: "Premium 97 Gasohol 95", markers: ["ไฮพรีเมียม 97 แก๊สโซฮอล์ 95", "Hi Premium 97"] },
  { key: "Gasohol E20", markers: ["แก๊สโซฮอล์ E20 S EVO"] },
  { key: "Gasohol E85", markers: ["แก๊สโซฮอล์ E85 S EVO"] },
  { key: "Diesel", markers: ["ไฮดีเซล S"] },
  { key: "Premium Diesel", markers: ["ไฮพรีเมียมดีเซล S"] },
];

async function main() {
  const catalog = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));

  const providers = {
    "thailand-bangchak": ingestThailandBangchak,
    "germany-tankerkoenig": ingestGermanyTankerkoenig,
  };

  for (const country of catalog.countries) {
    const providerName = country.provider;
    if (!providerName || !providers[providerName]) {
      continue;
    }

    try {
      console.log(`Ingesting ${country.code} via ${providerName}...`);
      await providers[providerName](country);
    } catch (error) {
      console.warn(`Skipping ${country.code}: ${error.message}`);
    }
  }

  catalog.meta.generatedAt = TODAY;
  catalog.meta.notes = "Auto-refreshed via provider ingestion. See README for provider/API details.";
  await fs.writeFile(DATA_FILE, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log("Ingestion complete.");
}

function upsertHistory(history, newEntry) {
  if (!Array.isArray(history)) {
    return [newEntry];
  }

  const existingIndex = history.findIndex((entry) => entry.date === newEntry.date);
  if (existingIndex >= 0) {
    history[existingIndex] = newEntry;
    return history;
  }

  return [newEntry, ...history].sort((a, b) => b.date.localeCompare(a.date));
}

function thaiDateToIso(thDate) {
  const [day, month, buddhistYear] = thDate.split("/").map((value) => Number.parseInt(value, 10));
  const gregorianYear = buddhistYear - 543;
  return `${gregorianYear.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function addDays(isoDate, deltaDays) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function findThaiOil(oils, markers) {
  return oils.find((item) => {
    const oilName = String(item.OilName || "");
    return markers.some((marker) => oilName.includes(marker));
  });
}

function buildThailandPricesByField(oils, fieldName) {
  const prices = {};
  for (const fuel of THAILAND_FUEL_MAP) {
    const oil = findThaiOil(oils, fuel.markers);
    const value = oil?.[fieldName];
    if (typeof value === "number") {
      prices[fuel.key] = value;
    }
  }
  return prices;
}

async function ingestThailandBangchak(country) {
  const response = await fetch("https://oil-price.bangchak.co.th/ApiOilPrice2/thai");
  if (!response.ok) {
    throw new Error(`Thailand endpoint failed: ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload) || !payload[0]) {
    throw new Error("Unexpected Thailand payload shape");
  }

  const root = payload[0];
  const oils = JSON.parse(root.OilList || "[]");
  if (!Array.isArray(oils) || oils.length === 0) {
    throw new Error("Thailand payload contains no oil list");
  }

  const baseDate = root.OilPriceDate ? thaiDateToIso(root.OilPriceDate) : TODAY;
  const yesterdayPrices = buildThailandPricesByField(oils, "PriceYesterday");
  const todayPrices = buildThailandPricesByField(oils, "PriceToday");
  const tomorrowPrices = buildThailandPricesByField(oils, "PriceTomorrow");

  if (Object.keys(yesterdayPrices).length > 0) {
    country.history = upsertHistory(country.history, {
      date: addDays(baseDate, -1),
      prices: yesterdayPrices,
    });
  }

  if (Object.keys(todayPrices).length > 0) {
    country.history = upsertHistory(country.history, {
      date: baseDate,
      prices: todayPrices,
    });
  }

  if (Object.keys(tomorrowPrices).length > 0) {
    country.history = upsertHistory(country.history, {
      date: addDays(baseDate, 1),
      prices: tomorrowPrices,
    });
  }

  country.fuelTypes = THAILAND_FUEL_MAP.map((entry) => entry.key);

  console.log(`  API OilPriceDate: ${root.OilPriceDate} => ISO base: ${baseDate}`);
  console.log(`  Yesterday (${addDays(baseDate,-1)}): ${JSON.stringify(yesterdayPrices)}`);
  console.log(`  Today     (${baseDate}): ${JSON.stringify(todayPrices)}`);
  console.log(`  Tomorrow  (${addDays(baseDate, 1)}): ${JSON.stringify(tomorrowPrices)}`);
}

async function ingestGermanyTankerkoenig(country) {
  const apiKey = process.env.TANKERKOENIG_API_KEY;
  if (!apiKey) {
    throw new Error("TANKERKOENIG_API_KEY is missing");
  }

  if (!country.supportsCities || !Array.isArray(country.cities)) {
    throw new Error("Germany country is not configured with city support");
  }

  // Idea 5: Fetch national statistics (Germany-wide mean/median per fuel type)
  const statsResp = await fetch(
    `https://creativecommons.tankerkoenig.de/api/v4/stats?apikey=${encodeURIComponent(apiKey)}`
  );
  if (statsResp.ok) {
    const statsPayload = await statsResp.json();
    const nationalStats = {};
    for (const [statKey, fuelName] of Object.entries(TANKERKOENIG_STATS_KEY_MAP)) {
      if (statsPayload[statKey]) {
        nationalStats[fuelName] = statsPayload[statKey]; // { count, mean, median }
      }
    }
    if (Object.keys(nationalStats).length > 0) {
      country.nationalStats = nationalStats;
      console.log(`  National stats: ${JSON.stringify(nationalStats)}`);
    }
  } else {
    console.warn(`  National stats fetch failed: ${statsResp.status}`);
  }

  const providerConfig = country.providerConfig || {};
  const cityConfigs = providerConfig.cities || [];

  for (const city of country.cities) {
    const cityConfig = cityConfigs.find((entry) => entry.id === city.id);
    if (!cityConfig) {
      console.warn(`City config missing for ${city.id}, skipping.`);
      continue;
    }

    // Idea 2: prefer postal code endpoint when configured; fall back to lat/lng radius search
    let url;
    if (cityConfig.postalCode) {
      url = new URL("https://creativecommons.tankerkoenig.de/api/v4/stations/postalcode");
      url.searchParams.set("postalcode", cityConfig.postalCode);
      url.searchParams.set("apikey", apiKey);
    } else {
      url = new URL("https://creativecommons.tankerkoenig.de/api/v4/stations/search");
      url.searchParams.set("lat", String(cityConfig.lat));
      url.searchParams.set("lng", String(cityConfig.lng));
      url.searchParams.set("rad", String(cityConfig.radiusKm || 5));
      url.searchParams.set("apikey", apiKey);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Tankerkoenig request failed (${city.id}): ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.stations)) {
      throw new Error(`Tankerkoenig v4 payload invalid for ${city.id}`);
    }

    const stations = payload.stations.slice(0, cityConfig.maxStations || 20);
    if (!stations.length) {
      console.warn(`No stations returned for ${city.id}.`);
      continue;
    }

    // Accumulate prices and lastChange data per fuel type across stations
    const fuelAccumulators = {};
    for (const station of stations) {
      for (const fuel of station.fuels ?? []) {
        if (!country.fuelTypes.includes(fuel.name)) continue;
        if (!fuelAccumulators[fuel.name]) {
          fuelAccumulators[fuel.name] = { prices: [], lastChanges: [] };
        }
        if (typeof fuel.price === "number") {
          fuelAccumulators[fuel.name].prices.push(fuel.price);
        }
        if (fuel.lastChange?.timestamp) {
          fuelAccumulators[fuel.name].lastChanges.push(fuel.lastChange);
        }
      }
    }

    const prices = {};
    const priceChanges = {};
    for (const [name, acc] of Object.entries(fuelAccumulators)) {
      if (acc.prices.length) {
        prices[name] = Number(
          (acc.prices.reduce((sum, p) => sum + p, 0) / acc.prices.length).toFixed(3)
        );
      }
      if (acc.lastChanges.length) {
        // Keep the most recently changed entry across all stations
        acc.lastChanges.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        priceChanges[name] = acc.lastChanges[0];
      }
    }

    // Idea 6: Capture station open/close status at ingestion time
    const openStations = stations.filter((s) => s.isOpen);
    const closingTimes = openStations.filter((s) => s.closesAt).map((s) => s.closesAt).sort();
    const openingTimes = stations.filter((s) => !s.isOpen && s.opensAt).map((s) => s.opensAt).sort();
    city.stationStatus = {
      openCount: openStations.length,
      totalCount: stations.length,
      nextClose: closingTimes[0] ?? null,
      nextOpen: openingTimes[0] ?? null,
      asOf: new Date().toISOString(),
    };

    // Idea 7: Brand comparison — group stations by brand, average price per fuel type
    const brandMap = {};
    for (const station of stations) {
      const brand = (station.brand || "Other").trim();
      for (const fuel of station.fuels ?? []) {
        if (!country.fuelTypes.includes(fuel.name)) continue;
        if (typeof fuel.price !== "number") continue;
        if (!brandMap[brand]) brandMap[brand] = {};
        if (!brandMap[brand][fuel.name]) brandMap[brand][fuel.name] = [];
        brandMap[brand][fuel.name].push(fuel.price);
      }
    }
    const brandComparison = {};
    for (const fuelName of country.fuelTypes) {
      const entries = Object.entries(brandMap)
        .filter(([, fuels]) => fuels[fuelName]?.length)
        .map(([brand, fuels]) => ({
          brand,
          price: Number((fuels[fuelName].reduce((s, p) => s + p, 0) / fuels[fuelName].length).toFixed(3)),
          count: fuels[fuelName].length,
        }))
        .sort((a, b) => a.price - b.price);
      if (entries.length) brandComparison[fuelName] = entries;
    }
    if (Object.keys(brandComparison).length) city.brandComparison = brandComparison;

    // Copy postalCode from config to city object so the UI can match by ZIP
    if (cityConfig.postalCode) city.postalCode = cityConfig.postalCode;

    const filteredPrices = Object.fromEntries(
      Object.entries(prices).filter(([, value]) => typeof value === "number")
    );
    if (!Object.keys(filteredPrices).length) {
      console.warn(`No usable fuel prices for ${city.id}.`);
      continue;
    }

    const historyEntry = { date: TODAY, prices: filteredPrices };
    if (Object.keys(priceChanges).length > 0) {
      historyEntry.priceChanges = priceChanges;
    }

    city.history = upsertHistory(city.history, historyEntry);
    console.log(`  ${city.id}: ${JSON.stringify(filteredPrices)}`);
    console.log(`  ${city.id} open: ${openStations.length}/${stations.length} stations`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
