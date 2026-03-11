import { parseRosterText, rosterToIcs } from "./rosterParser.mjs";

const APP_VERSION = "2026-03-11h";

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
const rateTableBody = document.getElementById("rateTableBody");
const saveRatesBtn = document.getElementById("saveRatesBtn");
const addRateForm = document.getElementById("addRateForm");
const newRatePortInput = document.getElementById("newRatePort");
const newRateValueInput = document.getElementById("newRateValue");
const dtaFeatureEnabled =
  !!patternSelect &&
  !!checkDtaBtn &&
  !!dtaStatusEl &&
  !!dtaSummaryBody &&
  !!rateTableBody &&
  !!saveRatesBtn &&
  !!addRateForm &&
  !!newRatePortInput &&
  !!newRateValueInput;

let parsedRoster = null;
let currentFileName = null;
let dtaPatterns = [];
let dtaRates = {};
let dtaModuleReady = false;
let calculateDtaForPattern = () => null;
let getDtaPatterns = () => [];
let loadDtaRates = () => ({});
let saveDtaRates = () => {};
let pdfJsModulePromise = null;

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
    loadDtaRates = dtaModule.loadDtaRates;
    saveDtaRates = dtaModule.saveDtaRates;
    dtaRates = loadDtaRates();
    dtaModuleReady = true;
    renderRateTable();
    setDtaStatus("Parse a roster, then select a pattern.");
  } catch (error) {
    console.error("Failed to load DTA module", error);
    dtaModuleReady = false;
    dtaRates = {};
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
  } catch (error) {
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
    return "Missing rate";
  }
  return `$${amount.toFixed(2)}`;
}

function formatHours(hours) {
  return Number(hours || 0).toFixed(2);
}

function formatRate(rate) {
  if (rate == null || Number.isNaN(rate)) {
    return "Missing rate";
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

function renderRateTable() {
  if (!dtaFeatureEnabled) {
    return;
  }
  rateTableBody.innerHTML = "";
  const portCodes = Object.keys(dtaRates).sort();

  if (portCodes.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 2;
    cell.textContent = "No rates configured.";
    row.appendChild(cell);
    rateTableBody.appendChild(row);
    return;
  }

  for (const portCode of portCodes) {
    const row = document.createElement("tr");

    const portCell = document.createElement("td");
    portCell.textContent = portCode;

    const rateCell = document.createElement("td");
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "0.01";
    input.dataset.port = portCode;
    input.value = Number(dtaRates[portCode]).toFixed(2);
    rateCell.appendChild(input);

    row.appendChild(portCell);
    row.appendChild(rateCell);
    rateTableBody.appendChild(row);
  }
}

function readRatesFromTable() {
  if (!dtaFeatureEnabled) {
    return { nextRates: dtaRates, invalidPorts: [] };
  }
  const nextRates = {};
  const invalidPorts = [];
  const inputs = rateTableBody.querySelectorAll("input[data-port]");

  for (const input of inputs) {
    const portCode = String(input.dataset.port || "").trim().toUpperCase();
    const rate = Number(input.value);
    if (!portCode || !Number.isFinite(rate) || rate <= 0) {
      invalidPorts.push(portCode || "(unknown)");
      continue;
    }
    nextRates[portCode] = rate;
  }

  return { nextRates, invalidPorts };
}

function saveRateTable() {
  if (!dtaModuleReady) {
    setDtaStatus("DTA module unavailable.");
    return;
  }

  const { nextRates, invalidPorts } = readRatesFromTable();
  if (invalidPorts.length > 0) {
    setDtaStatus(`Invalid rate value for: ${invalidPorts.join(", ")}.`);
    return;
  }

  dtaRates = nextRates;
  saveDtaRates(dtaRates);
  renderRateTable();
  setDtaStatus("DTA rates saved for future reference.");

  if (patternSelect.value) {
    checkSelectedPatternDta();
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
      `Part A ${segment.flightNumber} ${segment.origin}/${segment.destination} @ ${segment.ratePort}`,
      formatTimeBasis(segment.startUtc, segment.endUtc),
      formatRate(segment.rate),
      segment.hours,
      segment.amount
    );
  }
  addRow("Part A subtotal", "-", "-", result.partA.totalHours, result.partA.totalAmount);

  for (const segment of result.partB.segments) {
    addRow(
      `Part B layover ${segment.slipPort} @ ${segment.ratePort}`,
      formatTimeBasis(segment.startUtc, segment.endUtc),
      formatRate(segment.rate),
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

  const result = calculateDtaForPattern(selectedPattern, dtaRates);
  renderDtaSummary(result);

  if (result.missingPorts.length > 0) {
    const missingList = result.missingPorts.join(", ");
    setDtaStatus(`Missing DTA rate for: ${missingList}. Add the rate and save, then check again.`);
    if (!newRatePortInput.value) {
      newRatePortInput.value = result.missingPorts[0];
    }
    return;
  }

  setDtaStatus(
    `DTA for ${result.patternCode} (${result.tripStartIso} to ${result.tripEndIso}) is ${formatMoney(result.grandTotal)}.`
  );
}

function handleAddOrUpdateRate(event) {
  if (!dtaFeatureEnabled) {
    return;
  }
  if (!dtaModuleReady) {
    setDtaStatus("DTA module unavailable.");
    return;
  }
  event.preventDefault();

  const portCode = String(newRatePortInput.value || "")
    .trim()
    .toUpperCase();
  const rate = Number(newRateValueInput.value);

  if (!/^[A-Z]{3}$/.test(portCode)) {
    setDtaStatus("Enter a valid 3-letter port code.");
    return;
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    setDtaStatus("Enter a valid positive hourly rate.");
    return;
  }

  dtaRates[portCode] = rate;
  saveDtaRates(dtaRates);
  renderRateTable();

  newRatePortInput.value = "";
  newRateValueInput.value = "";
  setDtaStatus(`Saved rate for ${portCode}.`);

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
  saveRatesBtn.addEventListener("click", saveRateTable);
  addRateForm.addEventListener("submit", handleAddOrUpdateRate);
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
