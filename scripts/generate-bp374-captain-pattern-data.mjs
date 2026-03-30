#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function parseMinutes(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d+):(\d{2})$/);
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function extractPdfText(pdfPath) {
  return execFileSync("/tmp/pdf_text_tool", [pdfPath], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
}

function parseAvailablePatterns(text) {
  const records = [];
  const lineRegex = /^([A-Z0-9]{4,6})\s+([.X1-8 ]+)\s+(MO|TU|WE|TH|FR|SA|SU)\s+(\d+)\s+(\d{4})\s+(\d{4})\s+(\d+:\d{2})$/;

  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("|")) {
      continue;
    }

    for (const segment of line.split("|")) {
      const candidate = segment.trim();
      if (!candidate) {
        continue;
      }
      const match = candidate.match(lineRegex);
      if (!match) {
        continue;
      }
      records.push({
        patternCode: match[1],
        weeksDisplay: match[2].replaceAll(" ", "."),
        depDay: match[3],
        daysAway: Number(match[4]),
        reportLocal: match[5],
        arrivalLocal: match[6],
        applicableDisplay: match[7],
        hasXWeek: match[2].includes("X"),
      });
    }
  }

  return records;
}

function parsePatternHeader(line) {
  const match = line.match(
    /^Pattern:\s+(\S+)\s+INT\s+Base:\s+(\S+)\s+Route Code:\s*(.*?)\s+Weeks:\s*(.*?)\s+Category:\s+(.*?)\s+Days Away:\s+(\d+)\s*$/
  );
  if (!match) {
    return null;
  }

  return {
    patternCode: match[1],
    base: match[2],
    routeCode: match[3].trim(),
    weeksPlanned: match[4].trim(),
    category: match[5].trim(),
    daysAway: Number(match[6]),
  };
}

function parseTotalsLine(line) {
  const match = line.match(
    /MPC:\s+(\d+:\d+)\s+MDC:\s+(\d+:\d+)\s+Applicable Credit:\s+(\d+:\d+)\s+Totals:\s+(\d+:\d+)\s+(\d+:\d+)\s+(\d+:\d+)\s+(\d+:\d+)/
  );
  if (!match) {
    return null;
  }

  return {
    mpcMinutes: parseMinutes(match[1]),
    mdcMinutes: parseMinutes(match[2]),
    applicableMinutes: parseMinutes(match[3]),
    flightMinutes: parseMinutes(match[4]),
    nightMinutes: parseMinutes(match[5]),
    dutyPeriodMinutes: parseMinutes(match[6]),
    adpMinutes: parseMinutes(match[7]),
  };
}

function parseSectorLine(line) {
  if (!/[A-Z]{3}\/[A-Z]{3}/.test(line)) {
    return null;
  }

  const tokens = line.trim().split(/\s+/);
  const routeIndex = tokens.findIndex((token) => /^[A-Z]{3}\/[A-Z]{3}$/.test(token));
  if (routeIndex < 1) {
    return null;
  }

  const service = tokens[0];
  const indicator = routeIndex === 2 ? tokens[1] : "";
  const route = tokens[routeIndex];
  const remainder = tokens.slice(routeIndex + 1);
  const hasReportTime = remainder.length > 0 && !/^(MO|TU|WE|TH|FR|SA|SU)$/.test(remainder[0]);

  let reportLocal = "";
  let depDay = "";
  let depLocal = "";
  let depUtc = "";
  let arrDay = "";
  let arrLocal = "";
  let arrUtc = "";
  let trailing = [];

  if (hasReportTime) {
    [reportLocal, depDay, depLocal, depUtc, arrDay, arrLocal, arrUtc, ...trailing] = remainder;
  } else {
    [depDay, depLocal, depUtc, arrDay, arrLocal, arrUtc, ...trailing] = remainder;
  }

  const trailingText = trailing.join(" ").trim();
  const parenthesizedMatch = trailingText.match(/\(\s*(\d+:\d+)\s*\)/);
  const directTimeText = trailingText.replace(/\(\s*\d+:\d+\s*\)/g, " ").trim();
  const directTimes = [...directTimeText.matchAll(/\d+:\d+/g)].map((match) => parseMinutes(match[0]));
  const samePort = route.split("/")[0] === route.split("/")[1];
  const isPax = indicator === "PAX";
  const isDeadhead = indicator === "PAX" || indicator === "Z";

  let flightMinutes = 0;
  let nightMinutes = 0;
  let dutyMinutes = directTimes.length ? directTimes.at(-1) : 0;
  let deadheadMinutes = 0;

  if (samePort) {
    flightMinutes = 0;
    nightMinutes = 0;
  } else if (isDeadhead) {
    deadheadMinutes = parenthesizedMatch
      ? parseMinutes(parenthesizedMatch[1])
      : directTimes.length >= 2
        ? directTimes.at(-2)
        : 0;
    flightMinutes = 0;
    nightMinutes = 0;
  } else if (directTimes.length >= 4) {
    flightMinutes = directTimes.at(-3);
    nightMinutes = directTimes.at(-2);
  } else if (directTimes.length >= 2) {
    flightMinutes = directTimes.at(-2);
    nightMinutes = 0;
  }

  return {
    service,
    indicator,
    route,
    reportLocal,
    depDay,
    depLocal,
    depUtc,
    arrDay,
    arrLocal,
    arrUtc,
    isPax,
    isDeadhead,
    samePort,
    flightMinutes,
    deadheadMinutes,
    nightMinutes,
    dutyMinutes,
  };
}

function parsePlannedPatterns(text) {
  const lines = text.split(/\r?\n/);
  const patterns = [];
  let current = null;

  function flushCurrent() {
    if (!current?.header || !current?.totals) {
      current = null;
      return;
    }
    patterns.push({
      ...current.header,
      ...current.totals,
      sectors: current.sectors,
    });
    current = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      continue;
    }
    if (line.startsWith("--- PAGE ")) {
      continue;
    }
    if (
      line.startsWith("ARMS ") ||
      line.startsWith("LH FLIGHT CREW PLANNED PATTERNS") ||
      line.startsWith("csPatnBook ") ||
      line.startsWith("23Mar26 To ") ||
      line.startsWith("Report Departure Arrival") ||
      line.startsWith("Service Pax Sectors")
    ) {
      continue;
    }
    if (line.startsWith("Pattern: ")) {
      flushCurrent();
      current = {
        header: parsePatternHeader(line),
        totals: null,
        sectors: [],
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("Elapsed Time:")) {
      current.totals = parseTotalsLine(line);
      continue;
    }
    if (line.startsWith("HOME TRANSPORT")) {
      continue;
    }
    if (/^-{8,}$/.test(line)) {
      continue;
    }

    const sector = parseSectorLine(line);
    if (sector) {
      current.sectors.push(sector);
    }
  }

  flushCurrent();
  return patterns;
}

function createPlaceholderPattern(base, availablePattern) {
  return {
    patternCode: availablePattern.patternCode,
    base,
    routeCode: "",
    weeksPlanned: availablePattern.weeksDisplay.replaceAll(".", " ").trim(),
    category: "CPT-B787",
    daysAway: availablePattern.daysAway,
    containsLhrSector: false,
    applicableMinutes: parseMinutes(availablePattern.applicableDisplay),
    flightMinutes: 0,
    nightMinutes: 0,
    qualifyingNightMinutes: 0,
    deadheadMinutes: 0,
    flightAndDeadheadMinutes: 0,
    mpcMinutes: 0,
    mdcMinutes: 0,
    hasFourPilot: false,
    rawNightDeltaMinutes: 0,
    governedNightDeltaMinutes: 0,
    governedWithNightMinutes: parseMinutes(availablePattern.applicableDisplay),
    governedPercentDifference: 0,
    sectors: [],
    weeksDisplay: availablePattern.weeksDisplay,
    depDay: availablePattern.depDay,
    reportLocal: availablePattern.reportLocal,
    arrivalLocal: availablePattern.arrivalLocal,
    hasXWeek: availablePattern.hasXWeek,
  };
}

function buildAnalysis({ base, plannedPdf, availablePdf, ignoredCodes = [] }) {
  const availablePatterns = parseAvailablePatterns(extractPdfText(availablePdf)).filter(
    (pattern) => !ignoredCodes.includes(pattern.patternCode)
  );
  const plannedPatterns = parsePlannedPatterns(extractPdfText(plannedPdf));
  const plannedByCode = new Map(plannedPatterns.map((pattern) => [pattern.patternCode, pattern]));
  const unmatchedCodes = [];

  const patterns = availablePatterns.map((availablePattern) => {
    const plannedPattern = plannedByCode.get(availablePattern.patternCode);
    if (!plannedPattern) {
      unmatchedCodes.push(availablePattern.patternCode);
      return createPlaceholderPattern(base, availablePattern);
    }

    const containsLhrSector = plannedPattern.sectors.some((sector) => sector.route.includes("LHR"));
    const hasFourPilot = plannedPattern.sectors.some(
      (sector) => !sector.isDeadhead && !sector.samePort && sector.dutyMinutes > 12 * 60
    );

    const qualifyingNightMinutes = hasFourPilot
      ? plannedPattern.sectors.reduce((total, sector) => {
          if (sector.isDeadhead || sector.samePort) {
            return total;
          }
          if (sector.route === "SYD/AKL" || sector.route === "AKL/SYD") {
            return total;
          }
          if (containsLhrSector && (sector.route === "SYD/PER" || sector.route === "PER/SYD")) {
            return total;
          }
          return total + sector.nightMinutes;
        }, 0)
      : 0;

    const rawNightDeltaMinutes = qualifyingNightMinutes / 3;
    const baseComparisonMinutes =
      plannedPattern.flightMinutes + plannedPattern.sectors.reduce((total, sector) => total + sector.deadheadMinutes, 0);
    const governedWithNightMinutes =
      rawNightDeltaMinutes > 0
        ? Math.max(plannedPattern.applicableMinutes, baseComparisonMinutes + rawNightDeltaMinutes)
        : plannedPattern.applicableMinutes;
    const governedNightDeltaMinutes = Math.max(0, governedWithNightMinutes - plannedPattern.applicableMinutes);

    return {
      patternCode: availablePattern.patternCode,
      base,
      routeCode: plannedPattern.routeCode,
      weeksPlanned: plannedPattern.weeksPlanned,
      category: plannedPattern.category,
      daysAway: plannedPattern.daysAway,
      containsLhrSector,
      applicableMinutes: plannedPattern.applicableMinutes,
      flightMinutes: plannedPattern.flightMinutes,
      nightMinutes: plannedPattern.nightMinutes,
      qualifyingNightMinutes,
      deadheadMinutes: plannedPattern.sectors.reduce((total, sector) => total + sector.deadheadMinutes, 0),
      flightAndDeadheadMinutes: plannedPattern.flightMinutes + plannedPattern.sectors.reduce((total, sector) => total + sector.deadheadMinutes, 0),
      mpcMinutes: plannedPattern.mpcMinutes,
      mdcMinutes: plannedPattern.mdcMinutes,
      hasFourPilot,
      rawNightDeltaMinutes,
      governedNightDeltaMinutes,
      governedWithNightMinutes,
      governedPercentDifference: plannedPattern.applicableMinutes > 0 ? (governedNightDeltaMinutes / plannedPattern.applicableMinutes) * 100 : 0,
      sectors: plannedPattern.sectors.map((sector) => ({
        route: sector.route,
        isPax: sector.isPax,
        isDeadhead: sector.isDeadhead,
        duty: sector.dutyMinutes,
        flight: sector.flightMinutes,
        night: sector.nightMinutes,
      })),
      weeksDisplay: availablePattern.weeksDisplay,
      depDay: availablePattern.depDay,
      reportLocal: availablePattern.reportLocal,
      arrivalLocal: availablePattern.arrivalLocal,
      hasXWeek: availablePattern.hasXWeek,
    };
  });

  patterns.sort((left, right) => {
    if (right.governedNightDeltaMinutes !== left.governedNightDeltaMinutes) {
      return right.governedNightDeltaMinutes - left.governedNightDeltaMinutes;
    }
    return left.patternCode.localeCompare(right.patternCode, undefined, { numeric: true });
  });

  const summary = patterns.reduce(
    (totals, pattern) => {
      totals.patternCount += 1;
      if (pattern.hasFourPilot) {
        totals.estimatedFourPilotPatternCount += 1;
      }
      if (pattern.governedNightDeltaMinutes > 0) {
        totals.positiveGovernedPatternCount += 1;
      }
      if (pattern.rawNightDeltaMinutes > 0 && pattern.governedNightDeltaMinutes === 0) {
        totals.zeroedByMinimumCreditCount += 1;
      }
      if (pattern.rawNightDeltaMinutes > pattern.governedNightDeltaMinutes) {
        totals.reducedByMinimumCreditCount += 1;
      }
      totals.applicableMinutes += pattern.applicableMinutes;
      totals.rawNightDeltaMinutes += pattern.rawNightDeltaMinutes;
      totals.governedNightDeltaMinutes += pattern.governedNightDeltaMinutes;
      totals.governedWithNightMinutes += pattern.governedWithNightMinutes;
      return totals;
    },
    {
      patternCount: 0,
      estimatedFourPilotPatternCount: 0,
      positiveGovernedPatternCount: 0,
      zeroedByMinimumCreditCount: 0,
      reducedByMinimumCreditCount: 0,
      applicableMinutes: 0,
      rawNightDeltaMinutes: 0,
      governedNightDeltaMinutes: 0,
      governedWithNightMinutes: 0,
      governedPercentDifference: 0,
    }
  );

  summary.governedPercentDifference =
    summary.applicableMinutes > 0 ? (summary.governedNightDeltaMinutes / summary.applicableMinutes) * 100 : 0;

  return {
    generatedAtUtc: new Date().toISOString(),
    bidPeriod: "374",
    base,
    aircraftType: "B787",
    ignoredCodes,
    sourceFiles: {
      plannedPatternsPdf: plannedPdf,
      availablePatternsPdf: availablePdf,
    },
    assumptions: {
      includedMixedCaptainCategories: true,
      includedXWeeks: true,
      paxNightExcluded: true,
      excludedFourPilotRoutes: [
        "SYD/AKL",
        "AKL/SYD",
        "SYD/PER on LHR patterns",
        "PER/SYD on LHR patterns",
      ],
      fourPilotHeuristic:
        "Pattern treated as 4 pilot when any non-PAX, non-deadhead sector duty exceeds 12:00. If that occurs, qualifying night includes all operating sectors except SYD/AKL and AKL/SYD, plus SYD/PER and PER/SYD on LHR patterns.",
      governedDeltaRule: "Effective delta is governed as max(Applicable Credit, Flight Total + Deadhead Total + qualifying Night/3).",
    },
    summary,
    unmatchedCodes,
    patterns,
  };
}

function main() {
  const [base, plannedPdf, availablePdf, outputJson, ...ignoredCodes] = process.argv.slice(2);
  if (!base || !plannedPdf || !availablePdf || !outputJson) {
    console.error("Usage: node scripts/generate-bp374-captain-pattern-data.mjs <BASE> <plannedPdf> <availablePdf> <outputJson> [ignoredCode...]");
    process.exit(1);
  }

  const analysis = buildAnalysis({ base, plannedPdf, availablePdf, ignoredCodes });
  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputJson}`);
  console.log(
    `${base}: ${analysis.summary.patternCount} patterns, ${analysis.summary.estimatedFourPilotPatternCount} estimated 4 pilot, ${analysis.summary.governedPercentDifference.toFixed(1)}% uplift`
  );
  if (analysis.unmatchedCodes.length) {
    console.log(`Unmatched: ${analysis.unmatchedCodes.join(", ")}`);
  }
}

main();
