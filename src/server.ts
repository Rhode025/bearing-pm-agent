import * as http from "http";
import type { Storage } from "./storage.js";
import type { Config } from "./config.js";
import { ingestMessage } from "./message-ingest.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { TwilioAdapter } from "./adapters/twilio.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface JsonBody {
  [key: string]: unknown;
}

// ─── Request body reader ───────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseJson(raw: string): JsonBody | null {
  try {
    const val = JSON.parse(raw);
    return val !== null && typeof val === "object" && !Array.isArray(val)
      ? (val as JsonBody)
      : null;
  } catch {
    return null;
  }
}

function decodeFormBody(body: string): Record<string, string> {
  if (!body) return {};
  const result: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = decodeURIComponent(pair.slice(0, eqIdx).replace(/\+/g, " "));
    const val = decodeURIComponent(pair.slice(eqIdx + 1).replace(/\+/g, " "));
    result[key] = val;
  }
  return result;
}

// ─── Response helpers ──────────────────────────────────────────────────────────

function sendJson(
  res: http.ServerResponse,
  status: number,
  data: unknown
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendTwiml(res: http.ServerResponse, twiml: string): void {
  res.writeHead(200, {
    "Content-Type": "text/xml",
    "Content-Length": Buffer.byteLength(twiml),
  });
  res.end(twiml);
}

function sendError(
  res: http.ServerResponse,
  status: number,
  message: string
): void {
  sendJson(res, status, { error: message });
}

// ─── Secret validation ─────────────────────────────────────────────────────────

function isSecretValid(
  req: http.IncomingMessage,
  webhookSecret: string | undefined
): boolean {
  if (!webhookSecret) return true; // no secret configured — allow all
  const provided = req.headers["x-pm-secret"];
  return provided === webhookSecret;
}

// ─── Ingest result → short text summary ───────────────────────────────────────

function summariseResult(
  result: Awaited<ReturnType<typeof ingestMessage>>
): string {
  const parts: string[] = [];

  if (result.ticketsCreated.length > 0)
    parts.push(`${result.ticketsCreated.length} ticket(s) created`);
  if (result.ticketsUpdated.length > 0)
    parts.push(`${result.ticketsUpdated.length} ticket(s) updated`);
  if (result.calendarItemsCreated.length > 0)
    parts.push(`${result.calendarItemsCreated.length} calendar item(s) created`);
  if (result.calendarItemsUpdated.length > 0)
    parts.push(`${result.calendarItemsUpdated.length} calendar item(s) updated`);
  if (result.initiativesCreated.length > 0)
    parts.push(`${result.initiativesCreated.length} initiative(s) created`);
  if (result.decisionsLogged.length > 0)
    parts.push(`${result.decisionsLogged.length} decision(s) logged`);
  if (result.handoffsCreated.length > 0)
    parts.push(`${result.handoffsCreated.length} handoff(s) queued`);

  if (result.messages.length > 0) {
    return result.messages[0] + (parts.length > 0 ? ` (${parts.join(", ")})` : "");
  }

  if (parts.length > 0) return parts.join(", ");

  return "Message processed. No changes made.";
}

// ─── Route handlers ────────────────────────────────────────────────────────────

async function handleIngest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  storage: Storage,
  config: Config
): Promise<void> {
  const rawBody = await readBody(req);
  const body = parseJson(rawBody);

  if (!body) {
    sendError(res, 400, "Request body must be valid JSON");
    return;
  }

  const text = typeof body["text"] === "string" ? body["text"].trim() : null;
  const sender = typeof body["sender"] === "string" ? body["sender"].trim() : "api-user";

  if (!text) {
    sendError(res, 400, 'Missing required field: "text"');
    return;
  }

  const result = await ingestMessage(text, "api", storage, config);
  sendJson(res, 200, {
    ok: true,
    sender,
    summary: summariseResult(result),
    ticketsCreated: result.ticketsCreated.length,
    ticketsUpdated: result.ticketsUpdated.length,
    calendarItemsCreated: result.calendarItemsCreated.length,
    calendarItemsUpdated: result.calendarItemsUpdated.length,
    initiativesCreated: result.initiativesCreated.length,
    decisionsLogged: result.decisionsLogged.length,
    handoffsCreated: result.handoffsCreated.length,
    messages: result.messages,
    warnings: result.warnings,
  });
}

async function handleTwilioSms(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  storage: Storage,
  config: Config
): Promise<void> {
  const rawBody = await readBody(req);
  const parsed = TwilioAdapter.parseInboundWebhook(rawBody);

  if (!parsed) {
    // Still return valid TwiML so Twilio doesn't flag the webhook as broken
    sendTwiml(res, "<Response></Response>");
    return;
  }

  let replyText: string;
  try {
    const result = await ingestMessage(parsed.text, "twilio", storage, config);
    const summary = summariseResult(result);
    // SMS replies should be short — Twilio single segment is 160 chars
    replyText = TwilioAdapter.truncateForSms(summary, 160);
  } catch (err) {
    console.error("[twilio] ingestMessage error:", err);
    replyText = "Error processing your message. Please try again.";
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(replyText)}</Message></Response>`;
  sendTwiml(res, twiml);
}

async function handleTelegramWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  storage: Storage,
  config: Config
): Promise<void> {
  const rawBody = await readBody(req);
  const body = parseJson(rawBody);

  if (!body) {
    sendJson(res, 200, { ok: true }); // Always 200 to Telegram
    return;
  }

  // Acknowledge immediately — Telegram expects a fast 200
  sendJson(res, 200, { ok: true });

  const message = body["message"] as JsonBody | undefined;
  if (!message) return;

  const text =
    typeof message["text"] === "string" ? message["text"].trim() : null;
  if (!text) return;

  const fromObj = message["from"] as JsonBody | undefined;
  const from =
    typeof fromObj?.["first_name"] === "string"
      ? (fromObj["first_name"] as string)
      : "User";

  const chat = message["chat"] as JsonBody | undefined;
  const chatId =
    chat && (typeof chat["id"] === "number" || typeof chat["id"] === "string")
      ? String(chat["id"])
      : null;

  if (!chatId) return;
  if (!config.telegram) return;

  const telegram = new TelegramAdapter(
    config.telegram.botToken,
    config.telegram.chatId
  );

  try {
    const result = await ingestMessage(text, "telegram", storage, config);
    const reply = summariseResult(result);
    await telegram.sendMessage(reply, chatId);
  } catch (err) {
    console.error("[telegram] webhook processing error:", err);
    try {
      await telegram.sendMessage(
        "Sorry, there was an error processing your message.",
        chatId
      );
    } catch {
      // Best-effort — ignore send errors in error path
    }
  }
}

function handleHealth(res: http.ServerResponse): void {
  sendJson(res, 200, { ok: true, version: "1.0.0" });
}

function handleBoard(
  res: http.ServerResponse,
  storage: Storage
): void {
  const tickets = storage.listTickets();
  const sprints = storage.listSprints();
  const calendarItems = storage.listCalendarItems();
  const initiatives = storage.listInitiatives();
  const decisions = storage.listDecisions();
  const handoffs = storage.listHandoffs();

  sendJson(res, 200, {
    ok: true,
    tickets,
    sprints,
    calendarItems,
    initiatives,
    decisions,
    handoffs,
  });
}

// ─── XML escaping for TwiML ───────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Main router ───────────────────────────────────────────────────────────────

async function routeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  storage: Storage,
  config: Config
): Promise<void> {
  const method = req.method ?? "GET";
  // Strip query string for matching
  const url = (req.url ?? "/").split("?")[0] ?? "/";

  // ── POST routes require secret validation ──────────────────────────────────
  if (method === "POST") {
    if (!isSecretValid(req, config.webhookSecret)) {
      sendError(res, 401, "Unauthorized: missing or invalid x-pm-secret header");
      return;
    }
  }

  try {
    if (method === "GET" && url === "/health") {
      handleHealth(res);
      return;
    }

    if (method === "GET" && url === "/board") {
      handleBoard(res, storage);
      return;
    }

    if (method === "POST" && url === "/ingest") {
      await handleIngest(req, res, storage, config);
      return;
    }

    if (method === "POST" && url === "/twilio/sms") {
      await handleTwilioSms(req, res, storage, config);
      return;
    }

    if (method === "POST" && url === "/telegram/webhook") {
      await handleTelegramWebhook(req, res, storage, config);
      return;
    }

    // 404 for everything else
    sendError(res, 404, `Not found: ${method} ${url}`);
  } catch (err) {
    console.error("[server] Unhandled error in route handler:", err);
    // Avoid writing headers twice if they've already been sent
    if (!res.headersSent) {
      sendError(
        res,
        500,
        err instanceof Error ? err.message : "Internal server error"
      );
    }
  }
}

// ─── Server factory ────────────────────────────────────────────────────────────

export function createServer(storage: Storage, config: Config): http.Server {
  const server = http.createServer((req, res) => {
    routeRequest(req, res, storage, config).catch((err) => {
      console.error("[server] Fatal route error:", err);
      if (!res.headersSent) {
        sendError(res, 500, "Internal server error");
      }
    });
  });

  return server;
}

// ─── Start server with graceful shutdown ───────────────────────────────────────

export function startServer(
  storage: Storage,
  config: Config
): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(storage, config);

    server.on("error", (err) => {
      reject(err);
    });

    server.listen(config.port, () => {
      resolve(server);
    });

    // Graceful shutdown
    const shutdown = (signal: string) => {
      console.log(`\n[server] Received ${signal}. Shutting down gracefully…`);
      server.close(() => {
        console.log("[server] HTTP server closed.");
        storage.close();
        process.exit(0);
      });

      // Force-exit after 10 seconds if connections don't drain
      setTimeout(() => {
        console.error("[server] Forced shutdown after timeout.");
        process.exit(1);
      }, 10_000).unref();
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  });
}
