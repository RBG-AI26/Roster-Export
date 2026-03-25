import { parseRosterText, rehydrateParsedRoster } from "./shared/roster-parser.mjs";
import {
  calculateDtaForPattern,
  canonicaliseCountryNameForInput,
  DEFAULT_FALLBACK_RATE,
  getCountryRateRows,
  getDtaPatterns,
  getHourlyRateForAirport,
  getKnownCountries,
  loadAirportCountryMap,
  loadAirportRateOverrides,
  loadDtaCountryRates,
  normaliseAirportCodeForInput,
  saveAirportCountryMap,
  saveAirportRateOverrides,
  saveDtaCountryRates,
} from "./dta.mjs";

const APP_VERSION = "2026-03-25c";
const SERVICE_WORKER_URL = "./sw.js?v=20260325c";
const LAST_ROSTER_STORAGE_KEY = "dtaStandalone.lastRoster.v1";
const UI_STATE_STORAGE_KEY = "dtaStandalone.uiState.v1";
const ADMIN_PASSWORD_SESSION_KEY = "dtaStandalone.adminPassword.v1";

const rosterFileInput = document.getElementById("rosterFile");
const parseBtn = document.getElementById("parseBtn");
const adminPasswordInput = document.getElementById("adminPassword");
const staffNumberInput = document.getElementById("staffNumber");
const loadLatestBtn = document.getElementById("loadLatestBtn");
const statusEl = document.getElementById("status");
const sourceDetailsEl = document.getElementById("sourceDetails");
const buildVersionEl = document.getElementById("buildVersion");
const patternsBody = document.getElementById("patternsBody");
const patternSelect = document.getElementById("patternSelect");
const checkDtaBtn = document.getElementById("checkDtaBtn");
const dtaStatusEl = document.getElementById("dtaStatus");
const dtaSummaryBody = document.getElementById("dtaSummaryBody");
const countryOptions = document.getElementById("countryOptions");
const ratesFileInput = document.getElementById("ratesFile");
const importRatesBtn = document.getElementById("importRatesBtn");
const downloadRatesBtn = document.getElementById("downloadRatesBtn");
const addAirportMapForm = document.getElementById("addAirportMapForm");
const newAirportCodeInput = document.getElementById("newAirportCode");
const newAirportCountryInput = document.getElementById("newAirportCountry");
const newAirportRateInput = document.getElementById("newAirportRate");

let parsedRoster = null;
let currentRosterMeta = null;
let dtaPatterns = [];
let dtaCountryRates = loadDtaCountryRates();
let airportCountryMap = loadAirportCountryMap(null, dtaCountryRates);
let airportRateOverrides = loadAirportRateOverrides();
let pdfJsModulePromise = null;
let xlsxModulePromise = null;

if (buildVersionEl) {
  buildVersionEl.textContent = `Build ${APP_VERSION}`;
}

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function setSourceDetails(message) {
  if (sourceDetailsEl) {
    sourceDetailsEl.textContent = message;
  }
}

function setDtaStatus(message) {
  if (dtaStatusEl) {
    dtaStatusEl.textContent = message;
  }
}

function renderSourceDetailsFromMeta() {
  if (!currentRosterMeta) {
    setSourceDetails("No roster loaded yet.");
    return;
  }

  if (currentRosterMeta.source === "manual-file") {
    setSourceDetails(`Loaded from local file: ${currentRosterMeta.fileName || "roster file"}`);
    return;
  }

  const detailParts = [
    "Loaded from backend storage",
    currentRosterMeta.fileName ? `file ${currentRosterMeta.fileName}` : "",
    currentRosterMeta.source ? `source ${currentRosterMeta.source}` : "",
    currentRosterMeta.storedAtUtc ? `stored ${currentRosterMeta.storedAtUtc}` : "",
    currentRosterMeta.senderEmail ? `sender ${currentRosterMeta.senderEmail}` : "",
  ].filter(Boolean);

  setSourceDetails(`${detailParts.join(" | ")}.`);
}

function canRegisterServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return false;
  }

  if (window.isSecureContext) {
    return true;
  }

  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function registerServiceWorker() {
  if (!canRegisterServiceWorker()) {
    return;
  }

  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "./" });
    } catch (error) {
      console.error("Service worker registration failed", error);
    }
  });
}

function getLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function getSessionStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function loadAdminPassword() {
  const storage = getSessionStorage();
  if (!storage) {
    return "";
  }

  try {
    return String(storage.getItem(ADMIN_PASSWORD_SESSION_KEY) || "");
  } catch {
    return "";
  }
}

function saveAdminPassword(value) {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    if (value) {
      storage.setItem(ADMIN_PASSWORD_SESSION_KEY, String(value));
    } else {
      storage.removeItem(ADMIN_PASSWORD_SESSION_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}

function serialiseForStorage(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serialiseForStorage(entry));
  }

  if (value && typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = serialiseForStorage(entry);
    }
    return output;
  }

  return value;
}

function saveUiState() {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      UI_STATE_STORAGE_KEY,
      JSON.stringify({
        selectedPatternId: String(patternSelect?.value || ""),
        staffNumber: String(staffNumberInput?.value || ""),
        airportCode: String(newAirportCodeInput?.value || ""),
        airportCountry: String(newAirportCountryInput?.value || ""),
        airportRate: String(newAirportRateInput?.value || ""),
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

function syncStaffNumberFromParsedRoster() {
  if (!staffNumberInput || !parsedRoster?.staffNumber) {
    return;
  }

  const currentValue = String(staffNumberInput.value || "").trim();
  const parsedStaffNumber = String(parsedRoster.staffNumber || "").trim();
  if (!parsedStaffNumber) {
    return;
  }

  if (!currentValue || currentValue !== parsedStaffNumber) {
    staffNumberInput.value = parsedStaffNumber;
    saveUiState();
  }
}

function loadUiState() {
  const storage = getLocalStorage();
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(UI_STATE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function restoreUiState() {
  const state = loadUiState();
  if (staffNumberInput && state.staffNumber) {
    staffNumberInput.value = String(state.staffNumber);
  }
  if (newAirportCodeInput && state.airportCode) {
    newAirportCodeInput.value = String(state.airportCode);
  }
  if (newAirportCountryInput && state.airportCountry) {
    newAirportCountryInput.value = String(state.airportCountry);
  }
  if (newAirportRateInput && state.airportRate) {
    newAirportRateInput.value = String(state.airportRate);
  }

  return String(state.selectedPatternId || "");
}

function getSavedSelectedPatternId() {
  const state = loadUiState();
  return String(state.selectedPatternId || "");
}

function saveLastRosterState() {
  const storage = getLocalStorage();
  if (!storage || !parsedRoster) {
    return;
  }

  try {
    storage.setItem(
      LAST_ROSTER_STORAGE_KEY,
      JSON.stringify({
        roster: serialiseForStorage(parsedRoster),
        meta: currentRosterMeta,
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

function restoreLastRosterState() {
  const storage = getLocalStorage();
  if (!storage) {
    return false;
  }

  try {
    const raw = storage.getItem(LAST_ROSTER_STORAGE_KEY);
    if (!raw) {
      return false;
    }

    const parsed = JSON.parse(raw);
    const restoredRoster = rehydrateParsedRoster(parsed?.roster);
    if (!restoredRoster?.events?.length) {
      return false;
    }

    parsedRoster = restoredRoster;
    currentRosterMeta = parsed?.meta || null;
    applyRosterToUi({ restoreSelection: true });
    renderSourceDetailsFromMeta();
    setStatus(
      `Restored BP${parsedRoster.bidPeriod} for staff ${parsedRoster.staffNumber || "unknown"}: ${parsedRoster.counts.total} total events.`
    );
    return true;
  } catch {
    return false;
  }
}

function formatHours(hours) {
  return Number(hours || 0).toFixed(2);
}

function formatMoney(amount) {
  if (amount == null || Number.isNaN(amount)) {
    return "Need mapping";
  }
  return `$${amount.toFixed(2)}`;
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

function resetPatternsTable(message = "No roster parsed yet.") {
  patternsBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.textContent = message;
  row.appendChild(cell);
  patternsBody.appendChild(row);
}

function resetDtaSummary(message = "No DTA calculation yet.") {
  dtaSummaryBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 5;
  cell.textContent = message;
  row.appendChild(cell);
  dtaSummaryBody.appendChild(row);
}

function resetDtaPatternSelect(message = "Parse or load a roster first") {
  patternSelect.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = message;
  patternSelect.appendChild(option);
  patternSelect.disabled = true;
  checkDtaBtn.disabled = true;
}

function renderCountryOptions() {
  countryOptions.innerHTML = "";
  for (const country of getKnownCountries(dtaCountryRates)) {
    const option = document.createElement("option");
    option.value = country;
    countryOptions.appendChild(option);
  }
}

function renderPatterns(patterns) {
  patternsBody.innerHTML = "";

  if (!patterns.length) {
    resetPatternsTable("No trips found in this roster.");
    return;
  }

  for (const pattern of patterns) {
    const row = document.createElement("tr");
    const patternCell = document.createElement("td");
    const startCell = document.createElement("td");
    const endCell = document.createElement("td");
    const flightsCell = document.createElement("td");

    patternCell.textContent = pattern.patternCode;
    startCell.textContent = pattern.tripStartIso || "-";
    endCell.textContent = pattern.tripEndIso || "-";
    flightsCell.textContent = pattern.flights.map((flight) => flight.flightNumber).join(", ") || "-";

    row.appendChild(patternCell);
    row.appendChild(startCell);
    row.appendChild(endCell);
    row.appendChild(flightsCell);
    patternsBody.appendChild(row);
  }
}

function populatePatternSelect(patterns, selectedPatternId = "") {
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
  patternSelect.value = patterns.some((pattern) => pattern.id === selectedPatternId) ? selectedPatternId : "";
  setDtaStatus("Select a pattern code and click Check DTA.");
}

function renderDtaSummary(result) {
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
  const selectedId = patternSelect.value;
  if (!selectedId) {
    return null;
  }
  return dtaPatterns.find((pattern) => pattern.id === selectedId) || null;
}

function updateDtaSummaryForSelection() {
  const selectedPattern = getSelectedPattern();
  if (!selectedPattern) {
    setDtaStatus("Select a pattern code to check DTA.");
    saveUiState();
    return;
  }

  const result = calculateDtaForPattern(selectedPattern, dtaCountryRates, airportCountryMap, airportRateOverrides);
  renderDtaSummary(result);

  if (result.missingAirportCodes.length > 0) {
    const missingList = result.missingAirportCodes.join(", ");
    setDtaStatus(`Need airport-country mapping for: ${missingList}. Add mapping below, then check again.`);
    if (!newAirportCodeInput.value) {
      newAirportCodeInput.value = result.missingAirportCodes[0];
      suggestAirportDetailsForCode();
    }
    saveUiState();
    return;
  }

  const fallbackNote =
    result.fallbackCountriesUsed.length > 0
      ? ` Using default Cost Group 1 rate ($${DEFAULT_FALLBACK_RATE.hourlyRate.toFixed(2)}/hr) for: ${result.fallbackCountriesUsed.join(", ")}.`
      : "";

  setDtaStatus(
    `DTA for ${result.patternCode} (${result.tripStartIso} to ${result.tripEndIso}) is ${formatMoney(result.grandTotal)}.${fallbackNote}`
  );
  saveUiState();
}

function applyRosterToUi({ restoreSelection = false } = {}) {
  dtaPatterns = getDtaPatterns(parsedRoster);
  syncStaffNumberFromParsedRoster();
  const selectedPatternId = restoreSelection ? getSavedSelectedPatternId() : String(patternSelect.value || "");

  renderPatterns(dtaPatterns);
  populatePatternSelect(dtaPatterns, selectedPatternId);
  saveLastRosterState();

  if (!dtaPatterns.length) {
    return;
  }

  if (patternSelect.value) {
    updateDtaSummaryForSelection();
  } else {
    resetDtaSummary("Select a pattern and click Check DTA.");
  }
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
      cells: cells.sort((left, right) => left.x - right.x),
    }))
    .sort((left, right) => right.y - left.y)
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

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
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
    suggestAirportDetailsForCode();
    setDtaStatus(`Imported ${Object.keys(dtaCountryRates).length} country rates and saved for future reference.`);

    if (patternSelect.value) {
      updateDtaSummaryForSelection();
    }
  } catch (error) {
    console.error(error);
    setDtaStatus(`Could not import rates: ${error.message || "invalid file format"}.`);
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function downloadCountryRateTable() {
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
  const airportCode = normaliseAirportCodeForInput(newAirportCodeInput.value);
  newAirportCodeInput.value = airportCode;

  if (!/^[A-Z]{3}$/.test(airportCode)) {
    newAirportCountryInput.value = "";
    newAirportRateInput.value = "";
    saveUiState();
    return;
  }

  const details = getHourlyRateForAirport(airportCode, dtaCountryRates, airportCountryMap, airportRateOverrides);
  newAirportCountryInput.value = details.country || "";
  newAirportRateInput.value = details.rate == null ? "" : Number(details.rate).toFixed(2);
  saveUiState();
}

function addOrUpdateAirportMapping(event) {
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
  saveUiState();

  if (patternSelect.value) {
    updateDtaSummaryForSelection();
  }
}

async function parseSelectedFile() {
  const file = rosterFileInput.files?.[0];
  if (!file) {
    setStatus("Choose a roster .txt or .pdf file first.");
    return;
  }

  try {
    setStatus(`Parsing ${file.name}...`);
    if (isPdfFile(file)) {
      setStatus("Reading PDF roster...");
    }

    const text = await readRosterFileText(file);
    parsedRoster = parseRosterText(text);
    currentRosterMeta = {
      source: "manual-file",
      fileName: file.name,
      loadedAtUtc: new Date().toISOString(),
    };

    applyRosterToUi({ restoreSelection: false });

    if (!parsedRoster.events.length) {
      setStatus("Roster read complete, but no supported roster events were found.");
      setSourceDetails(`Source: ${file.name}`);
      resetDtaPatternSelect("No patterns found in roster");
      setDtaStatus("No patterns available to calculate DTA.");
      saveUiState();
      return;
    }

    setStatus(
      `Parsed BP${parsedRoster.bidPeriod} for staff ${parsedRoster.staffNumber || "unknown"}: ${parsedRoster.counts.flights} flights + ${parsedRoster.counts.patterns} patterns + ${parsedRoster.counts.training} SIM/training + ${parsedRoster.counts.dayMarkers} A/X days + ${(parsedRoster.counts.leaveDays || 0)} leave days + ${(parsedRoster.counts.standby || 0)} standby duties = ${parsedRoster.counts.total} total events.`
    );
    renderSourceDetailsFromMeta();
    saveUiState();
  } catch (error) {
    console.error(error);
    setStatus(isPdfFile(file) ? "Failed to read PDF roster. Try a text export if this persists." : "Failed to parse roster file.");
    setSourceDetails("No roster loaded yet.");
    resetPatternsTable("No roster parsed yet.");
    resetDtaPatternSelect("Parse or load a roster first");
    resetDtaSummary("No DTA calculation yet.");
    setDtaStatus("Unable to calculate DTA because parsing failed.");
  }
}

async function loadLatestStoredRoster() {
  const adminPassword = String(adminPasswordInput?.value || "").trim();
  const staffNumber = String(staffNumberInput?.value || "").replace(/\D+/g, "");

  if (!adminPassword) {
    setStatus("Enter the admin password first.");
    return;
  }
  if (staffNumber.length < 4) {
    setStatus("Enter a valid staff number first.");
    return;
  }

  try {
    setStatus(`Loading latest stored roster for staff ${staffNumber}...`);

    const response = await fetch(`./api/admin/rosters/latest?staffNumber=${encodeURIComponent(staffNumber)}`, {
      headers: {
        "x-admin-password": adminPassword,
      },
    });

    if (response.status === 401) {
      saveAdminPassword("");
      throw new Error("Admin password was rejected.");
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || "Could not load stored roster.");
    }

    const rosterRecord = payload?.roster;
    const restoredRoster = rehydrateParsedRoster(rosterRecord?.parsedRoster);
    if (!restoredRoster?.events?.length) {
      throw new Error("Stored roster record was empty.");
    }

    parsedRoster = restoredRoster;
    currentRosterMeta = {
      source: rosterRecord?.source || "stored",
      fileName: rosterRecord?.fileName || "",
      senderEmail: rosterRecord?.senderEmail || "",
      storedAtUtc: rosterRecord?.storedAtUtc || "",
      bidPeriod: rosterRecord?.bidPeriod || "",
      staffNumber: rosterRecord?.staffNumber || "",
    };

    saveAdminPassword(adminPassword);
    applyRosterToUi({ restoreSelection: true });

    setStatus(
      `Loaded stored BP${parsedRoster.bidPeriod} for staff ${parsedRoster.staffNumber || staffNumber}: ${parsedRoster.counts.total} total events.`
    );
    renderSourceDetailsFromMeta();
    saveUiState();
  } catch (error) {
    console.error(error);
    setStatus(error?.message || "Could not load stored roster.");
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

parseBtn.addEventListener("click", parseSelectedFile);
loadLatestBtn.addEventListener("click", loadLatestStoredRoster);
checkDtaBtn.addEventListener("click", updateDtaSummaryForSelection);
patternSelect.addEventListener("change", saveUiState);
importRatesBtn.addEventListener("click", importCountryRatesFromFile);
downloadRatesBtn.addEventListener("click", downloadCountryRateTable);
newAirportCodeInput.addEventListener("input", suggestAirportDetailsForCode);
newAirportCountryInput.addEventListener("input", saveUiState);
newAirportRateInput.addEventListener("input", saveUiState);
staffNumberInput.addEventListener("input", saveUiState);
addAirportMapForm.addEventListener("submit", addOrUpdateAirportMapping);

rosterFileInput.addEventListener("change", () => {
  parsedRoster = null;
  currentRosterMeta = null;
  dtaPatterns = [];
  resetPatternsTable("No roster parsed yet.");
  resetDtaPatternSelect("Parse or load a roster first");
  resetDtaSummary("No DTA calculation yet.");
  setDtaStatus('File selected. Click "Parse roster".');
  setStatus('File selected. Click "Parse roster".');
  setSourceDetails("No roster loaded yet.");
});

registerServiceWorker();
renderCountryOptions();
resetPatternsTable();
resetDtaPatternSelect("Parse or load a roster first");
resetDtaSummary("No DTA calculation yet.");
setDtaStatus("Parse or load a roster, then select a pattern.");

const restoredAdminPassword = loadAdminPassword();
if (restoredAdminPassword) {
  adminPasswordInput.value = restoredAdminPassword;
}

restoreUiState();
if (!restoreLastRosterState()) {
  setStatus(`Ready (v${APP_VERSION}). Choose a roster file or load the latest stored roster.`);
  setSourceDetails("No roster loaded yet.");
}
