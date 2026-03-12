import { parseRosterText, rosterToIcs } from "./rosterParser.mjs";

const APP_VERSION = "2026-03-13f";

const rosterFileInput = document.getElementById("rosterFile");
const parseBtn = document.getElementById("parseBtn");
const downloadBtn = document.getElementById("downloadBtn");
const shareBtn = document.getElementById("shareBtn");
const openBtn = document.getElementById("openBtn");
const statusEl = document.getElementById("status");
const eventsBody = document.getElementById("eventsBody");

const patternSelect = document.getElementById("patternSelect");
const checkDtaBtn = document.getElementById("checkDtaBtn");
const dtaStatusEl = document.getElementById("dtaStatus");
const dtaSummaryBody = document.getElementById("dtaSummaryBody");
const countryRateTableBody = document.getElementById("countryRateTableBody");
const countryOptions = document.getElementById("countryOptions");
const ratesFileInput = document.getElementById("ratesFile");
const importRatesBtn = document.getElementById("importRatesBtn");
const downloadRatesBtn = document.getElementById("downloadRatesBtn");
const addAirportMapForm = document.getElementById("addAirportMapForm");
const newAirportCodeInput = document.getElementById("newAirportCode");
const newAirportCountryInput = document.getElementById("newAirportCountry");
const newAirportRateInput = document.getElementById("newAirportRate");

const dtaFeatureEnabled =
  !!patternSelect &&
  !!checkDtaBtn &&
  !!dtaStatusEl &&
  !!dtaSummaryBody &&
  !!countryOptions &&
  !!ratesFileInput &&
  !!importRatesBtn &&
  !!downloadRatesBtn &&
  !!addAirportMapForm &&
  !!newAirportCodeInput &&
  !!newAirportCountryInput &&
  !!newAirportRateInput;

let parsedRoster = null;
let currentFileName = null;
let dtaPatterns = [];
let dtaCountryRates = {};
let airportCountryMap = {};
let airportRateOverrides = {};

let dtaModuleReady = false;
let calculateDtaForPattern = () => null;
let getDtaPatterns = () => [];
let loadDtaCountryRates = () => ({});
let saveDtaCountryRates = () => {};
let loadAirportCountryMap = () => ({});
let saveAirportCountryMap = () => {};
let loadAirportRateOverrides = () => ({});
let saveAirportRateOverrides = () => {};
let getHourlyRateForAirport = () => ({ rate: null, source: "missing-airport-map", country: "", costGroup: "" });
let getCountryRateRows = () => [];
let getKnownCountries = () => [];
let normaliseAirportCodeForInput = (value) => String(value || "").trim().toUpperCase();
let canonicaliseCountryNameForInput = (value) => String(value || "").trim();
let defaultFallbackRate = { costGroup: "1", mealRate: 5, incidentalRate: 1.25, hourlyRate: 6.25 };

let pdfJsModulePromise = null;
let xlsxModulePromise = null;

function isMacSafari() {
  const ua = navigator.userAgent || "";
  const vendor = navigator.vendor || "";
  const isMac = /\bMacintosh\b/.test(ua);
  const isSafari = /Safari/.test(ua) && /Apple/.test(vendor) && !/Chrome|CriOS|Edg|OPR|Firefox/.test(ua);
  return isMac && isSafari;
}

function withAirdropHint(message) {
  if (!isMacSafari()) {
    return message;
  }

  return `${message} Tip: AirDrop to iPad from Finder (right-click the .ics file -> Share -> AirDrop).`;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function setDtaStatus(message) {
  if (!dtaFeatureEnabled) {
    return;
  }
  dtaStatusEl.textContent = message;
}

async function initDtaModule() {
  if (!dtaFeatureEnabled) {
    return;
  }

  try {
    const dtaModule = await import("./dta.mjs");
    calculateDtaForPattern = dtaModule.calculateDtaForPattern;
    getDtaPatterns = dtaModule.getDtaPatterns;
    loadDtaCountryRates = dtaModule.loadDtaCountryRates;
    saveDtaCountryRates = dtaModule.saveDtaCountryRates;
    loadAirportCountryMap = dtaModule.loadAirportCountryMap;
    saveAirportCountryMap = dtaModule.saveAirportCountryMap;
    loadAirportRateOverrides = dtaModule.loadAirportRateOverrides;
    saveAirportRateOverrides = dtaModule.saveAirportRateOverrides;
    getHourlyRateForAirport = dtaModule.getHourlyRateForAirport;
    getCountryRateRows = dtaModule.getCountryRateRows;
    getKnownCountries = dtaModule.getKnownCountries;
    normaliseAirportCodeForInput = dtaModule.normaliseAirportCodeForInput;
    canonicaliseCountryNameForInput = dtaModule.canonicaliseCountryNameForInput;
    defaultFallbackRate = dtaModule.DEFAULT_FALLBACK_RATE || defaultFallbackRate;

    dtaCountryRates = loadDtaCountryRates();
    airportCountryMap = loadAirportCountryMap(null, dtaCountryRates);
    airportRateOverrides = loadAirportRateOverrides();

    dtaModuleReady = true;
    renderCountryOptions();
    renderCountryRateTable();
    suggestAirportDetailsForCode();
    setDtaStatus("Parse a roster, then select a pattern.");
  } catch (error) {
    console.error("Failed to load DTA module", error);
    dtaModuleReady = false;
    dtaCountryRates = {};
    airportCountryMap = {};
    dtaPatterns = [];
    resetDtaPatternSelect("DTA module unavailable");
    resetDtaSummary("DTA module unavailable.");
    setDtaStatus("DTA module unavailable. Calendar parse/export still works.");
  }
}

function buildExportPayload() {
  if (!parsedRoster) {
    return null;
  }

  const content = rosterToIcs(parsedRoster, currentFileName || "roster.txt");
  const fileName = `BP${parsedRoster.bidPeriod}_events.ics`;
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  return { content, fileName, blob };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to convert calendar file."));
    reader.readAsDataURL(blob);
  });
}

function isPdfFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return name.endsWith(".pdf") || type === "application/pdf";
}

async function loadPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs");
  }
  return pdfJsModulePromise;
}

async function loadXlsxModule() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
  }
  return xlsxModulePromise;
}

function linesFromPdfTextItems(items) {
  const rowMap = new Map();

  for (const item of items || []) {
    const text = String(item?.str || "").trim();
    if (!text) {
      continue;
    }

    const x = Number(item?.transform?.[4] || 0);
    const y = Number(item?.transform?.[5] || 0);
    const rowKey = String(Math.round(y * 2) / 2);
    if (!rowMap.has(rowKey)) {
      rowMap.set(rowKey, []);
    }
    rowMap.get(rowKey).push({ x, text });
  }

  const rows = [...rowMap.entries()]
    .map(([rowKey, cells]) => ({
      y: Number(rowKey),
      cells: cells.sort((a, b) => a.x - b.x),
    }))
    .sort((a, b) => b.y - a.y)
    .map((row) => row.cells.map((cell) => cell.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return rows.join("\n");
}

async function extractTextFromPdf(file) {
  let pdfjs;
  try {
    pdfjs = await loadPdfJsModule();
  } catch {
    throw new Error("Could not load PDF reader library.");
  }

  const { getDocument, GlobalWorkerOptions } = pdfjs;
  GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    pages.push(linesFromPdfTextItems(content.items));
  }

  return pages.join("\n\n");
}

async function readRosterFileText(file) {
  if (isPdfFile(file)) {
    return extractTextFromPdf(file);
  }

  return file.text();
}

function resetPreview() {
  eventsBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 5;
  cell.textContent = "No data yet.";
  row.appendChild(cell);
  eventsBody.appendChild(row);
}

function resetDtaSummary(message = "No DTA calculation yet.") {
  if (!dtaFeatureEnabled) {
    return;
  }
  dtaSummaryBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 5;
  cell.textContent = message;
  row.appendChild(cell);
  dtaSummaryBody.appendChild(row);
}

function resetDtaPatternSelect(message = "Parse a roster first") {
  if (!dtaFeatureEnabled) {
    return;
  }
  patternSelect.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = message;
  patternSelect.appendChild(option);
  patternSelect.disabled = true;
  checkDtaBtn.disabled = true;
}

function formatMoney(amount) {
  if (amount == null || Number.isNaN(amount)) {
    return "Need mapping";
  }
  return `$${amount.toFixed(2)}`;
}

function formatHours(hours) {
  return Number(hours || 0).toFixed(2);
}

function formatRate(rate, source = "table") {
  if (rate == null || Number.isNaN(rate)) {
    return "Need airport-country mapping";
  }
  if (source === "override") {
    return `$${Number(rate).toFixed(2)}/hr (override)`;
  }
  if (source === "fallback") {
    return `$${Number(rate).toFixed(2)}/hr (default)`;
  }
  return `$${Number(rate).toFixed(2)}/hr`;
}

function formatUtcDateTime(value) {
  if (!(value instanceof Date)) {
    return "-";
  }

  const dd = String(value.getUTCDate()).padStart(2, "0");
  const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(value.getUTCFullYear()).slice(-2);
  const hh = String(value.getUTCHours()).padStart(2, "0");
  const mi = String(value.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${mi} UTC`;
}

function formatTimeBasis(startUtc, endUtc) {
  if (!(startUtc instanceof Date) || !(endUtc instanceof Date)) {
    return "-";
  }

  return `${formatUtcDateTime(startUtc)} to ${formatUtcDateTime(endUtc)}`;
}

function renderCountryOptions() {
  if (!dtaFeatureEnabled) {
    return;
  }

  countryOptions.innerHTML = "";
  for (const country of getKnownCountries(dtaCountryRates)) {
    const option = document.createElement("option");
    option.value = country;
    countryOptions.appendChild(option);
  }
}

function renderCountryRateTable() {
  if (!dtaFeatureEnabled || !countryRateTableBody) {
    return;
  }

  countryRateTableBody.innerHTML = "";
  const rows = getCountryRateRows(dtaCountryRates);

  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "No country rates configured.";
    row.appendChild(cell);
    countryRateTableBody.appendChild(row);
    return;
  }

  for (const details of rows) {
    const row = document.createElement("tr");

    const countryCell = document.createElement("td");
    countryCell.textContent = details.country;

    const groupCell = document.createElement("td");
    groupCell.textContent = details.costGroup || "-";

    const hourlyCell = document.createElement("td");
    hourlyCell.textContent = `$${Number(details.hourlyRate).toFixed(2)}/hr`;

    row.appendChild(countryCell);
    row.appendChild(groupCell);
    row.appendChild(hourlyCell);
    countryRateTableBody.appendChild(row);
  }
}

function populatePatternSelect(patterns) {
  if (!dtaFeatureEnabled) {
    return;
  }
  if (!dtaModuleReady) {
    resetDtaPatternSelect("DTA module unavailable");
    setDtaStatus("DTA module unavailable.");
    resetDtaSummary("DTA module unavailable.");
    return;
  }

  patternSelect.innerHTML = "";
  if (!patterns.length) {
    resetDtaPatternSelect("No patterns found in roster");
    setDtaStatus("No patterns available to calculate DTA.");
    resetDtaSummary("No patterns found in this roster.");
    return;
  }

  const countByCode = new Map();
  for (const pattern of patterns) {
    countByCode.set(pattern.patternCode, (countByCode.get(pattern.patternCode) || 0) + 1);
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select pattern code";
  patternSelect.appendChild(placeholder);

  for (const pattern of patterns) {
    const option = document.createElement("option");
    option.value = pattern.id;
    const hasDuplicates = (countByCode.get(pattern.patternCode) || 0) > 1;
    option.textContent = hasDuplicates ? `${pattern.patternCode} (${pattern.tripStartIso})` : pattern.patternCode;
    patternSelect.appendChild(option);
  }

  patternSelect.disabled = false;
  checkDtaBtn.disabled = false;
  setDtaStatus("Select a pattern code and click Check DTA.");
}

function renderDtaSummary(result) {
  if (!dtaFeatureEnabled) {
    return;
  }

  dtaSummaryBody.innerHTML = "";

  if (!result || result.flightsCount === 0) {
    resetDtaSummary("No flight sectors available for this pattern.");
    return;
  }

  const addRow = (section, timeBasis, rate, hours, amount) => {
    const row = document.createElement("tr");
    const sectionCell = document.createElement("td");
    const timeBasisCell = document.createElement("td");
    const rateCell = document.createElement("td");
    const hoursCell = document.createElement("td");
    const amountCell = document.createElement("td");

    sectionCell.textContent = section;
    timeBasisCell.textContent = timeBasis;
    rateCell.textContent = rate;
    hoursCell.textContent = formatHours(hours);
    amountCell.textContent = formatMoney(amount);

    row.appendChild(sectionCell);
    row.appendChild(timeBasisCell);
    row.appendChild(rateCell);
    row.appendChild(hoursCell);
    row.appendChild(amountCell);
    dtaSummaryBody.appendChild(row);
  };

  for (const segment of result.partA.segments) {
    addRow(
      `Part A ${segment.flightNumber} ${segment.origin}/${segment.destination} @ ${segment.rateAirportCode}`,
      formatTimeBasis(segment.startUtc, segment.endUtc),
      formatRate(segment.rate, segment.rateSource),
      segment.hours,
      segment.amount
    );
  }
  addRow("Part A subtotal", "-", "-", result.partA.totalHours, result.partA.totalAmount);

  for (const segment of result.partB.segments) {
    addRow(
      `Part B layover ${segment.slipPort} @ ${segment.rateAirportCode}`,
      formatTimeBasis(segment.startUtc, segment.endUtc),
      formatRate(segment.rate, segment.rateSource),
      segment.hours,
      segment.amount
    );
  }
  addRow("Part B subtotal", "-", "-", result.partB.totalHours, result.partB.totalAmount);

  addRow("Total DTA", "-", "-", result.partA.totalHours + result.partB.totalHours, result.grandTotal);
}

function getSelectedPattern() {
  if (!dtaFeatureEnabled) {
    return null;
  }
  const selectedId = patternSelect.value;
  if (!selectedId) {
    return null;
  }

  return dtaPatterns.find((pattern) => pattern.id === selectedId) || null;
}

function checkSelectedPatternDta() {
  if (!dtaFeatureEnabled) {
    return;
  }
  if (!dtaModuleReady) {
    setDtaStatus("DTA module unavailable.");
    return;
  }

  const selectedPattern = getSelectedPattern();
  if (!selectedPattern) {
    setDtaStatus("Select a pattern code to check DTA.");
    return;
  }

  const result = calculateDtaForPattern(selectedPattern, dtaCountryRates, airportCountryMap, airportRateOverrides);
  renderDtaSummary(result);

  if (result.missingAirportCodes.length > 0) {
    const missingList = result.missingAirportCodes.join(", ");
    setDtaStatus(
      `Need airport-country mapping for: ${missingList}. Add mapping below (saved for future), then check again.`
    );
    if (!newAirportCodeInput.value) {
      newAirportCodeInput.value = result.missingAirportCodes[0];
      suggestAirportDetailsForCode();
    }
    return;
  }

  const fallbackNote =
    result.fallbackCountriesUsed.length > 0
      ? ` Using default Cost Group 1 rate ($${defaultFallbackRate.hourlyRate.toFixed(2)}/hr) for: ${result.fallbackCountriesUsed.join(
          ", "
        )}.`
      : "";

  setDtaStatus(
    `DTA for ${result.patternCode} (${result.tripStartIso} to ${result.tripEndIso}) is ${formatMoney(
      result.grandTotal
    )}.${fallbackNote}`
  );
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function normaliseHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function buildCountryRatesFromRows(rows) {
  const nextRates = {};

  for (const row of rows) {
    const country = String(
      row.country || row.Country || row.countryname || row.CountryName || row["Country Name"] || ""
    ).trim();
    const costGroup = String(
      row.costgroup || row["Cost Group"] || row.costGroup || row.CostGroup || row.group || ""
    ).trim();
    const mealRaw = row.mealrate ?? row["Meal Rate"] ?? row.mealsrate ?? row["Meals Rate"];
    const incidentalRaw = row.incidentalrate ?? row["Incidental Rate"] ?? row.incidentalsrate ?? row["Incidentals Rate"];

    const mealRate = Number(mealRaw);
    const incidentalRate = Number(incidentalRaw);

    if (!country || !Number.isFinite(mealRate) || mealRate <= 0 || !Number.isFinite(incidentalRate) || incidentalRate <= 0) {
      continue;
    }

    nextRates[country] = {
      costGroup,
      mealRate,
      incidentalRate,
      hourlyRate: mealRate + incidentalRate,
    };
  }

  if (Object.keys(nextRates).length === 0) {
    throw new Error("No valid country rates found in file.");
  }

  return nextRates;
}

function parseCountryRatesFromCsv(csvText) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV needs a header row and at least one data row.");
  }

  const headers = parseCsvLine(lines[0]);
  const headerMap = headers.map((header) => normaliseHeader(header));
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headerMap.length; j += 1) {
      row[headerMap[j]] = values[j] ?? "";
    }
    rows.push(row);
  }

  return buildCountryRatesFromRows(rows);
}

async function parseCountryRatesFromXlsx(file) {
  const xlsxModule = await loadXlsxModule();
  const XLSX = xlsxModule.default || xlsxModule;
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: "array" });

  if (!workbook.SheetNames.length) {
    throw new Error("Workbook has no sheets.");
  }

  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
  const rows = rawRows.map((row) => {
    const normalised = {};
    for (const [key, value] of Object.entries(row)) {
      normalised[normaliseHeader(key)] = value;
    }
    return normalised;
  });

  return buildCountryRatesFromRows(rows);
}

function isCsvFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return name.endsWith(".csv") || type.includes("csv");
}

function isXlsxFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return (
    name.endsWith(".xlsx") ||
    type.includes("spreadsheetml") ||
    type.includes("excel") ||
    type.includes("officedocument")
  );
}

async function importCountryRatesFromFile() {
  if (!dtaFeatureEnabled || !dtaModuleReady) {
    return;
  }

  const file = ratesFileInput.files?.[0];
  if (!file) {
    setDtaStatus("Choose a .xlsx or .csv rates file first.");
    return;
  }

  try {
    let importedRates;
    if (isCsvFile(file)) {
      importedRates = parseCountryRatesFromCsv(await file.text());
    } else if (isXlsxFile(file)) {
      importedRates = await parseCountryRatesFromXlsx(file);
    } else {
      throw new Error("Unsupported rates file type. Use .xlsx or .csv.");
    }

    dtaCountryRates = importedRates;
    saveDtaCountryRates(dtaCountryRates);

    const recanonicalisedMap = {};
    for (const [airportCode, country] of Object.entries(airportCountryMap || {})) {
      recanonicalisedMap[airportCode] = canonicaliseCountryNameForInput(country, dtaCountryRates);
    }
    airportCountryMap = recanonicalisedMap;
    saveAirportCountryMap(airportCountryMap, null, dtaCountryRates);

    renderCountryOptions();
    renderCountryRateTable();
    suggestAirportDetailsForCode();

    setDtaStatus(
      `Imported ${Object.keys(dtaCountryRates).length} country rates and saved for future reference.`
    );

    if (patternSelect.value) {
      checkSelectedPatternDta();
    }
  } catch (error) {
    console.error(error);
    setDtaStatus(`Could not import rates: ${error.message || "invalid file format"}.`);
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCountryRateTable() {
  if (!dtaFeatureEnabled || !dtaModuleReady) {
    return;
  }

  const lines = ["Country,Cost Group,Meal Rate,Incidental Rate,Hourly Rate"];
  for (const row of getCountryRateRows(dtaCountryRates)) {
    lines.push(
      [
        csvEscape(row.country),
        csvEscape(row.costGroup || ""),
        Number(row.mealRate).toFixed(2),
        Number(row.incidentalRate).toFixed(2),
        Number(row.hourlyRate).toFixed(2),
      ].join(",")
    );
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dta_country_rates.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);

  setDtaStatus("Downloaded current country rates table.");
}

function suggestAirportDetailsForCode() {
  if (!dtaFeatureEnabled || !dtaModuleReady) {
    return;
  }

  const airportCode = normaliseAirportCodeForInput(newAirportCodeInput.value);
  newAirportCodeInput.value = airportCode;

  if (!/^[A-Z]{3}$/.test(airportCode)) {
    newAirportCountryInput.value = "";
    newAirportRateInput.value = "";
    return;
  }

  const details = getHourlyRateForAirport(airportCode, dtaCountryRates, airportCountryMap, airportRateOverrides);
  newAirportCountryInput.value = details.country || "";
  if (details.rate == null) {
    newAirportRateInput.value = "";
    return;
  }

  newAirportRateInput.value = Number(details.rate).toFixed(2);
}

function addOrUpdateAirportMapping(event) {
  if (!dtaFeatureEnabled || !dtaModuleReady) {
    return;
  }
  event.preventDefault();

  const airportCode = normaliseAirportCodeForInput(newAirportCodeInput.value);
  if (!/^[A-Z]{3}$/.test(airportCode)) {
    setDtaStatus("Enter a valid 3-letter airport code.");
    return;
  }

  const rawCountry = String(newAirportCountryInput.value || "").trim();
  if (!rawCountry) {
    setDtaStatus("Enter the country for this airport.");
    return;
  }
  const rawRate = String(newAirportRateInput.value || "").trim();
  if (!rawRate) {
    setDtaStatus("Enter a valid hourly rate.");
    return;
  }
  const hourlyRate = Number(rawRate);
  if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
    setDtaStatus("Enter a valid positive hourly rate.");
    return;
  }

  const country = canonicaliseCountryNameForInput(rawCountry, dtaCountryRates);
  airportCountryMap[airportCode] = country;
  saveAirportCountryMap(airportCountryMap, null, dtaCountryRates);

  airportRateOverrides[airportCode] = hourlyRate;
  saveAirportRateOverrides(airportRateOverrides);

  newAirportCodeInput.value = airportCode;
  newAirportCountryInput.value = country;
  newAirportRateInput.value = Number(hourlyRate).toFixed(2);

  setDtaStatus(`Saved ${airportCode}: ${country} at $${Number(hourlyRate).toFixed(2)}/hr for future reference.`);

  if (patternSelect.value) {
    checkSelectedPatternDta();
  }
}

function renderPreview(events) {
  eventsBody.innerHTML = "";

  if (events.length === 0) {
    resetPreview();
    return;
  }

  for (const event of events) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${event.previewType}</td>
      <td>${event.previewCode}</td>
      <td>${event.previewInfo}</td>
      <td>${event.previewStart}</td>
      <td>${event.previewEnd}</td>
    `;

    eventsBody.appendChild(row);
  }
}

async function parseSelectedFile() {
  const file = rosterFileInput.files?.[0];
  if (!file) {
    setStatus("Choose a roster .txt or .pdf file first.");
    return;
  }

  try {
    currentFileName = file.name;
    setStatus(`Parsing ${file.name}...`);
    if (isPdfFile(file)) {
      setStatus("Reading PDF roster...");
    }

    const text = await readRosterFileText(file);
    parsedRoster = parseRosterText(text);

    renderPreview(parsedRoster.events);

    if (dtaFeatureEnabled && dtaModuleReady) {
      dtaPatterns = getDtaPatterns(parsedRoster);
      populatePatternSelect(dtaPatterns);
      resetDtaSummary("Select a pattern and click Check DTA.");
    }

    if (parsedRoster.events.length === 0) {
      if (isPdfFile(file)) {
        setStatus("PDF read complete but no supported roster events were found.");
      } else {
        setStatus("No supported events found. Check the roster layout or file type.");
      }
      downloadBtn.disabled = true;
      shareBtn.disabled = true;
      openBtn.disabled = true;
      if (dtaFeatureEnabled) {
        resetDtaPatternSelect("No patterns found in roster");
        setDtaStatus(dtaModuleReady ? "No patterns available to calculate DTA." : "DTA module unavailable.");
      }
      return;
    }

    setStatus(
      withAirdropHint(
        `Parsed BP${parsedRoster.bidPeriod}: ${parsedRoster.counts.flights} flights + ${parsedRoster.counts.patterns} patterns + ${parsedRoster.counts.training} SIM/training + ${parsedRoster.counts.dayMarkers} A/X days + ${(parsedRoster.counts.leaveDays || 0)} AL days = ${parsedRoster.counts.total} total events.`
      )
    );

    downloadBtn.disabled = false;
    shareBtn.disabled = false;
    openBtn.disabled = false;
  } catch (error) {
    console.error(error);
    if (isPdfFile(file)) {
      setStatus("Failed to read PDF roster. If this persists, export as text and parse that file.");
    } else {
      setStatus("Failed to parse roster file.");
    }

    downloadBtn.disabled = true;
    shareBtn.disabled = true;
    openBtn.disabled = true;

    if (dtaFeatureEnabled) {
      resetDtaPatternSelect("Parse failed");
      resetDtaSummary("No DTA calculation yet.");
      setDtaStatus("Unable to calculate DTA because parsing failed.");
    }
  }
}

window.addEventListener("error", (event) => {
  console.error("Unhandled error", event.error || event.message);
  setStatus("App error occurred. Hard refresh and try again.");
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection", event.reason);
  setStatus("App error occurred. Hard refresh and try again.");
});

function downloadIcs() {
  const payload = buildExportPayload();
  if (!payload) {
    setStatus("Parse a roster first.");
    return;
  }

  const url = URL.createObjectURL(payload.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = payload.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus(withAirdropHint(`Downloaded ${payload.fileName}`));
}

async function openIcsInBrowser() {
  const payload = buildExportPayload();
  if (!payload) {
    setStatus("Parse a roster first.");
    return;
  }

  try {
    const dataUrl = await blobToDataUrl(payload.blob);
    const opened = window.open(dataUrl, "_blank");
    if (!opened) {
      window.location.href = dataUrl;
    }
    setStatus("Opened .ics file. On iPad tap Share, then Calendar or Save to Files.");
  } catch (error) {
    console.error(error);
    downloadIcs();
  }
}

async function shareForIpad() {
  const payload = buildExportPayload();
  if (!payload) {
    setStatus("Parse a roster first.");
    return;
  }

  const shareableTypes = ["text/calendar;charset=utf-8", "text/plain;charset=utf-8"];

  try {
    if (navigator.share) {
      for (const type of shareableTypes) {
        const file = new File([payload.content], payload.fileName, { type });
        if (navigator.canShare && !navigator.canShare({ files: [file] })) {
          continue;
        }

        await navigator.share({
          title: payload.fileName,
          text: "Roster calendar export",
          files: [file],
        });

        setStatus(withAirdropHint("Shared .ics file. On iPad choose Calendar or Save to Files."));
        return;
      }
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("Share cancelled.");
      return;
    }
    console.error(error);
  }

  await openIcsInBrowser();
}

parseBtn.addEventListener("click", parseSelectedFile);
downloadBtn.addEventListener("click", downloadIcs);
shareBtn.addEventListener("click", shareForIpad);
openBtn.addEventListener("click", openIcsInBrowser);

if (dtaFeatureEnabled) {
  checkDtaBtn.addEventListener("click", checkSelectedPatternDta);
  importRatesBtn.addEventListener("click", importCountryRatesFromFile);
  downloadRatesBtn.addEventListener("click", downloadCountryRateTable);
  newAirportCodeInput.addEventListener("input", suggestAirportDetailsForCode);
  addAirportMapForm.addEventListener("submit", addOrUpdateAirportMapping);
}

rosterFileInput.addEventListener("change", () => {
  downloadBtn.disabled = true;
  shareBtn.disabled = true;
  openBtn.disabled = true;
  parsedRoster = null;

  if (dtaFeatureEnabled) {
    dtaPatterns = [];
    resetDtaPatternSelect("Parse a roster first");
    resetDtaSummary("No DTA calculation yet.");
    setDtaStatus('File selected. Click "Parse roster", then choose a pattern.');
  }

  setStatus('File selected. Click "Parse roster".');
});

resetPreview();
setStatus(`Ready (v${APP_VERSION}). Choose a roster file, then click "Parse roster".`);

if (dtaFeatureEnabled) {
  resetDtaPatternSelect("Parse a roster first");
  resetDtaSummary("No DTA calculation yet.");
  setDtaStatus("Parse a roster, then select a pattern.");
  initDtaModule();
}
