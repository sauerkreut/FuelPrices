import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DATA_FILE = path.resolve(process.cwd(), "data", "fuel-prices.json");
const TODAY = new Date().toISOString().slice(0, 10);
const THAILAND_FUEL_MAP = [
  { key: "Gasohol 91", markers: ["แก๊สโซฮอล์ 91 S EVO"] },
  { key: "Gasohol 95", markers: ["แก๊สโซฮอล์ 95 S EVO"] },
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
}

async function ingestGermanyTankerkoenig(country) {
  const apiKey = process.env.TANKERKOENIG_API_KEY;
  if (!apiKey) {
    throw new Error("TANKERKOENIG_API_KEY is missing");
  }

  if (!country.supportsCities || !Array.isArray(country.cities)) {
    throw new Error("Germany country is not configured with city support");
  }

  const providerConfig = country.providerConfig || {};
  const cityConfigs = providerConfig.cities || [];

  for (const city of country.cities) {
    const cityConfig = cityConfigs.find((entry) => entry.id === city.id);
    if (!cityConfig) {
      console.warn(`City config missing for ${city.id}, skipping.`);
      continue;
    }

    const url = new URL("https://creativecommons.tankerkoenig.de/json/list.php");
    url.searchParams.set("lat", String(cityConfig.lat));
    url.searchParams.set("lng", String(cityConfig.lng));
    url.searchParams.set("rad", String(cityConfig.radiusKm || 5));
    url.searchParams.set("sort", "dist");
    url.searchParams.set("type", "all");
    url.searchParams.set("apikey", apiKey);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Tankerkoenig request failed (${city.id}): ${response.status}`);
    }

    const payload = await response.json();
    if (!payload?.ok || !Array.isArray(payload.stations)) {
      throw new Error(`Tankerkoenig payload invalid for ${city.id}`);
    }

    const stations = payload.stations
      .slice(0, cityConfig.maxStations || 20)
      .filter((station) => typeof station.e5 === "number" || typeof station.e10 === "number" || typeof station.diesel === "number");

    if (!stations.length) {
      console.warn(`No usable stations for ${city.id}.`);
      continue;
    }

    const avg = (selector) => {
      const values = stations.map(selector).filter((value) => typeof value === "number");
      if (!values.length) {
        return null;
      }
      return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
    };

    const prices = {
      "Super E5": avg((s) => s.e5),
      "Super E10": avg((s) => s.e10),
      Diesel: avg((s) => s.diesel),
    };

    const filteredPrices = Object.fromEntries(
      Object.entries(prices).filter(([, value]) => typeof value === "number")
    );

    city.history = upsertHistory(city.history, {
      date: TODAY,
      prices: filteredPrices,
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
