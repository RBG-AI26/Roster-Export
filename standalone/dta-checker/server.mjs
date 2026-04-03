import { createServer } from "node:http";
import { readFile, stat, writeFile, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 8125);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function extractPdfTextWithSwift(filePath) {
  const script = `
import Foundation
import PDFKit

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
guard let pdf = PDFDocument(url: url) else {
  fputs("NO_PDF\\n", stderr)
  exit(2)
}

for pageIndex in 0..<pdf.pageCount {
  if let page = pdf.page(at: pageIndex), let text = page.string {
    print(text)
    if pageIndex < pdf.pageCount - 1 {
      print("")
    }
  }
}
`;

  return new Promise((resolve, reject) => {
    const child = spawn("swift", ["-e", script, filePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `swift exited with code ${code}`));
    });
  });
}

async function handlePdfExtraction(request, response) {
  try {
    const body = await readRequestBody(request);
    if (!body.length) {
      sendJson(response, 400, { error: "Empty PDF upload." });
      return;
    }

    const tempPath = path.join(os.tmpdir(), `dta-meal-docket-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
    await writeFile(tempPath, body);
    try {
      const text = await extractPdfTextWithSwift(tempPath);
      sendJson(response, 200, { text });
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  } catch (error) {
    sendJson(response, 500, { error: error?.message || "Could not extract PDF text." });
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  let relativePath = decodeURIComponent(url.pathname);
  if (relativePath === "/") {
    relativePath = "/index.html";
  }

  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(publicDir, safePath);

  if (!absolutePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const fileInfo = await stat(absolutePath);
    const targetPath = fileInfo.isDirectory() ? path.join(absolutePath, "index.html") : absolutePath;
    const ext = path.extname(targetPath).toLowerCase();
    response.writeHead(200, { "Content-Type": contentTypes.get(ext) || "application/octet-stream" });
    createReadStream(targetPath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/extract-meal-docket-pdf") {
    await handlePdfExtraction(request, response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    await serveStatic(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

server.listen(port, () => {
  console.log(`DTA Checker running at http://localhost:${port}`);
});
