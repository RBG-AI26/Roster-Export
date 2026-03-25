import {
  AUSTRALIAN_PORTS,
  COUNTRY_NAME_ALIASES,
  DEFAULT_AIRPORT_COUNTRY_MAP,
  DEFAULT_COUNTRY_RATES,
  DEFAULT_FALLBACK_RATE,
} from "./dta-reference-data.mjs";

const SIGN_ON_BUFFER_MS = 60 * 60 * 1000;
const SIGN_OFF_BUFFER_MS = 30 * 60 * 1000;

function normaliseCountryKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[`’]/g, "'")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseAirportCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function asPositiveNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

export function canonicaliseCountryName(countryName, rates = DEFAULT_COUNTRY_RATES) {
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

export function getHourlyRateForAirport(airportCodeRaw, countryRates, airportCountryMap, airportRateOverrides = {}) {
  const airportCode = normaliseAirportCode(airportCodeRaw);
  if (!/^[A-Z]{3}$/.test(airportCode) && airportCode !== "AUS") {
    return {
      airportCode,
      country: "",
      rate: null,
      costGroup: "",
      source: "invalid-airport-code",
    };
  }

  const overrideRate = asPositiveNumber(airportRateOverrides?.[airportCode]);
  if (overrideRate != null) {
    const country = resolveCountryForAirport(airportCode, airportCountryMap || {}, countryRates || {});
    return {
      airportCode,
      country,
      rate: round2(overrideRate),
      costGroup: "OVERRIDE",
      source: "override",
    };
  }

  const country = resolveCountryForAirport(airportCode, airportCountryMap || {}, countryRates || {});
  if (!country) {
    return {
      airportCode,
      country: "",
      rate: null,
      costGroup: "",
      source: "missing-airport-map",
    };
  }

  const details = resolveRateDetailsByCountry(country, countryRates || {});
  return {
    airportCode,
    country: details.country || country,
    rate: details.rate,
    costGroup: details.costGroup,
    source: details.source,
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

export function calculateDtaForPattern(pattern, countryRates, airportCountryMap, airportRateOverrides = {}) {
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
    const details = getHourlyRateForAirport(rateAirportCode, rates, airportMap, airportRateOverrides);
    const rateCountry = details.country;
    const rate = details.rate;
    const rateSource = details.source;
    const costGroup = details.costGroup;

    if (rate == null) {
      missingAirportCodes.add(rateAirportCode);
    }
    if (rateSource === "fallback") {
      fallbackCountriesUsed.add(rateCountry || rateAirportCode);
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
    const details = getHourlyRateForAirport(rateAirportCode, rates, airportMap, airportRateOverrides);
    const rateCountry = details.country;
    const rate = details.rate;
    const rateSource = details.source;
    const costGroup = details.costGroup;

    if (rate == null) {
      missingAirportCodes.add(rateAirportCode);
    }
    if (rateSource === "fallback") {
      fallbackCountriesUsed.add(rateCountry || rateAirportCode);
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
