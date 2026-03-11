const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function parseHeaderDate(text) {
  const match = text.match(/\b(\d{2})\s+([A-Za-z]{3})\s+(\d{4})\b/);
  if (!match) {
    return new Date();
  }

  const day = Number(match[1]);
  const month = MONTHS[match[2]];
  const year = Number(match[3]);
  if (Number.isNaN(month)) {
    return new Date();
  }

  return new Date(Date.UTC(year, month, day));
}

function normaliseDate(day, month, headerDate) {
  const headerYear = headerDate.getUTCFullYear();
  let candidate = new Date(Date.UTC(headerYear, month - 1, day));

  const daysAway = Math.floor((candidate - headerDate) / 86400000);
  if (daysAway < -200) {
    candidate = new Date(Date.UTC(headerYear + 1, month - 1, day));
  } else if (daysAway > 200) {
    candidate = new Date(Date.UTC(headerYear - 1, month - 1, day));
  }

  return candidate;
}

function isoDate(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ymdForIcs(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function parseDurationToMinutes(value) {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToDurationString(minutes) {
  if (minutes == null || Number.isNaN(minutes)) {
    return null;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${String(mins).padStart(2, "0")}`;
}

function addDays(date, days) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function parseScheduleSegment(segment, headerDate) {
  const match = segment.match(/^\s*(\d{2})\/(\d{2})\s+([MTWFS])\s+(.+)$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const dayLetter = match[3];
  const rest = match[4].trim();
  if (!rest) {
    return null;
  }

  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const dutyCode = tokens.shift();
  let credit = null;

  if (tokens.length > 0 && /^\d{1,2}:\d{2}$/.test(tokens[tokens.length - 1])) {
    credit = tokens.pop();
  }

  const timeIndexes = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (/^\d{4}$/.test(tokens[i])) {
      timeIndexes.push(i);
    }
  }

  const rept = timeIndexes.length > 0 ? tokens[timeIndexes[0]] : null;
  const end = timeIndexes.length > 1 ? tokens[timeIndexes[1]] : null;

  const timeIndexSet = new Set(timeIndexes);
  const detail = tokens
    .filter((_, idx) => !timeIndexSet.has(idx))
    .join(" ")
    .trim() || null;

  const date = normaliseDate(day, month, headerDate);
  return {
    date,
    iso: isoDate(date),
    dayLetter,
    dutyCode,
    detail,
    rept,
    end,
    credit,
  };
}

function splitScheduleLineIntoSegments(line) {
  const source = String(line || "");
  if (!source.trim()) {
    return [];
  }

  if (/[|│]/.test(source)) {
    return source.split(/[|│]/);
  }

  const starts = [...source.matchAll(/\d{2}\/\d{2}\s+[MTWFS]\s+/g)].map((match) => match.index);
  if (starts.length <= 1) {
    return [source];
  }

  const segments = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : source.length;
    segments.push(source.slice(start, end));
  }

  return segments;
}

function dedupeScheduleRows(rows) {
  const output = [];
  const seen = new Set();

  for (const row of rows) {
    const key = [row.iso, row.dutyCode, row.detail || "", row.rept || "", row.end || "", row.credit || ""].join("|");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(row);
  }

  return output;
}

function parseScheduleRows(lines, headerDate) {
  const startIndex = lines.findIndex(
    (line) => /Date\s+Duty/.test(line) && /Detail/.test(line) && /Credit/.test(line)
  );

  const rows = [];
  const begin = startIndex >= 0 ? startIndex + 1 : 0;
  let inScheduleTable = startIndex >= 0;

  for (let i = begin; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes("Carry Out")) {
      break;
    }

    if (!inScheduleTable && /^\s*\d{2}\/\d{2}\s+[MTWFS]\s+/.test(line)) {
      inScheduleTable = true;
    }
    if (!inScheduleTable) {
      continue;
    }

    const segments = splitScheduleLineIntoSegments(line);
    for (const segment of segments) {
      const parsed = parseScheduleSegment(segment, headerDate);
      if (parsed) {
        rows.push(parsed);
      }
    }
  }

  if (rows.length === 0) {
    for (const line of lines) {
      const segments = splitScheduleLineIntoSegments(line);
      for (const segment of segments) {
        const parsed = parseScheduleSegment(segment, headerDate);
        if (parsed) {
          rows.push(parsed);
        }
      }
    }
  }

  const dedupedRows = dedupeScheduleRows(rows);
  dedupedRows.sort((a, b) => a.date - b.date);
  return dedupedRows;
}

function parseFlightLine(line) {
  if (!/^\s*[A-Z]{2,3}\d{2,4}\b/.test(line)) {
    return null;
  }

  const flightNumberMatch = line.match(/^\s*([A-Z]{2,3}\d{2,4})\b/);
  const sectorMatch = line.match(/\b([A-Z]{3})\/([A-Z]{3})\b/);
  if (!flightNumberMatch || !sectorMatch) {
    return null;
  }

  const flightNumber = flightNumberMatch[1];
  const origin = sectorMatch[1];
  const destination = sectorMatch[2];

  const rest = line.slice(sectorMatch.index + sectorMatch[0].length);
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  const dayTokenIndex = tokens.findIndex((token) => /^(MO|TU|WE|TH|FR|SA|SU)$/.test(token));
  if (dayTokenIndex < 0) {
    return null;
  }

  let reportLocal = null;
  let depDay;
  let depLocal;
  let depUtc;
  let arrDay;
  let arrLocal;
  let arrUtc;

  if (dayTokenIndex === 1 && /^\d{4}$/.test(tokens[0])) {
    reportLocal = tokens[0];
    depDay = tokens[1];
    depLocal = tokens[2];
    depUtc = tokens[3];
    arrDay = tokens[4];
    arrLocal = tokens[5];
    arrUtc = tokens[6];
  } else if (dayTokenIndex === 0) {
    depDay = tokens[0];
    depLocal = tokens[1];
    depUtc = tokens[2];
    arrDay = tokens[3];
    arrLocal = tokens[4];
    arrUtc = tokens[5];
  } else {
    return null;
  }

  if (!/^\d{4}$/.test(depLocal || "") || !/^\d{4}$/.test(depUtc || "") || !/^\d{4}$/.test(arrLocal || "") || !/^\d{4}$/.test(arrUtc || "")) {
    return null;
  }

  const timeAnchor = new RegExp(`\\b${arrDay}\\s+${arrLocal}\\s+${arrUtc}(.*)$`);
  const tail = line.match(timeAnchor)?.[1] ?? "";
  const leadingSpaces = (tail.match(/^\s*/) || [""])[0].length;
  const durationTokens = [...tail.matchAll(/(\d{1,2}:\d{2})/g)].map((match) => match[1]);
  let flightDuration = null;
  if (durationTokens.length > 0) {
    const hasFreeDutyValue = leadingSpaces <= 5;
    const preferredIndex = hasFreeDutyValue && durationTokens.length > 1 ? 1 : 0;
    flightDuration = durationTokens[preferredIndex];
  }

  return {
    flightNumber,
    origin,
    destination,
    reportLocal,
    depDay,
    depLocal,
    depUtc,
    arrDay,
    arrLocal,
    arrUtc,
    flightDuration,
    flightDurationMinutes: parseDurationToMinutes(flightDuration),
  };
}

function parsePatternBlocks(lines) {
  const patternMap = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const patternMatch =
      line.match(/\|\*\s*Pattern:\s*([A-Z0-9]+)\s*\|/i) || line.match(/\bPattern\s*:?\s*([A-Z0-9]{4,})\b/i);
    if (!patternMatch) {
      continue;
    }

    const patternCode = patternMatch[1].toUpperCase();
    const flights = [];

    for (let j = i + 1; j < lines.length; j += 1) {
      const blockLine = lines[j];
      if (blockLine.startsWith("----------------------------------------------------------------")) {
        break;
      }

      const flight = parseFlightLine(blockLine);
      if (flight) {
        flights.push(flight);
      }
    }

    if (flights.length > 0) {
      patternMap.set(patternCode, flights);
    }
  }

  return patternMap;
}

function buildTripOccurrences(scheduleRows, patternMap) {
  const patternCodes = new Set(patternMap.keys());
  const occurrences = [];
  let current = null;

  for (const row of scheduleRows) {
    const isPatternDay = patternCodes.has(row.dutyCode);
    if (!isPatternDay) {
      if (current) {
        occurrences.push(current);
        current = null;
      }
      continue;
    }

    if (!current) {
      current = {
        patternCode: row.dutyCode,
        startDate: row.date,
        endDate: row.date,
      };
      continue;
    }

    const expectedNextIso = isoDate(addDays(current.endDate, 1));
    const isSamePatternContinuation = current.patternCode === row.dutyCode && row.iso === expectedNextIso;

    if (isSamePatternContinuation) {
      current.endDate = row.date;
      continue;
    }

    occurrences.push(current);
    current = {
      patternCode: row.dutyCode,
      startDate: row.date,
      endDate: row.date,
    };
  }

  if (current) {
    occurrences.push(current);
  }

  return occurrences;
}

function nextDateForDayCode(baseDate, dayCode) {
  const target = DAY_CODES.indexOf(dayCode);
  if (target < 0) {
    return baseDate;
  }

  for (let i = 0; i < 14; i += 1) {
    const candidate = addDays(baseDate, i);
    if (candidate.getUTCDay() === target) {
      return candidate;
    }
  }

  return baseDate;
}

function parseUtcDate(date, hhmm) {
  const hh = Number(hhmm.slice(0, 2));
  const mm = Number(hhmm.slice(2, 4));
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hh, mm, 0));
}

function parseLocalPseudoDateTime(date, hhmm) {
  const hh = Number(hhmm.slice(0, 2));
  const mm = Number(hhmm.slice(2, 4));
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hh, mm, 0));
}

function hhmmToMinutes(hhmm) {
  if (!/^\d{4}$/.test(hhmm || "")) {
    return null;
  }
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
}

function deriveReportStartUtc(depLocalDate, depLocalHhmm, reportLocalHhmm, depDateTimeUtc) {
  if (!(depLocalDate instanceof Date) || !(depDateTimeUtc instanceof Date)) {
    return null;
  }
  if (!/^\d{4}$/.test(depLocalHhmm || "") || !/^\d{4}$/.test(reportLocalHhmm || "")) {
    return null;
  }

  const depMinutes = hhmmToMinutes(depLocalHhmm);
  const reportMinutes = hhmmToMinutes(reportLocalHhmm);
  if (depMinutes == null || reportMinutes == null) {
    return null;
  }

  // If report local appears after departure local, assume sign-on was previous local day.
  const reportLocalDate = reportMinutes > depMinutes ? addDays(depLocalDate, -1) : depLocalDate;
  const depLocalPseudo = parseLocalPseudoDateTime(depLocalDate, depLocalHhmm);
  const reportLocalPseudo = parseLocalPseudoDateTime(reportLocalDate, reportLocalHhmm);
  const localDiffMs = reportLocalPseudo.getTime() - depLocalPseudo.getTime();
  return new Date(depDateTimeUtc.getTime() + localDiffMs);
}

function inferUtcCandidates(localDate, localHhmm, utcHhmm) {
  const localDateTime = parseLocalPseudoDateTime(localDate, localHhmm);
  const shifts = [-1, 0, 1];
  const minOffsetHours = -12;
  const maxOffsetHours = 14;
  const candidates = [];

  for (const shift of shifts) {
    const candidateDate = addDays(localDate, shift);
    const candidateUtc = parseUtcDate(candidateDate, utcHhmm);
    const offsetHours = (localDateTime.getTime() - candidateUtc.getTime()) / 3600000;
    candidates.push({
      utc: candidateUtc,
      offsetHours,
      isOffsetPlausible: offsetHours >= minOffsetHours && offsetHours <= maxOffsetHours,
    });
  }

  return candidates;
}

function inferDepartureUtcDateTime(localDate, localHhmm, utcHhmm, notBeforeUtc = null, referenceOffsetHours = null) {
  const candidates = inferUtcCandidates(localDate, localHhmm, utcHhmm).filter((candidate) => candidate.isOffsetPlausible);
  const pool = candidates.length > 0 ? candidates : inferUtcCandidates(localDate, localHhmm, utcHhmm);

  const sorted = [...pool].sort((a, b) => a.utc - b.utc);
  const notBeforeMatches = notBeforeUtc ? sorted.filter((candidate) => candidate.utc >= notBeforeUtc) : sorted;
  const chronologyPool = notBeforeMatches.length > 0 ? notBeforeMatches : sorted;

  if (referenceOffsetHours != null) {
    chronologyPool.sort((a, b) => {
      const diffA = Math.abs(a.offsetHours - referenceOffsetHours);
      const diffB = Math.abs(b.offsetHours - referenceOffsetHours);
      if (diffA !== diffB) {
        return diffA - diffB;
      }
      return a.utc - b.utc;
    });
    return chronologyPool[0];
  }

  return chronologyPool[0];
}

function inferArrivalUtcDateTime(localDate, localHhmm, utcHhmm, departureUtcDateTime, expectedFlightMinutes = null) {
  const maxFlightDurationMs = 20 * 3600000;
  const candidates = inferUtcCandidates(localDate, localHhmm, utcHhmm)
    .filter((candidate) => candidate.isOffsetPlausible)
    .map((candidate) => ({
      ...candidate,
      durationMs: candidate.utc.getTime() - departureUtcDateTime.getTime(),
    }))
    .filter((candidate) => candidate.durationMs > 0);

  if (candidates.length > 0) {
    if (expectedFlightMinutes != null) {
      const expectedMatchToleranceMinutes = 90;
      const expectedScored = candidates
        .map((candidate) => ({
          ...candidate,
          durationMinutes: candidate.durationMs / 60000,
          expectedDiffMinutes: Math.abs(candidate.durationMs / 60000 - expectedFlightMinutes),
        }))
        .sort((a, b) => {
          if (a.expectedDiffMinutes !== b.expectedDiffMinutes) {
            return a.expectedDiffMinutes - b.expectedDiffMinutes;
          }
          return a.durationMs - b.durationMs;
        });

      if (expectedScored[0].expectedDiffMinutes <= expectedMatchToleranceMinutes) {
        return expectedScored[0];
      }
    }

    const realistic = candidates.filter((candidate) => candidate.durationMs <= maxFlightDurationMs);
    if (realistic.length > 0) {
      realistic.sort((a, b) => a.durationMs - b.durationMs);
      return realistic[0];
    }

    candidates.sort((a, b) => a.durationMs - b.durationMs);
    return candidates[0];
  }

  let fallback = parseUtcDate(localDate, utcHhmm);
  while (fallback <= departureUtcDateTime) {
    fallback = new Date(fallback.getTime() + 86400000);
  }
  return {
    utc: fallback,
    offsetHours: null,
  };
}

function formatUtcForIcs(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function formatFloatingForIcs(date, hhmm) {
  return `${ymdForIcs(date)}T${hhmm}00`;
}

function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLine(line) {
  const max = 75;
  if (line.length <= max) {
    return line;
  }

  const output = [];
  let remaining = line;
  while (remaining.length > max) {
    output.push(remaining.slice(0, max));
    remaining = ` ${remaining.slice(max)}`;
  }

  output.push(remaining);
  return output.join("\r\n");
}

function buildFlightEvents(tripOccurrences, patternMap, bidPeriod) {
  const events = [];

  for (const trip of tripOccurrences) {
    const flights = patternMap.get(trip.patternCode) || [];
    let cursorLocalDate = trip.startDate;
    let previousArrivalUtc = null;
    let previousArrivalOffsetHours = null;

    for (let i = 0; i < flights.length; i += 1) {
      const flight = flights[i];
      const depLocalDate = nextDateForDayCode(cursorLocalDate, flight.depDay);
      const arrLocalDate = nextDateForDayCode(depLocalDate, flight.arrDay);

      const depInference = inferDepartureUtcDateTime(
        depLocalDate,
        flight.depLocal,
        flight.depUtc,
        previousArrivalUtc,
        previousArrivalOffsetHours
      );
      const depDateTimeUtc = depInference.utc;

      const arrInference = inferArrivalUtcDateTime(
        arrLocalDate,
        flight.arrLocal,
        flight.arrUtc,
        depDateTimeUtc,
        flight.flightDurationMinutes
      );
      const arrDateTimeUtc = arrInference.utc;
      const reportStartUtc = deriveReportStartUtc(depLocalDate, flight.depLocal, flight.reportLocal, depDateTimeUtc);

      const summary = `${flight.flightNumber} ${flight.origin}->${flight.destination} (${trip.patternCode})`;
      events.push({
        eventType: "flight",
        uid: `${bidPeriod}-${trip.patternCode}-${isoDate(trip.startDate)}-${flight.flightNumber}-${i}`,
        bidPeriod,
        patternCode: trip.patternCode,
        tripStartIso: isoDate(trip.startDate),
        flightNumber: flight.flightNumber,
        origin: flight.origin,
        destination: flight.destination,
        reportLocal: flight.reportLocal,
        depLocal: flight.depLocal,
        depUtc: flight.depUtc,
        arrLocal: flight.arrLocal,
        arrUtc: flight.arrUtc,
        depDay: flight.depDay,
        arrDay: flight.arrDay,
        scheduledFlightMinutes: flight.flightDurationMinutes,
        scheduledFlightTime: minutesToDurationString(flight.flightDurationMinutes),
        reportStartUtc,
        dtStartUtc: depDateTimeUtc,
        dtEndUtc: arrDateTimeUtc,
        startSort: depDateTimeUtc.getTime(),
        summary,
        previewType: "FLIGHT",
        previewCode: flight.flightNumber,
        previewInfo: `${flight.origin}/${flight.destination} (${trip.patternCode})`,
        previewStart: depDateTimeUtc.toISOString().replace(".000Z", "Z"),
        previewEnd: arrDateTimeUtc.toISOString().replace(".000Z", "Z"),
      });

      cursorLocalDate = arrLocalDate;
      previousArrivalUtc = arrDateTimeUtc;
      previousArrivalOffsetHours = arrInference.offsetHours;
    }
  }

  return events;
}

function buildPatternEvents(tripOccurrences, flightEvents, bidPeriod) {
  const events = [];
  const flightsByTrip = new Map();

  for (const flightEvent of flightEvents) {
    const key = `${flightEvent.patternCode}|${flightEvent.tripStartIso}`;
    if (!flightsByTrip.has(key)) {
      flightsByTrip.set(key, []);
    }
    flightsByTrip.get(key).push(flightEvent);
  }

  for (const occurrence of tripOccurrences) {
    const tripStartIso = isoDate(occurrence.startDate);
    const tripEndIso = isoDate(occurrence.endDate);
    const key = `${occurrence.patternCode}|${tripStartIso}`;
    const sectors = (flightsByTrip.get(key) || []).sort((a, b) => a.dtStartUtc - b.dtStartUtc);
    const sectorLines =
      sectors.length === 0
        ? ["No sector details parsed for this pattern occurrence."]
        : sectors.map(
            (sector) =>
              `${sector.flightNumber} ${sector.origin}/${sector.destination} | ` +
              `Sign on ${sector.reportLocal || "N/A"} | ` +
              `Dep ${sector.depDay} ${sector.depLocal} (${sector.depUtc} UTC) | ` +
              `Arr ${sector.arrDay} ${sector.arrLocal} (${sector.arrUtc} UTC)`
          );

    const summary = `${occurrence.patternCode}`;
    const nextDay = addDays(occurrence.endDate, 1);
    events.push({
      eventType: "pattern",
      timeKind: "all_day",
      uid: `${bidPeriod}-${occurrence.patternCode}-${tripStartIso}-pattern`,
      bidPeriod,
      patternCode: occurrence.patternCode,
      tripStartIso,
      tripEndIso,
      summary,
      detailLines: sectorLines,
      dtStartDate: ymdForIcs(occurrence.startDate),
      dtEndDate: ymdForIcs(nextDay),
      startSort: parseLocalPseudoDateTime(occurrence.startDate, "0000").getTime(),
      previewType: "PATTERN",
      previewCode: occurrence.patternCode,
      previewInfo: `${tripStartIso} to ${tripEndIso}`,
      previewStart: `${tripStartIso} all day`,
      previewEnd: `${isoDate(nextDay)} all day`,
    });
  }

  return events;
}

function identifyTrainingCategory(row) {
  const haystack = `${row.dutyCode || ""} ${row.detail || ""}`.toUpperCase();
  if (haystack.includes("SIM")) {
    return "SIM";
  }

  if (haystack.includes("TRAIN") || haystack.includes("TRG")) {
    return "TRAINING";
  }

  return null;
}

function buildTrainingEvents(scheduleRows, bidPeriod) {
  const events = [];

  for (const row of scheduleRows) {
    const category = identifyTrainingCategory(row);
    if (!category) {
      continue;
    }

    const label = [row.dutyCode, row.detail].filter(Boolean).join(" ");
    const summary = `${category}: ${label}`;
    const uidBase = `${bidPeriod}-${row.dutyCode}-${row.iso}`;

    if (row.rept && row.end) {
      const startLocal = parseLocalPseudoDateTime(row.date, row.rept);
      let endDate = row.date;
      let endLocal = parseLocalPseudoDateTime(endDate, row.end);
      if (endLocal <= startLocal) {
        endDate = addDays(endDate, 1);
        endLocal = parseLocalPseudoDateTime(endDate, row.end);
      }

      events.push({
        eventType: "training",
        timeKind: "floating",
        uid: `${uidBase}-timed`,
        bidPeriod,
        category,
        dutyCode: row.dutyCode,
        detail: row.detail,
        dateIso: row.iso,
        rept: row.rept,
        end: row.end,
        summary,
        dtStartLocal: formatFloatingForIcs(row.date, row.rept),
        dtEndLocal: formatFloatingForIcs(endDate, row.end),
        startSort: startLocal.getTime(),
        previewType: category,
        previewCode: row.dutyCode,
        previewInfo: row.detail || "Roster duty",
        previewStart: `${row.iso} ${row.rept} (local)`,
        previewEnd: `${isoDate(endDate)} ${row.end} (local)`,
      });
      continue;
    }

    const nextDay = addDays(row.date, 1);
    events.push({
      eventType: "training",
      timeKind: "all_day",
      uid: `${uidBase}-allday`,
      bidPeriod,
      category,
      dutyCode: row.dutyCode,
      detail: row.detail,
      dateIso: row.iso,
      summary,
      dtStartDate: ymdForIcs(row.date),
      dtEndDate: ymdForIcs(nextDay),
      startSort: parseLocalPseudoDateTime(row.date, "0000").getTime(),
      previewType: category,
      previewCode: row.dutyCode,
      previewInfo: row.detail || "Roster duty",
      previewStart: `${row.iso} all day`,
      previewEnd: `${isoDate(nextDay)} all day`,
    });
  }

  return events;
}

function buildAXDayEvents(scheduleRows, bidPeriod) {
  const events = [];
  const dutyByIsoDate = new Map(scheduleRows.map((row) => [row.iso, row.dutyCode]));

  for (const row of scheduleRows) {
    if (row.dutyCode !== "A" && row.dutyCode !== "X") {
      continue;
    }

    let title = "A Day";
    if (row.dutyCode === "X") {
      const nextIso = isoDate(addDays(row.date, 1));
      const nextDuty = dutyByIsoDate.get(nextIso);
      const isLastXDay = nextDuty != null && nextDuty !== "X";
      title = isLastXDay ? "Last X Day" : "X Day";
    }

    const nextDay = addDays(row.date, 1);
    events.push({
      eventType: "day_marker",
      timeKind: "all_day",
      uid: `${bidPeriod}-${row.iso}-${row.dutyCode}-day`,
      bidPeriod,
      category: "DAY",
      dutyCode: row.dutyCode,
      title,
      summary: title,
      detail: row.detail,
      dateIso: row.iso,
      dtStartDate: ymdForIcs(row.date),
      dtEndDate: ymdForIcs(nextDay),
      startSort: parseLocalPseudoDateTime(row.date, "0000").getTime(),
      previewType: "DAY",
      previewCode: row.dutyCode,
      previewInfo: title,
      previewStart: `${row.iso} all day`,
      previewEnd: `${isoDate(nextDay)} all day`,
    });
  }

  return events;
}

function buildALDayEvents(scheduleRows, bidPeriod) {
  const events = [];

  for (const row of scheduleRows) {
    if (row.dutyCode !== "AL") {
      continue;
    }

    const nextDay = addDays(row.date, 1);
    events.push({
      eventType: "leave_day",
      timeKind: "all_day",
      uid: `${bidPeriod}-${row.iso}-AL-day`,
      bidPeriod,
      category: "LEAVE",
      dutyCode: row.dutyCode,
      title: "AL",
      summary: "AL",
      detail: row.detail,
      dateIso: row.iso,
      dtStartDate: ymdForIcs(row.date),
      dtEndDate: ymdForIcs(nextDay),
      startSort: parseLocalPseudoDateTime(row.date, "0000").getTime(),
      previewType: "LEAVE",
      previewCode: "AL",
      previewInfo: "Annual Leave",
      previewStart: `${row.iso} all day`,
      previewEnd: `${isoDate(nextDay)} all day`,
    });
  }

  return events;
}

export function parseRosterText(text) {
  const lines = text.split(/\r?\n/);
  const headerDate = parseHeaderDate(text);
  const bpMatch = text.match(/BID PERIOD\s+(\d+)/);
  const bidPeriod = bpMatch ? bpMatch[1] : "Unknown";

  const patternMap = parsePatternBlocks(lines);
  const scheduleRows = parseScheduleRows(lines, headerDate);
  const tripOccurrences = buildTripOccurrences(scheduleRows, patternMap);

  const flightEvents = buildFlightEvents(tripOccurrences, patternMap, bidPeriod);
  const patternEvents = buildPatternEvents(tripOccurrences, flightEvents, bidPeriod);
  const trainingEvents = buildTrainingEvents(scheduleRows, bidPeriod);
  const dayMarkerEvents = buildAXDayEvents(scheduleRows, bidPeriod);
  const leaveEvents = buildALDayEvents(scheduleRows, bidPeriod);
  const events = [...flightEvents, ...patternEvents, ...trainingEvents, ...dayMarkerEvents, ...leaveEvents].sort(
    (a, b) => a.startSort - b.startSort || a.uid.localeCompare(b.uid)
  );

  return {
    bidPeriod,
    generatedAtUtc: new Date(),
    counts: {
      flights: flightEvents.length,
      patterns: patternEvents.length,
      training: trainingEvents.length,
      dayMarkers: dayMarkerEvents.length,
      leaveDays: leaveEvents.length,
      total: events.length,
    },
    events,
  };
}

export function rosterToIcs(parsedRoster, sourceFileName = "roster.txt") {
  const now = formatUtcForIcs(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Roster Export iCal//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldIcsLine(`X-WR-CALNAME:Roster BP${escapeIcsText(parsedRoster.bidPeriod)}`),
  ];

  for (const event of parsedRoster.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(foldIcsLine(`UID:${escapeIcsText(event.uid)}@roster-export-ical`));
    lines.push(`DTSTAMP:${now}`);

    if (event.eventType === "flight") {
      const description = [
        `Bid Period: ${event.bidPeriod}`,
        `Trip: ${event.patternCode}`,
        `Trip Start Date: ${event.tripStartIso}`,
        `Flight: ${event.flightNumber}`,
        `Route: ${event.origin}/${event.destination}`,
        `Report Local: ${event.reportLocal || "N/A"}`,
        `Departure Local: ${event.depDay} ${event.depLocal}`,
        `Departure UTC: ${event.depUtc}`,
        `Arrival Local: ${event.arrDay} ${event.arrLocal}`,
        `Arrival UTC: ${event.arrUtc}`,
        `Scheduled Flight Time: ${event.scheduledFlightTime || "N/A"}`,
        `Source File: ${sourceFileName}`,
      ].join("\n");

      lines.push(`DTSTART:${formatUtcForIcs(event.dtStartUtc)}`);
      lines.push(`DTEND:${formatUtcForIcs(event.dtEndUtc)}`);
      lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(event.summary)}`));
      lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(description)}`));
      lines.push(foldIcsLine(`LOCATION:${escapeIcsText(event.origin + " Airport")}`));
    } else if (event.eventType === "pattern") {
      const description = event.detailLines.join("\n");

      lines.push(`DTSTART;VALUE=DATE:${event.dtStartDate}`);
      lines.push(`DTEND;VALUE=DATE:${event.dtEndDate}`);
      lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(event.summary)}`));
      lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(description)}`));
      lines.push("TRANSP:TRANSPARENT");
    } else if (event.eventType === "training") {
      const description = [
        `Bid Period: ${event.bidPeriod}`,
        `Duty: ${event.dutyCode}`,
        `Category: ${event.category}`,
        `Detail: ${event.detail || "N/A"}`,
        `Date: ${event.dateIso}`,
        `Source File: ${sourceFileName}`,
      ].join("\n");

      if (event.timeKind === "floating") {
        lines.push(`DTSTART:${event.dtStartLocal}`);
        lines.push(`DTEND:${event.dtEndLocal}`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${event.dtStartDate}`);
        lines.push(`DTEND;VALUE=DATE:${event.dtEndDate}`);
      }

      lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(event.summary)}`));
      lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(description)}`));
      lines.push(foldIcsLine(`LOCATION:${escapeIcsText(event.category === "SIM" ? "Simulator" : "Training")}`));
    } else {
      const description = [
        `Bid Period: ${event.bidPeriod}`,
        `Day Type: ${event.dutyCode}`,
        `Date: ${event.dateIso}`,
        `Source File: ${sourceFileName}`,
      ].join("\n");

      lines.push(`DTSTART;VALUE=DATE:${event.dtStartDate}`);
      lines.push(`DTEND;VALUE=DATE:${event.dtEndDate}`);
      lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(event.summary)}`));
      lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(description)}`));
      lines.push("TRANSP:TRANSPARENT");
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
