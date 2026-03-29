import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DATA_FILE = path.resolve(process.cwd(), "data", "fuel-prices.json");
const TODAY = new Date().toISOString().slice(0, 10);
const CITY_DISCOVERY_PROBES = [
  { lat: 53.55, lng: 10.0 },
  { lat: 52.52, lng: 13.405 },
  { lat: 48.137, lng: 11.575 },
  { lat: 50.11, lng: 8.68 },
  { lat: 50.94, lng: 6.96 },
  { lat: 48.775, lng: 9.182 },
  { lat: 51.227, lng: 6.773 },
  { lat: 51.45, lng: 7.013 },
  { lat: 53.079, lng: 8.801 },
  { lat: 51.34, lng: 12.375 },
  { lat: 51.05, lng: 13.738 },
  { lat: 52.375, lng: 9.732 },
  { lat: 49.452, lng: 11.076 },
  { lat: 49.006, lng: 8.403 },
  { lat: 52.13, lng: 11.62 },
];

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

function normalizeGermanText(value) {
  return String(value || "")
    .trim()
    .replace(/ä/gi, "ae")
    .replace(/ö/gi, "oe")
    .replace(/ü/gi, "ue")
    .replace(/ß/gi, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function slugifyCityName(name) {
  return normalizeGermanText(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function prettifyCityName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed === trimmed.toUpperCase()) {
    return trimmed.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (match) => match.toUpperCase());
  }

  return trimmed;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mostFrequent(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  let bestValue = null;
  let bestCount = -1;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    }
  }
  return bestValue;
}

async function fetchStationsBySearch(apiKey, lat, lng, radiusKm = 25) {
  const url = new URL("https://creativecommons.tankerkoenig.de/api/v4/stations/search");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  url.searchParams.set("rad", String(radiusKm));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`search endpoint failed (${lat},${lng}): ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload?.stations)) {
    throw new Error(`Invalid search payload at (${lat},${lng})`);
  }

  return payload.stations;
}

async function discoverGermanyCities(apiKey, maxDiscoveredCities = 12) {
  const byCity = new Map();

  for (const probe of CITY_DISCOVERY_PROBES) {
    let stations = [];
    try {
      stations = await fetchStationsBySearch(apiKey, probe.lat, probe.lng, 25);
    } catch (error) {
      console.warn(`  City discovery probe failed (${probe.lat},${probe.lng}): ${error.message}`);
      continue;
    }

    for (const station of stations) {
      const place = prettifyCityName(station.place);
      if (!place) {
        continue;
      }

      const key = normalizeGermanText(place);
      if (!byCity.has(key)) {
        byCity.set(key, {
          name: place,
          lats: [],
          lngs: [],
          postalCodes: [],
          stations: 0,
        });
      }

      const city = byCity.get(key);
      if (station.coords?.lat && station.coords?.lng) {
        city.lats.push(Number(station.coords.lat));
        city.lngs.push(Number(station.coords.lng));
      }
      if (station.postalCode) {
        city.postalCodes.push(String(station.postalCode));
      }
      city.stations += 1;
    }
  }

  return [...byCity.values()]
    .filter((entry) => entry.lats.length > 0 && entry.lngs.length > 0)
    .sort((a, b) => b.stations - a.stations)
    .slice(0, maxDiscoveredCities)
    .map((entry) => ({
      id: slugifyCityName(entry.name),
      name: entry.name,
      lat: Number(average(entry.lats).toFixed(6)),
      lng: Number(average(entry.lngs).toFixed(6)),
      postalCode: entry.postalCodes.length ? mostFrequent(entry.postalCodes) : undefined,
    }));
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
  const cityConfigs = Array.isArray(providerConfig.cities) ? providerConfig.cities : [];

  // Discover extra cities directly from Tankerkoenig station.place values.
  // This extends the configured city list without overwriting existing user-curated entries.
  const shouldDiscover = providerConfig.autoDiscoverCities !== false;
  if (shouldDiscover) {
    const maxDiscoveredCities = Number(providerConfig.maxDiscoveredCities || 12);
    const discoveredCities = await discoverGermanyCities(apiKey, maxDiscoveredCities);
    const existingIds = new Set(cityConfigs.map((entry) => entry.id));
    const existingNames = new Set(country.cities.map((entry) => normalizeGermanText(entry.name)));
    const existingPostalCodes = new Set(cityConfigs.map((entry) => String(entry.postalCode || "")));

    let added = 0;
    for (const discovered of discoveredCities) {
      const isNearbyDuplicate = cityConfigs.some((entry) => {
        if (typeof entry.lat !== "number" || typeof entry.lng !== "number") {
          return false;
        }
        return distanceKm(entry.lat, entry.lng, discovered.lat, discovered.lng) < 15;
      });

      if (
        !discovered.id ||
        existingIds.has(discovered.id) ||
        existingNames.has(normalizeGermanText(discovered.name)) ||
        (discovered.postalCode && existingPostalCodes.has(discovered.postalCode)) ||
        isNearbyDuplicate
      ) {
        continue;
      }

      cityConfigs.push({
        id: discovered.id,
        postalCode: discovered.postalCode,
        lat: discovered.lat,
        lng: discovered.lng,
        radiusKm: Number(providerConfig.defaultRadiusKm || 6),
        maxStations: Number(providerConfig.defaultMaxStations || 25),
      });
      country.cities.push({
        id: discovered.id,
        name: discovered.name,
        ...(discovered.postalCode ? { postalCode: discovered.postalCode } : {}),
        history: [],
      });
      existingIds.add(discovered.id);
      existingNames.add(normalizeGermanText(discovered.name));
      if (discovered.postalCode) {
        existingPostalCodes.add(discovered.postalCode);
      }
      added += 1;
    }

    if (added > 0) {
      providerConfig.cities = cityConfigs;
      country.providerConfig = providerConfig;
      console.log(`  Discovered ${added} additional cities from Tankerkoenig.`);
    }
  }

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
