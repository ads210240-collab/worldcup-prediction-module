import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { getMatchNews, getWorldCupPredictions } from "./src/data/worldcupPredictions.js";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(rootDir, "public");
const preferredPort = Number(process.env.PORT || 5173);
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(file);
  } catch {
    const indexFile = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
    res.end(indexFile);
  }
}

function createAppServer() {
  return createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);

      if (req.method === "GET" && requestUrl.pathname === "/api/worldcup/predictions") {
        sendJson(res, 200, await getWorldCupPredictions());
        return;
      }

      if (req.method === "GET" && requestUrl.pathname === "/api/worldcup/news") {
        sendJson(res, 200, await getMatchNews(requestUrl.searchParams.get("matchId")));
        return;
      }

      await serveStatic(req, res);
    } catch (error) {
      sendJson(res, 500, {
        error: "internal_server_error",
        message: error instanceof Error ? error.message : "Unknown server error",
      });
    }
  });
}

function listen(port, attemptsLeft = 4) {
  const server = createAppServer();

  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }

    throw error;
  });

  server.listen(port, host, () => {
    const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    console.log(`World Cup prediction module running at http://${displayHost}:${port}`);
    console.log(`API route ready: http://${displayHost}:${port}/api/worldcup/predictions`);
  });
}

listen(preferredPort);
