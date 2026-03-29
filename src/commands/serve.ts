import chalk from "chalk";
import type { Storage } from "../storage.js";
import type { Config } from "../config.js";
import { startServer } from "../server.js";
import { TelegramAdapter } from "../adapters/telegram.js";
import { ingestMessage } from "../message-ingest.js";
import { claudePMChat, type ConversationMessage } from "../claude-pm.js";

// ─── Startup banner ────────────────────────────────────────────────────────────

function printBanner(config: Config, args: string[]): void {
  const usePolling = args.includes("--polling");
  const useWebhook = args.includes("--webhook");
  const webhookUrl = process.env["TELEGRAM_WEBHOOK_URL"];

  console.log(chalk.bold.cyan("\n  ╔══════════════════════════════════════════════════╗"));
  console.log(chalk.bold.cyan("  ║        BEARING PM Agent — HTTP Server             ║"));
  console.log(chalk.bold.cyan("  ╚══════════════════════════════════════════════════╝\n"));

  console.log(chalk.bold("  Server configuration:"));
  console.log(`    ${chalk.cyan("Port")}          ${config.port}`);
  console.log(
    `    ${chalk.cyan("Webhook secret")} ${
      config.webhookSecret ? chalk.green("configured") : chalk.dim("not set (open)")
    }`
  );

  console.log(chalk.bold("\n  Adapters:"));

  // Twilio
  if (config.twilio) {
    console.log(
      `    ${chalk.green("✓")} Twilio SMS   from ${config.twilio.fromNumber}`
    );
    console.log(
      `      ${chalk.dim("Endpoint:")} POST /twilio/sms`
    );
  } else {
    console.log(`    ${chalk.dim("○")} Twilio SMS   ${chalk.dim("(not configured)")}`);
  }

  // Telegram
  if (config.telegram) {
    if (usePolling) {
      console.log(
        `    ${chalk.green("✓")} Telegram     ${chalk.yellow("polling mode")} (chat ${config.telegram.chatId})`
      );
    } else if (useWebhook && webhookUrl) {
      console.log(
        `    ${chalk.green("✓")} Telegram     webhook → ${webhookUrl}`
      );
      console.log(
        `      ${chalk.dim("Endpoint:")} POST /telegram/webhook`
      );
    } else {
      console.log(
        `    ${chalk.yellow("~")} Telegram     ${chalk.dim("configured but neither --polling nor --webhook+URL set")}`
      );
      console.log(
        `      ${chalk.dim("Endpoint:")} POST /telegram/webhook`
      );
    }
  } else {
    console.log(`    ${chalk.dim("○")} Telegram    ${chalk.dim("(not configured)")}`);
  }

  console.log(chalk.bold("\n  API routes:"));
  console.log(`    ${chalk.cyan("GET  /health")}          → liveness check`);
  console.log(`    ${chalk.cyan("GET  /board")}           → board data JSON`);
  console.log(`    ${chalk.cyan("POST /ingest")}          → raw message ingestion`);
  console.log(`    ${chalk.cyan("POST /twilio/sms")}      → Twilio TwiML webhook`);
  console.log(`    ${chalk.cyan("POST /telegram/webhook")} → Telegram bot webhook`);
  console.log("");
}

// ─── Conversation history (in-memory, keyed by chat_id) ──────────────────────

const conversationHistories = new Map<string, ConversationMessage[]>();
const MAX_HISTORY = 10; // keep last 10 turns

// ─── commandServe ──────────────────────────────────────────────────────────────

export async function commandServe(
  storage: Storage,
  config: Config,
  args: string[]
): Promise<void> {
  const usePolling = args.includes("--polling");
  const useWebhook = args.includes("--webhook");
  const webhookUrl = process.env["TELEGRAM_WEBHOOK_URL"];

  printBanner(config, args);

  // Start HTTP server
  const server = await startServer(storage, config);
  console.log(
    chalk.bold.green(`  HTTP server listening on port ${config.port}\n`)
  );

  // ── Telegram setup ──────────────────────────────────────────────────────────
  if (config.telegram) {
    const telegram = new TelegramAdapter(
      config.telegram.botToken,
      config.telegram.chatId
    );

    if (useWebhook && webhookUrl) {
      // Register webhook with Telegram
      try {
        await telegram.registerWebhook(webhookUrl);
        console.log(
          chalk.green(`  [telegram] Webhook registered: ${webhookUrl}`)
        );
      } catch (err) {
        console.error(
          chalk.red(
            `  [telegram] Failed to register webhook: ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        );
      }
    }

    if (usePolling) {
      console.log(chalk.cyan("  [telegram] Starting long-poll loop…\n"));

      // startPolling runs forever (until stopPolling is called or process exits).
      // We intentionally do NOT await it here — we want it to run in the background
      // alongside the HTTP server.
      telegram
        .startPolling(async (text: string, from: string, chatId: string) => {
          console.log(chalk.dim(`  [telegram] Message from ${from} (${chatId}): ${text.slice(0, 80)}`));
          try {
            // If Claude is available, use it
            if (config.anthropicApiKey) {
              const history = conversationHistories.get(chatId) ?? [];
              const { reply, toolsExecuted } = await claudePMChat(text, storage, config, history);

              // Update history
              history.push({ role: "user", content: text });
              history.push({ role: "assistant", content: reply });
              if (history.length > MAX_HISTORY * 2) history.splice(0, 2); // trim oldest
              conversationHistories.set(chatId, history);

              if (toolsExecuted.length > 0) {
                console.log(chalk.dim(`  [telegram] Tools executed: ${toolsExecuted.join(", ")}`));
              }
              return reply;
            }

            // Fallback to rule-based parser
            const result = await ingestMessage(text, "telegram", storage, config);

            // Build a Telegram-friendly reply (can be longer than SMS)
            const parts: string[] = [];
            for (const msg of result.messages.slice(0, 8)) {
              parts.push(`• ${msg}`);
            }
            for (const warn of result.warnings.slice(0, 3)) {
              parts.push(`⚠ ${warn}`);
            }

            if (parts.length === 0) {
              // Show what we received and offer usage hints
              const lower = text.toLowerCase();
              if (lower === "/start" || lower === "start" || lower === "hi" || lower === "hello" || lower === "hey") {
                parts.push("👋 BEARING PM Agent ready.");
                parts.push("");
                parts.push("Send me work instructions like:");
                parts.push("• \"Build a settings page next sprint\"");
                parts.push("• \"Article idea: why ski timing matters\"");
                parts.push("• \"Have design review the dashboard\"");
                parts.push("• \"What's in flight right now?\"");
                parts.push("• \"Move the dashboard ticket to blocked\"");
              } else {
                parts.push(`I received: "${text.slice(0, 80)}"`);
                parts.push("");
                parts.push("I wasn't sure what to do with that. Try:");
                parts.push("• Start with \"build\", \"create\", \"improve\", \"fix\", \"add\"");
                parts.push("• \"Article idea: ...\" for content");
                parts.push("• \"What's in flight?\" for board status");
                parts.push("• \"Move X to blocked\" to update status");
              }
            }

            const counts: string[] = [];
            if (result.ticketsCreated.length > 0)
              counts.push(`${result.ticketsCreated.length} ticket(s) created`);
            if (result.ticketsUpdated.length > 0)
              counts.push(`${result.ticketsUpdated.length} ticket(s) updated`);
            if (result.calendarItemsCreated.length > 0)
              counts.push(`${result.calendarItemsCreated.length} calendar item(s)`);
            if (result.decisionsLogged.length > 0)
              counts.push(`${result.decisionsLogged.length} decision(s) logged`);

            if (counts.length > 0) {
              parts.push(`\n✅ ${counts.join(", ")}`);
            }

            return parts.join("\n");
          } catch (err) {
            console.error("[telegram] poll handler error:", err);
            return "Error processing your message. Please try again.";
          }
        })
        .catch((err) => {
          console.error(
            chalk.red(
              `  [telegram] Polling crashed: ${
                err instanceof Error ? err.message : String(err)
              }`
            )
          );
        });
    }
  }

  // Print final status
  console.log(chalk.dim("  Press Ctrl+C to stop.\n"));

  // Keep the process alive. The HTTP server already keeps Node running,
  // but this makes the intent explicit and prevents early exit in edge cases.
  await new Promise<void>(() => {
    // Resolved only by process termination signals handled in startServer
  });
}
