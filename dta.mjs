const STORAGE_KEY = "rosterExport.dtaRates.v1";
const SIGN_ON_BUFFER_MS = 60 * 60 * 1000;
const SIGN_OFF_BUFFER_MS = 30 * 60 * 1000;

export const DEFAULT_DTA_RATES = Object.freeze({
  AUS: 8.89,
  AKL: 14.16,
  DFW: 19.79,
  HNL: 19.79,
  JFK: 19.79,
  JNB: 9.17,
  LHR: 17.71,
  LAX: 19.79,
  SCL: 11.46,
  SFO: 19.79,
  YVR: 17.71,
});

const AUSTRALIAN_PORTS = new Set([
  "ADL",
  "ASP",
  "AYQ",
  "BNE",
  "BME",
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

function normalisePortCode(value) {
  return String(value || "").trim().toUpperCase();
}

function asValidRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

export function loadDtaRates(storageOverride = null) {
  const rates = { ...DEFAULT_DTA_RATES };
  const storage = getStorage(storageOverride);
  if (!storage) {
    return rates;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return rates;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return rates;
    }

    for (const [portCodeRaw, rateRaw] of Object.entries(parsed)) {
      const portCode = normalisePortCode(portCodeRaw);
      const rate = asValidRate(rateRaw);
      if (!portCode || rate == null) {
        continue;
      }
      rates[portCode] = rate;
    }
  } catch {
    return rates;
  }

  return rates;
}

export function saveDtaRates(rates, storageOverride = null) {
  const storage = getStorage(storageOverride);
  if (!storage) {
    return;
  }

  const cleaned = {};
  for (const [portCodeRaw, rateRaw] of Object.entries(rates || {})) {
    const portCode = normalisePortCode(portCodeRaw);
    const rate = asValidRate(rateRaw);
    if (!portCode || rate == null) {
      continue;
    }
    cleaned[portCode] = round2(rate);
  }

  storage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
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

function isDomesticPort(portCodeRaw) {
  const portCode = normalisePortCode(portCodeRaw);
  if (!portCode) {
    return false;
  }
  return AUSTRALIAN_PORTS.has(portCode);
}

function resolveRatePortForSlipPort(portCodeRaw) {
  const portCode = normalisePortCode(portCodeRaw);
  if (!portCode) {
    return "";
  }
  return isDomesticPort(portCode) ? "AUS" : portCode;
}

function resolvePartARatePort(originRaw, destinationRaw) {
  const origin = normalisePortCode(originRaw);
  const destination = normalisePortCode(destinationRaw);
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

function getHoursBetween(startDate, endDate) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
    return 0;
  }
  return (endDate.getTime() - startDate.getTime()) / 3600000;
}

export function calculateDtaForPattern(pattern, rates) {
  const flights = [...(pattern?.flights || [])].sort((a, b) => a.dtStartUtc - b.dtStartUtc);
  const rateMap = rates || {};
  const missingPorts = new Set();

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

    const dutyStartUtc = new Date(flight.dtStartUtc.getTime() - SIGN_ON_BUFFER_MS);
    const dutyEndUtc = new Date(flight.dtEndUtc.getTime() + SIGN_OFF_BUFFER_MS);
    const hours = getHoursBetween(dutyStartUtc, dutyEndUtc);
    if (hours <= 0) {
      continue;
    }

    const ratePort = resolvePartARatePort(flight.origin, flight.destination);
    const rate = asValidRate(rateMap[ratePort]);
    if (rate == null) {
      missingPorts.add(ratePort);
    }

    const amount = rate == null ? null : round2(hours * rate);
    partA.segments.push({
      flightNumber: flight.flightNumber,
      origin: flight.origin,
      destination: flight.destination,
      ratePort,
      hours: round2(hours),
      rate,
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
    const slipEndUtc = new Date(next.dtStartUtc.getTime() - SIGN_ON_BUFFER_MS);
    const hours = getHoursBetween(slipStartUtc, slipEndUtc);
    if (hours <= 0) {
      continue;
    }

    const ratePort = resolveRatePortForSlipPort(current.destination);
    const rate = asValidRate(rateMap[ratePort]);
    if (rate == null) {
      missingPorts.add(ratePort);
    }

    const amount = rate == null ? null : round2(hours * rate);
    partB.segments.push({
      slipPort: current.destination,
      ratePort,
      hours: round2(hours),
      rate,
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

  const grandTotal = round2(partA.totalAmount + partB.totalAmount);

  return {
    patternId: pattern?.id || "",
    patternCode: pattern?.patternCode || "",
    tripStartIso: pattern?.tripStartIso || "",
    tripEndIso: pattern?.tripEndIso || "",
    flightsCount: flights.length,
    partA,
    partB,
    grandTotal,
    missingPorts: [...missingPorts].sort(),
    canFullyCalculate: missingPorts.size === 0,
  };
}
