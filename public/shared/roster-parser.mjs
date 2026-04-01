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
const EPA_LOCATION_CODES = {
  SY: "Sydney",
  ML: "Melbourne",
  BN: "Brisbane",
  PH: "Perth",
};
const BP_ANCHOR_NUMBER = 358;
const BP_LENGTH_DAYS = 56;
const BP_ANCHOR_START_DATE = new Date(Date.UTC(2023, 9, 9));

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

function parseBidPeriodNumber(text) {
  const match = String(text || "").match(/BID PERIOD\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function deriveBidPeriodStartDate(bidPeriodNumber) {
  if (!Number.isFinite(bidPeriodNumber)) {
    return null;
  }

  return addDays(BP_ANCHOR_START_DATE, (bidPeriodNumber - BP_ANCHOR_NUMBER) * BP_LENGTH_DAYS);
}

function buildDateContext(text) {
  const headerDate = parseHeaderDate(text);
  const bidPeriodNumber = parseBidPeriodNumber(text);
  const bidPeriodStartDate = deriveBidPeriodStartDate(bidPeriodNumber);
  const bidPeriodEndDate = bidPeriodStartDate ? addDays(bidPeriodStartDate, BP_LENGTH_DAYS - 1) : null;

  return {
    headerDate,
    bidPeriodNumber,
    bidPeriodStartDate,
    bidPeriodEndDate,
  };
}

function parseStaffNumber(text) {
  const match = String(text || "").match(/\bStaff\s*No:\s*(\d{4,})\b/i);
  return match ? match[1] : "";
}

function normaliseDate(day, month, dateContext) {
  const context = dateContext || {};
  const anchorDate = context.bidPeriodStartDate || context.headerDate || new Date();
  const anchorYear = anchorDate.getUTCFullYear();
  const maxFutureDays = 120;
  const maxPastDays = 220;
  const candidates = [anchorYear - 1, anchorYear, anchorYear + 1].map((year) => {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    const diffDays = Math.floor((candidate - anchorDate) / 86400000);
    return {
      candidate,
      diffDays,
      inBidPeriodWindow:
        context.bidPeriodStartDate instanceof Date &&
        context.bidPeriodEndDate instanceof Date &&
        candidate >= context.bidPeriodStartDate &&
        candidate <= context.bidPeriodEndDate,
      inPreferredWindow: diffDays >= -maxPastDays && diffDays <= maxFutureDays,
    };
  });

  candidates.sort((left, right) => {
    if (left.inBidPeriodWindow !== right.inBidPeriodWindow) {
      return left.inBidPeriodWindow ? -1 : 1;
    }
    if (left.inPreferredWindow !== right.inPreferredWindow) {
      return left.inPreferredWindow ? -1 : 1;
    }
    const absoluteDiff = Math.abs(left.diffDays) - Math.abs(right.diffDays);
    if (absoluteDiff !== 0) {
      return absoluteDiff;
    }
    if ((left.diffDays <= 0) !== (right.diffDays <= 0)) {
      return left.diffDays <= 0 ? -1 : 1;
    }
    return left.diffDays - right.diffDays;
  });

  return candidates[0].candidate;
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

function parseScheduleSegment(segment, dateContext) {
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

  const date = normaliseDate(day, month, dateContext);
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

function parseScheduleRows(lines, dateContext) {
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
      const parsed = parseScheduleSegment(segment, dateContext);
      if (parsed) {
        rows.push(parsed);
      }
    }
  }

  if (rows.length === 0) {
    for (const line of lines) {
      const segments = splitScheduleLineIntoSegments(line);
      for (const segment of segments) {
        const parsed = parseScheduleSegment(segment, dateContext);
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
  const sectorMatch =
    line.match(/\bPAX\s*([A-Z]{3})\/([A-Z]{3})\b/i) ||
    line.match(/\bPAX([A-Z]{3})\/([A-Z]{3})\b/i) ||
    line.match(/\b([A-Z]{3})\s*PAX\/([A-Z]{3})\b/i) ||
    line.match(/\b([A-Z]{3})PAX\/([A-Z]{3})\b/i) ||
    line.match(/\b([A-Z]{3})\/PAX\s*([A-Z]{3})\b/i) ||
    line.match(/\b([A-Z]{3})\/PAX([A-Z]{3})\b/i) ||
    line.match(/\b([A-Z]{3})\/([A-Z]{3})\b/);
  if (!flightNumberMatch || !sectorMatch) {
    return null;
  }

  const flightNumber = flightNumberMatch[1];
  const markerText = line.slice(flightNumberMatch[0].length, sectorMatch.index).trim();
  const markers = markerText ? markerText.split(/\s+/).filter(Boolean) : [];
  let origin = sectorMatch[1];
  let destination = sectorMatch[2];
  const sectorText = String(sectorMatch[0] || "");
  let isPax = /PAX/i.test(sectorText) || markers.includes("PAX");
  const isRouteCheck = markers.includes("Z");

  // Handle "AAA/PAXBBB" style where destination is captured in group 2.
  if (!isPax && /\/PAX/i.test(sectorText)) {
    isPax = true;
  }
  // Handle "AAAPAX/BBB" style where origin can include trailing PAX before slash.
  if (/PAX\//i.test(sectorText) && /PAX$/i.test(origin)) {
    origin = origin.replace(/PAX$/i, "");
    isPax = true;
  }
  if (/^PAX/i.test(origin)) {
    origin = origin.replace(/^PAX/i, "");
    isPax = true;
  }
  if (/^PAX/i.test(destination)) {
    destination = destination.replace(/^PAX/i, "");
    isPax = true;
  }

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
    isRouteCheck,
    isPax,
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

function extractPatternSummaries(text) {
  const summaries = [];
  const patternRegex =
    /\|\*\s*Pattern:\s*([A-Z0-9]+)\s*\|[\s\S]*?Days Away:\s*(\d+)\s+Minimum Pattern Credit:\s*([0-9:]+)\s+Minimum Daily Credit:\s*([0-9:]+)\s+Applicable Credit:\s*([0-9:]+)/gi;

  let match;
  while ((match = patternRegex.exec(String(text || "")))) {
    summaries.push({
      patternCode: String(match[1] || "").trim().toUpperCase(),
      daysAway: Number(match[2]) || 0,
    });
  }

  return summaries;
}

function buildPatternSummaryLookup(patternSummaries) {
  const lookup = new Map();
  for (const summary of patternSummaries) {
    if (!summary.patternCode || lookup.has(summary.patternCode)) {
      continue;
    }
    lookup.set(summary.patternCode, summary);
  }
  return lookup;
}

function buildTripOccurrences(scheduleRows, patternMap, patternSummaryLookup = new Map()) {
  const patternCodes = new Set(patternMap.keys());
  const occurrences = [];
  let current = null;

  for (const row of scheduleRows) {
    const isPatternDay = patternCodes.has(row.dutyCode);
    const isUplineSickDay = row.dutyCode === "UL";
    if (!isPatternDay) {
      if (current && isUplineSickDay) {
        current.endDate = row.date;
        continue;
      }

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

  if (occurrences.length <= 1) {
    return occurrences;
  }

  const merged = [];
  for (const occurrence of occurrences) {
    const previous = merged[merged.length - 1] || null;
    const summary = patternSummaryLookup.get(occurrence.patternCode) || null;
    const totalSpanDays =
      previous && previous.patternCode === occurrence.patternCode
        ? Math.floor((occurrence.endDate.getTime() - previous.startDate.getTime()) / 86400000) + 1
        : null;
    const previousCanMerge =
      previous &&
      previous.patternCode === occurrence.patternCode &&
      occurrence.startDate.getTime() <= addDays(previous.endDate, 2).getTime() &&
      Number.isFinite(summary?.daysAway) &&
      summary.daysAway > 0 &&
      Number.isFinite(totalSpanDays) &&
      totalSpanDays <= summary.daysAway;

    if (previousCanMerge) {
      if (occurrence.endDate > previous.endDate) {
        previous.endDate = occurrence.endDate;
      }
      continue;
    }

    merged.push({
      patternCode: occurrence.patternCode,
      startDate: occurrence.startDate,
      endDate: occurrence.endDate,
    });
  }

  return merged;
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

      const depLocalTitle = /^\d{4}$/.test(flight.depLocal || "") ? flight.depLocal : "----";
      const arrLocalTitle = /^\d{4}$/.test(flight.arrLocal || "") ? flight.arrLocal : "----";
      const routeTitle = `${flight.isPax ? "PAX " : ""}${flight.origin}/${flight.destination}`;
      const summary = `${flight.flightNumber} ${routeTitle} ${depLocalTitle} ${arrLocalTitle}`;
      events.push({
        eventType: "flight",
        uid: `${bidPeriod}-${trip.patternCode}-${isoDate(trip.startDate)}-${flight.flightNumber}-${i}`,
        bidPeriod,
        patternCode: trip.patternCode,
        tripStartIso: isoDate(trip.startDate),
        flightNumber: flight.flightNumber,
        origin: flight.origin,
        destination: flight.destination,
        isRouteCheck: Boolean(flight.isRouteCheck),
        isPax: Boolean(flight.isPax),
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
        previewInfo: `${flight.isPax ? "PAX " : ""}${flight.origin}/${flight.destination} (${trip.patternCode})`,
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
              `${sector.flightNumber} ${sector.isPax ? "PAX " : ""}${sector.origin}/${sector.destination} | ` +
              `Sign on ${sector.reportLocal || "N/A"} | ` +
              `Dep ${sector.depDay} ${sector.depLocal} (${sector.depUtc} UTC) | ` +
              `Arr ${sector.arrDay} ${sector.arrLocal} (${sector.arrUtc} UTC)`
          );

    const summary = `Pattern ${occurrence.patternCode}`;
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

  if (haystack.includes("EPA")) {
    return "TRAINING";
  }

  if (haystack.includes("TRAIN") || haystack.includes("TRG")) {
    return "TRAINING";
  }

  return null;
}

function parseEpaLocation(row) {
  const haystack = `${row.dutyCode || ""} ${row.detail || ""}`.toUpperCase();
  const match = haystack.match(/\bEPA([A-Z]{2})\b/);
  if (!match) {
    return "";
  }

  return EPA_LOCATION_CODES[match[1]] || "";
}

function parseEpaLocationCode(row) {
  const haystack = `${row.dutyCode || ""} ${row.detail || ""}`.toUpperCase();
  const match = haystack.match(/\bEPA([A-Z]{2})\b/);
  return match ? match[1] : "";
}

function parseSimExercise(row) {
  const haystack = `${row.dutyCode || ""} ${row.detail || ""}`.toUpperCase();
  const match = haystack.match(/\bSIM([A-Z0-9]{4})\b/) || haystack.match(/\bSIM\s+([A-Z0-9]{4})\b/);
  return match ? match[1] : "";
}

function buildTrainingLabel(row) {
  const epaLocationCode = parseEpaLocationCode(row);
  const simExercise = parseSimExercise(row);
  const dutyCodeUpper = String(row.dutyCode || "").toUpperCase();
  const detailUpper = String(row.detail || "").toUpperCase();

  if (dutyCodeUpper.includes("EPA") || detailUpper.includes("EPA")) {
    return epaLocationCode ? `EPs-${epaLocationCode}` : "EPs";
  }

  if (dutyCodeUpper.includes("SIM") || detailUpper.includes("SIM")) {
    return simExercise ? `Ex ${simExercise}` : [row.dutyCode, row.detail].filter(Boolean).join(" ") || "Simulator";
  }

  return [row.dutyCode, row.detail].filter(Boolean).join(" ");
}

function buildTrainingEvents(scheduleRows, bidPeriod) {
  const events = [];

  for (const row of scheduleRows) {
    const category = identifyTrainingCategory(row);
    if (!category) {
      continue;
    }

    const label = buildTrainingLabel(row);
    const location = parseEpaLocation(row);
    const isEmergencyProcedures = String(row.dutyCode || "").toUpperCase().includes("EPA") || String(row.detail || "").toUpperCase().includes("EPA");
    const summary = isEmergencyProcedures ? label : `${category}: ${label}`;
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
        location,
        dateIso: row.iso,
        rept: row.rept,
        end: row.end,
        summary,
        dtStartLocal: formatFloatingForIcs(row.date, row.rept),
        dtEndLocal: formatFloatingForIcs(endDate, row.end),
        startSort: startLocal.getTime(),
        previewType: category,
        previewCode: row.dutyCode,
        previewInfo: label || row.detail || "Roster duty",
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
      location,
      dateIso: row.iso,
      summary,
      dtStartDate: ymdForIcs(row.date),
      dtEndDate: ymdForIcs(nextDay),
      startSort: parseLocalPseudoDateTime(row.date, "0000").getTime(),
      previewType: category,
      previewCode: row.dutyCode,
      previewInfo: label || row.detail || "Roster duty",
      previewStart: `${row.iso} all day`,
      previewEnd: `${isoDate(nextDay)} all day`,
    });
  }

  return events;
}

function buildAXDayEvents(scheduleRows, bidPeriod) {
  const events = [];
  const dutyByIsoDate = new Map(scheduleRows.map((row) => [row.iso, row.dutyCode]));
  const isXLikeDuty = (dutyCode) => dutyCode === "X" || dutyCode === "RX";

  for (const row of scheduleRows) {
    if (row.dutyCode !== "A" && !isXLikeDuty(row.dutyCode)) {
      continue;
    }

    let title = "A Day";
    if (isXLikeDuty(row.dutyCode)) {
      const nextIso = isoDate(addDays(row.date, 1));
      const nextDuty = dutyByIsoDate.get(nextIso);
      const isLastXDay = nextDuty != null && !isXLikeDuty(nextDuty);
      title = row.dutyCode === "RX" ? (isLastXDay ? "Last RX Day" : "RX Day") : (isLastXDay ? "Last X Day" : "X Day");
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

function buildLeaveDayEvents(scheduleRows, bidPeriod) {
  const events = [];
  const leaveTypes = {
    AL: { title: "AL", label: "Annual Leave" },
    GL: { title: "GL", label: "Golden Leave" },
    HL: { title: "HL", label: "High Priority Leave" },
    LSL: { title: "LSL", label: "Long Service Leave" },
    SL: { title: "Sick Leave", label: "Sick Leave" },
  };

  for (const row of scheduleRows) {
    const leaveType = leaveTypes[row.dutyCode];
    if (!leaveType) {
      continue;
    }

    const nextDay = addDays(row.date, 1);
    events.push({
      eventType: "leave_day",
      timeKind: "all_day",
      uid: `${bidPeriod}-${row.iso}-${row.dutyCode}-day`,
      bidPeriod,
      category: "LEAVE",
      dutyCode: row.dutyCode,
      title: leaveType.title,
      summary: leaveType.title,
      detail: row.detail,
      dateIso: row.iso,
      dtStartDate: ymdForIcs(row.date),
      dtEndDate: ymdForIcs(nextDay),
      startSort: parseLocalPseudoDateTime(row.date, "0000").getTime(),
      previewType: "LEAVE",
      previewCode: row.dutyCode,
      previewInfo: leaveType.label,
      previewStart: `${row.iso} all day`,
      previewEnd: `${isoDate(nextDay)} all day`,
    });
  }

  return events;
}

function buildStandbyEvents(scheduleRows, bidPeriod) {
  const events = [];

  for (const row of scheduleRows) {
    if (row.dutyCode !== "SR") {
      continue;
    }

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
        eventType: "standby",
        timeKind: "floating",
        uid: `${uidBase}-timed`,
        bidPeriod,
        category: "STANDBY",
        dutyCode: row.dutyCode,
        detail: row.detail,
        dateIso: row.iso,
        rept: row.rept,
        end: row.end,
        summary: "Standby",
        dtStartLocal: formatFloatingForIcs(row.date, row.rept),
        dtEndLocal: formatFloatingForIcs(endDate, row.end),
        startSort: startLocal.getTime(),
        previewType: "STANDBY",
        previewCode: row.dutyCode,
        previewInfo: row.detail || "Standby",
        previewStart: `${row.iso} ${row.rept} (local)`,
        previewEnd: `${isoDate(endDate)} ${row.end} (local)`,
      });
      continue;
    }

    const nextDay = addDays(row.date, 1);
    events.push({
      eventType: "standby",
      timeKind: "all_day",
      uid: `${uidBase}-allday`,
      bidPeriod,
      category: "STANDBY",
      dutyCode: row.dutyCode,
      detail: row.detail,
      dateIso: row.iso,
      summary: "Standby",
      dtStartDate: ymdForIcs(row.date),
      dtEndDate: ymdForIcs(nextDay),
      startSort: parseLocalPseudoDateTime(row.date, "0000").getTime(),
      previewType: "STANDBY",
      previewCode: row.dutyCode,
      previewInfo: row.detail || "Standby",
      previewStart: `${row.iso} all day`,
      previewEnd: `${isoDate(nextDay)} all day`,
    });
  }

  return events;
}

function isSamePatternOccurrence(a, b) {
  if (!a || !b) {
    return false;
  }

  return (
    String(a.patternCode || "") !== "" &&
    String(a.patternCode || "") === String(b.patternCode || "") &&
    String(a.tripStartIso || "") !== "" &&
    String(a.tripStartIso || "") === String(b.tripStartIso || "")
  );
}

export function parseRosterText(text) {
  const lines = text.split(/\r?\n/);
  const dateContext = buildDateContext(text);
  const bidPeriod = Number.isFinite(dateContext.bidPeriodNumber) ? String(dateContext.bidPeriodNumber) : "Unknown";
  const staffNumber = parseStaffNumber(text);

  const patternMap = parsePatternBlocks(lines);
  const patternSummaryLookup = buildPatternSummaryLookup(extractPatternSummaries(text));
  const scheduleRows = parseScheduleRows(lines, dateContext);
  const tripOccurrences = buildTripOccurrences(scheduleRows, patternMap, patternSummaryLookup);

  const flightEvents = buildFlightEvents(tripOccurrences, patternMap, bidPeriod);
  const patternEvents = buildPatternEvents(tripOccurrences, flightEvents, bidPeriod);
  const trainingEvents = buildTrainingEvents(scheduleRows, bidPeriod);
  const dayMarkerEvents = buildAXDayEvents(scheduleRows, bidPeriod);
  const leaveEvents = buildLeaveDayEvents(scheduleRows, bidPeriod);
  const standbyEvents = buildStandbyEvents(scheduleRows, bidPeriod);
  const events = [...flightEvents, ...patternEvents, ...trainingEvents, ...dayMarkerEvents, ...leaveEvents, ...standbyEvents].sort((a, b) => {
    if (isSamePatternOccurrence(a, b)) {
      if (a.eventType === "pattern" && b.eventType === "flight") {
        return -1;
      }
      if (a.eventType === "flight" && b.eventType === "pattern") {
        return 1;
      }
    }

    return a.startSort - b.startSort || a.uid.localeCompare(b.uid);
  });

  return {
    bidPeriod,
    bidPeriodStartIso:
      dateContext.bidPeriodStartDate instanceof Date ? isoDate(dateContext.bidPeriodStartDate) : "",
    bidPeriodEndIso:
      dateContext.bidPeriodEndDate instanceof Date ? isoDate(dateContext.bidPeriodEndDate) : "",
    staffNumber,
    generatedAtUtc: new Date(),
    counts: {
      flights: flightEvents.length,
      patterns: patternEvents.length,
      training: trainingEvents.length,
      dayMarkers: dayMarkerEvents.length,
      leaveDays: leaveEvents.length,
      standby: standbyEvents.length,
      total: events.length,
    },
    events,
  };
}

function reviveDate(value) {
  if (value instanceof Date) {
    return value;
  }

  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const revived = new Date(text);
  return Number.isNaN(revived.getTime()) ? null : revived;
}

export function rehydrateParsedRoster(rawParsedRoster) {
  if (!rawParsedRoster || typeof rawParsedRoster !== "object") {
    return null;
  }

  const events = Array.isArray(rawParsedRoster.events)
    ? rawParsedRoster.events.map((event) => {
        if (!event || typeof event !== "object") {
          return event;
        }

        const hydrated = { ...event };
        for (const key of ["dtStartUtc", "dtEndUtc", "reportStartUtc"]) {
          if (key in hydrated) {
            const revived = reviveDate(hydrated[key]);
            hydrated[key] = revived || hydrated[key];
          }
        }
        return hydrated;
      })
    : [];

  const generatedAtUtc = reviveDate(rawParsedRoster.generatedAtUtc);

  return {
    ...rawParsedRoster,
    generatedAtUtc: generatedAtUtc || rawParsedRoster.generatedAtUtc,
    events,
  };
}

export function rosterToIcs(parsedRoster, sourceFileName = "roster.txt", options = {}) {
  const now = formatUtcForIcs(new Date());
  const cancelledEvents = Array.isArray(options?.cancelledEvents) ? options.cancelledEvents : [];
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
        `Route: ${event.isPax ? "PAX " : ""}${event.origin}/${event.destination}`,
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
      lines.push(foldIcsLine(`LOCATION:${escapeIcsText(event.location || (event.category === "SIM" ? "Simulator" : "Training"))}`));
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

  for (const event of cancelledEvents) {
    if (!event?.uid) {
      continue;
    }

    lines.push("BEGIN:VEVENT");
    lines.push(foldIcsLine(`UID:${escapeIcsText(event.uid)}@roster-export-ical`));
    lines.push(`DTSTAMP:${now}`);

    if (event.timeKind === "all_day" && /^\d{8}$/.test(event.dtStartDate || "") && /^\d{8}$/.test(event.dtEndDate || "")) {
      lines.push(`DTSTART;VALUE=DATE:${event.dtStartDate}`);
      lines.push(`DTEND;VALUE=DATE:${event.dtEndDate}`);
    } else if (
      event.timeKind === "floating" &&
      /^\d{8}T\d{6}$/.test(event.dtStartLocal || "") &&
      /^\d{8}T\d{6}$/.test(event.dtEndLocal || "")
    ) {
      lines.push(`DTSTART:${event.dtStartLocal}`);
      lines.push(`DTEND:${event.dtEndLocal}`);
    } else {
      const dtStartUtc = new Date(event.dtStartUtc || "");
      const dtEndUtc = new Date(event.dtEndUtc || "");
      if (!Number.isNaN(dtStartUtc.getTime()) && !Number.isNaN(dtEndUtc.getTime())) {
        lines.push(`DTSTART:${formatUtcForIcs(dtStartUtc)}`);
        lines.push(`DTEND:${formatUtcForIcs(dtEndUtc)}`);
      }
    }

    const cancelledSummary = event.summary ? `${event.summary} (Cancelled)` : "Cancelled roster event";
    const description = [
      "Removed because it is not present in the latest roster upload.",
      `Original Type: ${event.eventType || "N/A"}`,
      `Source File: ${sourceFileName}`,
    ].join("\n");

    lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(cancelledSummary)}`));
    lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(description)}`));
    lines.push("STATUS:CANCELLED");
    lines.push("SEQUENCE:1");
    lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
