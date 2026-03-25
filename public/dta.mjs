import {
  DEFAULT_AIRPORT_COUNTRY_MAP,
  DEFAULT_COUNTRY_RATES,
  DEFAULT_FALLBACK_RATE,
} from "./shared/dta-reference-data.mjs";
import {
  asPositiveNumber,
  calculateDtaForPattern,
  canonicaliseCountryName,
  getCountryRateRows,
  getDtaPatterns,
  getHourlyRateForAirport,
  getKnownCountries,
  normaliseAirportCode,
  round2,
} from "./shared/dta-engine.mjs";

const COUNTRY_RATES_STORAGE_KEY = "rosterExport.dtaCountryRates.v2";
const AIRPORT_COUNTRY_STORAGE_KEY = "rosterExport.airportCountryMap.v2";
const AIRPORT_RATE_OVERRIDE_STORAGE_KEY = "rosterExport.airportRateOverrides.v1";

function getStorage(storageOverride) {
  if (storageOverride) {
    return storageOverride;
  }

  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function cloneCountryRates(source) {
  const cloned = {};
  for (const [country, details] of Object.entries(source || {})) {
    const mealRate = asPositiveNumber(details?.mealRate);
    const incidentalRate = asPositiveNumber(details?.incidentalRate);
    const hourlyRate = asPositiveNumber(details?.hourlyRate);
    if (!country || mealRate == null || incidentalRate == null || hourlyRate == null) {
      continue;
    }
    cloned[country] = {
      costGroup: String(details?.costGroup || ""),
      mealRate: round2(mealRate),
      incidentalRate: round2(incidentalRate),
      hourlyRate: round2(hourlyRate),
    };
  }
  return cloned;
}

function cleanCountryRateRow(countryName, row) {
  const canonicalCountry = String(countryName || "").trim();
  if (!canonicalCountry) {
    return null;
  }

  const mealRate = asPositiveNumber(row?.mealRate);
  const incidentalRate = asPositiveNumber(row?.incidentalRate);
  const derivedHourly = mealRate != null && incidentalRate != null ? round2(mealRate + incidentalRate) : null;
  const hourlyRate = asPositiveNumber(row?.hourlyRate) ?? derivedHourly;

  if (mealRate == null || incidentalRate == null || hourlyRate == null) {
    return null;
  }

  return {
    country: canonicalCountry,
    details: {
      costGroup: String(row?.costGroup || ""),
      mealRate: round2(mealRate),
      incidentalRate: round2(incidentalRate),
      hourlyRate: round2(hourlyRate),
    },
  };
}

export function loadDtaCountryRates(storageOverride = null) {
  const defaults = cloneCountryRates(DEFAULT_COUNTRY_RATES);
  const storage = getStorage(storageOverride);
  if (!storage) {
    return defaults;
  }

  try {
    const raw = storage.getItem(COUNTRY_RATES_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return defaults;
    }

    const loaded = {};
    for (const [countryName, row] of Object.entries(parsed)) {
      const clean = cleanCountryRateRow(countryName, row);
      if (!clean) {
        continue;
      }
      loaded[clean.country] = clean.details;
    }

    if (Object.keys(loaded).length === 0) {
      return defaults;
    }

    return loaded;
  } catch {
    return defaults;
  }
}

export function saveDtaCountryRates(countryRates, storageOverride = null) {
  const storage = getStorage(storageOverride);
  if (!storage) {
    return;
  }

  const cleaned = {};
  for (const [countryName, row] of Object.entries(countryRates || {})) {
    const clean = cleanCountryRateRow(countryName, row);
    if (!clean) {
      continue;
    }
    cleaned[clean.country] = clean.details;
  }

  storage.setItem(COUNTRY_RATES_STORAGE_KEY, JSON.stringify(cleaned));
}

export function loadAirportCountryMap(storageOverride = null, rates = DEFAULT_COUNTRY_RATES) {
  const merged = { ...DEFAULT_AIRPORT_COUNTRY_MAP };
  const storage = getStorage(storageOverride);
  if (!storage) {
    return merged;
  }

  try {
    const raw = storage.getItem(AIRPORT_COUNTRY_STORAGE_KEY);
    if (!raw) {
      return merged;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return merged;
    }

    for (const [airportCodeRaw, countryRaw] of Object.entries(parsed)) {
      const airportCode = normaliseAirportCode(airportCodeRaw);
      if (!/^[A-Z]{3}$/.test(airportCode)) {
        continue;
      }
      const country = canonicaliseCountryName(countryRaw, rates);
      if (!country) {
        continue;
      }
      merged[airportCode] = country;
    }
  } catch {
    return merged;
  }

  return merged;
}

export function saveAirportCountryMap(airportCountryMap, storageOverride = null, rates = DEFAULT_COUNTRY_RATES) {
  const storage = getStorage(storageOverride);
  if (!storage) {
    return;
  }

  const cleaned = {};
  for (const [airportCodeRaw, countryRaw] of Object.entries(airportCountryMap || {})) {
    const airportCode = normaliseAirportCode(airportCodeRaw);
    if (!/^[A-Z]{3}$/.test(airportCode)) {
      continue;
    }
    const country = canonicaliseCountryName(countryRaw, rates);
    if (!country) {
      continue;
    }
    cleaned[airportCode] = country;
  }

  storage.setItem(AIRPORT_COUNTRY_STORAGE_KEY, JSON.stringify(cleaned));
}

export function loadAirportRateOverrides(storageOverride = null) {
  const storage = getStorage(storageOverride);
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(AIRPORT_RATE_OVERRIDE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const cleaned = {};
    for (const [airportCodeRaw, rateRaw] of Object.entries(parsed)) {
      const airportCode = normaliseAirportCode(airportCodeRaw);
      const rate = asPositiveNumber(rateRaw);
      if (!/^[A-Z]{3}$/.test(airportCode) || rate == null) {
        continue;
      }
      cleaned[airportCode] = round2(rate);
    }
    return cleaned;
  } catch {
    return {};
  }
}

export function saveAirportRateOverrides(airportRateOverrides, storageOverride = null) {
  const storage = getStorage(storageOverride);
  if (!storage) {
    return;
  }

  const cleaned = {};
  for (const [airportCodeRaw, rateRaw] of Object.entries(airportRateOverrides || {})) {
    const airportCode = normaliseAirportCode(airportCodeRaw);
    const rate = asPositiveNumber(rateRaw);
    if (!/^[A-Z]{3}$/.test(airportCode) || rate == null) {
      continue;
    }
    cleaned[airportCode] = round2(rate);
  }

  storage.setItem(AIRPORT_RATE_OVERRIDE_STORAGE_KEY, JSON.stringify(cleaned));
}

export {
  DEFAULT_FALLBACK_RATE,
  DEFAULT_COUNTRY_RATES,
  DEFAULT_AIRPORT_COUNTRY_MAP,
  getKnownCountries,
  getCountryRateRows,
  getHourlyRateForAirport,
  getDtaPatterns,
  calculateDtaForPattern,
};

export function normaliseAirportCodeForInput(value) {
  return normaliseAirportCode(value);
}

export function canonicaliseCountryNameForInput(value, countryRates) {
  return canonicaliseCountryName(value, countryRates);
}
