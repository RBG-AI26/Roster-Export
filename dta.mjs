const COUNTRY_RATES_STORAGE_KEY = "rosterExport.dtaCountryRates.v2";
const AIRPORT_COUNTRY_STORAGE_KEY = "rosterExport.airportCountryMap.v2";

const SIGN_ON_BUFFER_MS = 60 * 60 * 1000;
const SIGN_OFF_BUFFER_MS = 30 * 60 * 1000;

export const DEFAULT_FALLBACK_RATE = Object.freeze({
  costGroup: "1",
  mealRate: 5.0,
  incidentalRate: 1.25,
  hourlyRate: 6.25,
});

export const DEFAULT_COUNTRY_RATES = Object.freeze({
  "Albania": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Algeria": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Antigua and Barbuda": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Argentina": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Armenia": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Australia": Object.freeze({ costGroup: "AUS", mealRate: 7.71, incidentalRate: 1.46, hourlyRate: 9.17 }),
  "Austria": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Azerbaijan": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Bahamas": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Bahrain": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Bangladesh": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Barbados": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Belarus": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Belgium": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Bermuda": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Bolivia": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Bosnia": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Brazil": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Brunei": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Bulgaria": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Burkina Faso": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Cambodia": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Cameroon": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Canada": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Chile": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "China": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Colombia": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Cook Islands": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Costa Rica": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Cote d'Ivoire": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Croatia": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Cyprus": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Czech Republic": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Denmark": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Dominican Republic": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "East Timor": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Ecuador": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Egypt": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "El Salvador": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Eritrea": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Estonia": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Ethiopia": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Fiji": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Finland": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "France": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "French Polynesia": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Gabon": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Gambia": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Georgia": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Germany": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Gibraltar": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Greece": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Guatemala": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Guyana": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Hong Kong": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Hungary": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Iceland": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "India": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Indonesia": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Iran": Object.freeze({ costGroup: "1", mealRate: 5, incidentalRate: 1.25, hourlyRate: 6.25 }),
  "Iraq": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Ireland": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Israel": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Italy": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Jamaica": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Japan": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Jordan": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Kazakhstan": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Kenya": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Korea Republic": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Kosovo": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Kuwait": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Kyrgyzstan": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Laos": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Latvia": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Lebanon": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Lithuania": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Luxembourg": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Macau": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Malaysia": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Mali": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Malta": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Mauritius": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Mexico": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Monaco": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Morocco": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Mozambique": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Myanmar": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Namibia": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Nepal": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Netherlands": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "New Caledonia": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "New Zealand": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Nicaragua": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Nigeria": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "North Macedonia": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Norway": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Oman": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Pakistan": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Panama": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Papua New Guinea": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Paraguay": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Peru": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Philippines": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Poland": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Portugal": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Puerto Rico": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Qatar": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Romania": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Russia": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Rwanda": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Saint Lucia": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Saint Vincent": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Samoa": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Saudi Arabia": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Senegal": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Serbia": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Sierra Leone": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Singapore": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Slovakia": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Slovenia": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Solomon Islands": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "South Africa": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Spain": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Sri Lanka": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Sweden": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Switzerland": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Taiwan": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "Tanzania": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Thailand": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Tonga": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Trinidad and Tobago": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Tunisia": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "Turkiye (Turkey)": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Uganda": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Ukraine": Object.freeze({ costGroup: "2", mealRate: 7.5, incidentalRate: 1.67, hourlyRate: 9.17 }),
  "United Arab Emirates": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "United Kingdom": Object.freeze({ costGroup: "5", mealRate: 15.21, incidentalRate: 2.5, hourlyRate: 17.71 }),
  "United States of America": Object.freeze({ costGroup: "6", mealRate: 17.29, incidentalRate: 2.5, hourlyRate: 19.79 }),
  "Uruguay": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
  "Vanuatu": Object.freeze({ costGroup: "4", mealRate: 12.08, incidentalRate: 2.08, hourlyRate: 14.16 }),
  "Vietnam": Object.freeze({ costGroup: "3", mealRate: 9.58, incidentalRate: 1.88, hourlyRate: 11.46 }),
});

const AUSTRALIAN_PORTS = new Set([
  "ADL",
  "ASP",
  "AYQ",
  "BME",
  "BNE",
  "CBR",
  "CNS",
  "DRW",
  "HBA",
  "LST",
  "MEL",
  "NTL",
  "OOL",
  "PER",
  "ROK",
  "SYD",
  "TSV",
]);

export const DEFAULT_AIRPORT_COUNTRY_MAP = Object.freeze({
  ADL: "Australia",
  AKL: "New Zealand",
  AMS: "Netherlands",
  APW: "Samoa",
  ASP: "Australia",
  BKK: "Thailand",
  BLR: "India",
  BOM: "India",
  BNE: "Australia",
  CBR: "Australia",
  CAN: "China",
  CDG: "France",
  CGK: "Indonesia",
  CHC: "New Zealand",
  CNS: "Australia",
  CMB: "Sri Lanka",
  CPT: "South Africa",
  DEL: "India",
  DEN: "United States of America",
  DFW: "United States of America",
  DOH: "Qatar",
  DPS: "Indonesia",
  DRW: "Australia",
  DXB: "United Arab Emirates",
  FCO: "Italy",
  FRA: "Germany",
  GIG: "Brazil",
  GVA: "Switzerland",
  HBA: "Australia",
  HKG: "Hong Kong",
  HND: "Japan",
  HNL: "United States of America",
  ICN: "Korea Republic",
  IST: "Turkiye (Turkey)",
  JFK: "United States of America",
  JNB: "South Africa",
  KIX: "Japan",
  KUL: "Malaysia",
  LAX: "United States of America",
  LHR: "United Kingdom",
  LGW: "United Kingdom",
  MAD: "Spain",
  MEL: "Australia",
  MNL: "Philippines",
  MXP: "Italy",
  NAN: "Fiji",
  NRT: "Japan",
  NOU: "New Caledonia",
  OOL: "Australia",
  ORD: "United States of America",
  PER: "Australia",
  PPT: "French Polynesia",
  PVG: "China",
  SCL: "Chile",
  SFO: "United States of America",
  SIN: "Singapore",
  SYD: "Australia",
  TPE: "Taiwan",
  TSV: "Australia",
  VLI: "Vanuatu",
  WLG: "New Zealand",
  YVR: "Canada",
  ZQN: "New Zealand",
  ZRH: "Switzerland",
});

const COUNTRY_NAME_ALIASES = Object.freeze({
  "UNITED STATES": "United States of America",
  USA: "United States of America",
  US: "United States of America",
  "UNITED STATES OF AMERICA": "United States of America",
  "UNITED KINGDOM": "United Kingdom",
  UK: "United Kingdom",
  BRITAIN: "United Kingdom",
  "GREAT BRITAIN": "United Kingdom",
  "KOREA REPUBLIC": "Korea Republic",
  "REPUBLIC OF KOREA": "Korea Republic",
  "KOREA SOUTH": "Korea Republic",
  "COTE D IVOIRE": "Cote d'Ivoire",
  "COTE DIVOIRE": "Cote d'Ivoire",
  "TURKIYE TURKEY": "Turkiye (Turkey)",
  TURKEY: "Turkiye (Turkey)",
  TURKIYE: "Turkiye (Turkey)",
});

function normaliseAirportCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normaliseCountryKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[`’]/g, "'")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function asPositiveNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

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

function canonicaliseCountryName(countryName, rates = DEFAULT_COUNTRY_RATES) {
  const raw = String(countryName || "").trim();
  if (!raw) {
    return "";
  }

  const inputKey = normaliseCountryKey(raw);
  const alias = COUNTRY_NAME_ALIASES[inputKey];
  if (alias) {
    return alias;
  }

  for (const knownCountry of Object.keys(rates || {})) {
    if (normaliseCountryKey(knownCountry) === inputKey) {
      return knownCountry;
    }
  }

  return raw;
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

export function getKnownCountries(countryRates) {
  return Object.keys(countryRates || {}).sort((a, b) => a.localeCompare(b));
}

export function getCountryRateRows(countryRates) {
  return getKnownCountries(countryRates).map((country) => ({
    country,
    ...countryRates[country],
  }));
}

function isDomesticPort(portCodeRaw) {
  const portCode = normaliseAirportCode(portCodeRaw);
  if (!portCode) {
    return false;
  }
  return AUSTRALIAN_PORTS.has(portCode);
}

function resolvePartAAirportCode(originRaw, destinationRaw) {
  const origin = normaliseAirportCode(originRaw);
  const destination = normaliseAirportCode(destinationRaw);
  const originDomestic = isDomesticPort(origin);
  const destinationDomestic = isDomesticPort(destination);

  if (originDomestic && destinationDomestic) {
    return "AUS";
  }
  if (!originDomestic && !destinationDomestic) {
    return origin;
  }
  if (!destinationDomestic) {
    return destination;
  }
  if (!originDomestic) {
    return origin;
  }

  return "AUS";
}

function resolveSlipAirportCode(portCodeRaw) {
  const portCode = normaliseAirportCode(portCodeRaw);
  if (!portCode) {
    return "";
  }
  return isDomesticPort(portCode) ? "AUS" : portCode;
}

function resolveCountryForAirport(airportCodeRaw, airportCountryMap, countryRates) {
  const airportCode = normaliseAirportCode(airportCodeRaw);
  if (!airportCode) {
    return "";
  }

  if (airportCode === "AUS" || isDomesticPort(airportCode)) {
    return "Australia";
  }

  const mappedCountry = airportCountryMap[airportCode];
  if (!mappedCountry) {
    return "";
  }

  return canonicaliseCountryName(mappedCountry, countryRates);
}

function getHoursBetween(startDate, endDate) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
    return 0;
  }
  return (endDate.getTime() - startDate.getTime()) / 3600000;
}

function resolveRateDetailsByCountry(countryName, countryRates) {
  const canonicalCountry = canonicaliseCountryName(countryName, countryRates);
  const known = canonicalCountry ? countryRates[canonicalCountry] : null;
  if (known) {
    return {
      country: canonicalCountry,
      rate: known.hourlyRate,
      costGroup: known.costGroup,
      source: "table",
    };
  }

  return {
    country: canonicalCountry || String(countryName || "").trim(),
    rate: DEFAULT_FALLBACK_RATE.hourlyRate,
    costGroup: DEFAULT_FALLBACK_RATE.costGroup,
    source: "fallback",
  };
}

export function getDtaPatterns(parsedRoster) {
  if (!parsedRoster?.events?.length) {
    return [];
  }

  const patternEvents = parsedRoster.events.filter((event) => event.eventType === "pattern");
  const flightEvents = parsedRoster.events.filter((event) => event.eventType === "flight");

  const patternByKey = new Map();
  for (const event of patternEvents) {
    const key = `${event.patternCode}|${event.tripStartIso}`;
    patternByKey.set(key, event);
  }

  const flightsByKey = new Map();
  for (const event of flightEvents) {
    const key = `${event.patternCode}|${event.tripStartIso}`;
    if (!flightsByKey.has(key)) {
      flightsByKey.set(key, []);
    }
    flightsByKey.get(key).push(event);
  }

  const allKeys = new Set([...patternByKey.keys(), ...flightsByKey.keys()]);
  const patterns = [];

  for (const key of allKeys) {
    const patternEvent = patternByKey.get(key);
    const flights = [...(flightsByKey.get(key) || [])].sort((a, b) => a.dtStartUtc - b.dtStartUtc);
    const [patternCode, tripStartIso] = key.split("|");
    const fallbackEndIso =
      flights.length > 0 ? flights[flights.length - 1].dtEndUtc.toISOString().slice(0, 10) : tripStartIso;
    const tripEndIso = patternEvent?.tripEndIso || fallbackEndIso;
    const startSort =
      flights.length > 0
        ? flights[0].dtStartUtc.getTime()
        : Date.parse(`${tripStartIso || "1970-01-01"}T00:00:00Z`) || 0;

    patterns.push({
      id: key,
      patternCode,
      tripStartIso,
      tripEndIso,
      flights,
      startSort,
      label: `${patternCode} (${tripStartIso})`,
    });
  }

  patterns.sort((a, b) => a.startSort - b.startSort || a.id.localeCompare(b.id));
  return patterns;
}

export function calculateDtaForPattern(pattern, countryRates, airportCountryMap) {
  const flights = [...(pattern?.flights || [])].sort((a, b) => a.dtStartUtc - b.dtStartUtc);
  const rates = countryRates || {};
  const airportMap = airportCountryMap || {};

  const missingAirportCodes = new Set();
  const fallbackCountriesUsed = new Set();

  const partA = {
    segments: [],
    totalHours: 0,
    totalAmount: 0,
  };

  const partB = {
    segments: [],
    totalHours: 0,
    totalAmount: 0,
  };

  for (const flight of flights) {
    if (!(flight.dtStartUtc instanceof Date) || !(flight.dtEndUtc instanceof Date)) {
      continue;
    }

    const dutyStartUtc =
      flight.reportStartUtc instanceof Date
        ? flight.reportStartUtc
        : new Date(flight.dtStartUtc.getTime() - SIGN_ON_BUFFER_MS);
    const dutyEndUtc = new Date(flight.dtEndUtc.getTime() + SIGN_OFF_BUFFER_MS);
    const hours = getHoursBetween(dutyStartUtc, dutyEndUtc);
    if (hours <= 0) {
      continue;
    }

    const rateAirportCode = resolvePartAAirportCode(flight.origin, flight.destination);
    const rateCountry = resolveCountryForAirport(rateAirportCode, airportMap, rates);

    let rate = null;
    let rateSource = "missing-airport-map";
    let costGroup = "";

    if (!rateCountry) {
      missingAirportCodes.add(rateAirportCode);
    } else {
      const details = resolveRateDetailsByCountry(rateCountry, rates);
      rate = details.rate;
      rateSource = details.source;
      costGroup = details.costGroup;
      if (details.source === "fallback") {
        fallbackCountriesUsed.add(details.country || rateCountry);
      }
    }

    const amount = rate == null ? null : round2(hours * rate);
    partA.segments.push({
      flightNumber: flight.flightNumber,
      origin: flight.origin,
      destination: flight.destination,
      rateAirportCode,
      rateCountry,
      rate,
      rateSource,
      costGroup,
      hours: round2(hours),
      amount,
      startUtc: dutyStartUtc,
      endUtc: dutyEndUtc,
    });

    partA.totalHours += hours;
    if (amount != null) {
      partA.totalAmount += amount;
    }
  }

  for (let i = 0; i < flights.length - 1; i += 1) {
    const current = flights[i];
    const next = flights[i + 1];
    if (!(current.dtEndUtc instanceof Date) || !(next.dtStartUtc instanceof Date)) {
      continue;
    }

    const slipStartUtc = new Date(current.dtEndUtc.getTime() + SIGN_OFF_BUFFER_MS);
    const slipEndUtc =
      next.reportStartUtc instanceof Date
        ? next.reportStartUtc
        : new Date(next.dtStartUtc.getTime() - SIGN_ON_BUFFER_MS);
    const hours = getHoursBetween(slipStartUtc, slipEndUtc);
    if (hours <= 0) {
      continue;
    }

    const rateAirportCode = resolveSlipAirportCode(current.destination);
    const rateCountry = resolveCountryForAirport(rateAirportCode, airportMap, rates);

    let rate = null;
    let rateSource = "missing-airport-map";
    let costGroup = "";

    if (!rateCountry) {
      missingAirportCodes.add(rateAirportCode);
    } else {
      const details = resolveRateDetailsByCountry(rateCountry, rates);
      rate = details.rate;
      rateSource = details.source;
      costGroup = details.costGroup;
      if (details.source === "fallback") {
        fallbackCountriesUsed.add(details.country || rateCountry);
      }
    }

    const amount = rate == null ? null : round2(hours * rate);
    partB.segments.push({
      slipPort: current.destination,
      rateAirportCode,
      rateCountry,
      rate,
      rateSource,
      costGroup,
      hours: round2(hours),
      amount,
      startUtc: slipStartUtc,
      endUtc: slipEndUtc,
    });

    partB.totalHours += hours;
    if (amount != null) {
      partB.totalAmount += amount;
    }
  }

  partA.totalHours = round2(partA.totalHours);
  partB.totalHours = round2(partB.totalHours);
  partA.totalAmount = round2(partA.totalAmount);
  partB.totalAmount = round2(partB.totalAmount);

  return {
    patternId: pattern?.id || "",
    patternCode: pattern?.patternCode || "",
    tripStartIso: pattern?.tripStartIso || "",
    tripEndIso: pattern?.tripEndIso || "",
    flightsCount: flights.length,
    partA,
    partB,
    grandTotal: round2(partA.totalAmount + partB.totalAmount),
    missingAirportCodes: [...missingAirportCodes].sort(),
    fallbackCountriesUsed: [...fallbackCountriesUsed].sort((a, b) => a.localeCompare(b)),
    canFullyCalculate: missingAirportCodes.size === 0,
  };
}

export function normaliseAirportCodeForInput(value) {
  return normaliseAirportCode(value);
}

export function canonicaliseCountryNameForInput(value, countryRates) {
  return canonicaliseCountryName(value, countryRates);
}
