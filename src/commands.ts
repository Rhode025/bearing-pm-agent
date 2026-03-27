import chalk from "chalk";
import type { Storage } from "./storage.js";
import type { Config } from "./config.js";
import { renderBoard } from "./kanban.js";
import { renderSprintSummary } from "./sprints.js";
import { renderCalendar } from "./editorial-calendar.js";
import { renderDecisions } from "./decision-log.js";
import { renderInitiatives } from "./initiatives.js";
import { generateAgentQueueReport, generateDailySummary } from "./reports.js";
import { ingestMessage, formatIngestResult } from "./message-ingest.js";
import { processQueue } from "./agent-handoff.js";

// ─── Board command ─────────────────────────────────────────────────────────────

export async function commandBoard(storage: Storage): Promise<void> {
  console.log(renderBoard(storage));
}

// ─── Sprint command ────────────────────────────────────────────────────────────

export async function commandSprint(storage: Storage): Promise<void> {
  console.log(renderSprintSummary(storage));
}

// ─── Editorial command ─────────────────────────────────────────────────────────

export async function commandEditorial(storage: Storage): Promise<void> {
  const now = new Date();
  console.log(renderCalendar(storage, { month: now.getMonth() + 1, year: now.getFullYear() }));
}

// ─── Summary command ───────────────────────────────────────────────────────────

export async function commandSummary(storage: Storage): Promise<void> {
  console.log(generateDailySummary(storage));
}

// ─── Decisions command ─────────────────────────────────────────────────────────

export async function commandDecisions(storage: Storage): Promise<void> {
  console.log(renderDecisions(storage));
}

// ─── Route command ─────────────────────────────────────────────────────────────

export async function commandRoute(storage: Storage): Promise<void> {
  console.log(generateAgentQueueReport(storage));
}

// ─── Ingest command ────────────────────────────────────────────────────────────

export async function commandIngest(
  message: string,
  storage: Storage,
  config: Config
): Promise<void> {
  if (!message || message.trim().length === 0) {
    console.log(chalk.yellow('  Usage: npm run ingest -- "your message here"'));
    return;
  }

  console.log(chalk.bold.white(`\n  ┌─ Ingesting message ─────────────────────────────────`));
  console.log(chalk.white(`  │  "${message}"`));
  console.log(chalk.bold.white(`  └─────────────────────────────────────────────────────\n`));

  const result = await ingestMessage(message, "cli", storage, config);
  console.log(formatIngestResult(result));
}

// ─── Demo command ──────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function commandDemo(storage: Storage, config: Config): Promise<void> {
  console.log(chalk.bold.magenta("\n  ╔══════════════════════════════════════════════════╗"));
  console.log(chalk.bold.magenta("  ║       BEARING PM AGENT — DEMO SESSION             ║"));
  console.log(chalk.bold.magenta("  ╚══════════════════════════════════════════════════╝\n"));
  console.log(
    chalk.dim(
      "  This demo runs 8 real messages through the full PM Agent pipeline.\n" +
      "  Each message is parsed, executed, and handed off to the appropriate agent.\n"
    )
  );

  const demoMessages = [
    {
      msg: "Build a better Travel Windows detail page next sprint",
      description: "Create a ticket and assign to the next sprint",
    },
    {
      msg: "Article idea: how to know when a fare drop is actually actionable",
      description: "Create editorial calendar item",
    },
    {
      msg: "Have design review the dashboard and engineering focus on Travel Windows polish this week",
      description: "Assign work to design and engineering agents",
    },
    {
      msg: "We are focusing April on Travel Windows and member onboarding",
      description: "Log initiatives and decision",
    },
    {
      msg: "Put the fare drop article on the calendar for May 14",
      description: "Schedule editorial item with a specific date",
    },
    {
      msg: "Move dashboard review to blocked, Duffel API is unstable",
      description: "Block a ticket and record the blocker",
    },
    {
      msg: "What's in flight right now?",
      description: "Request live board status",
    },
    {
      msg: "Write release notes for the Travel Windows launch and put them on the calendar alongside the blog post",
      description: "Create release notes + schedule alongside blog",
    },
  ];

  for (let i = 0; i < demoMessages.length; i++) {
    const { msg, description } = demoMessages[i]!;
    console.log(
      chalk.bold.white(`\n  ── Message ${i + 1}/${demoMessages.length} ──────────────────────────────────────`)
    );
    console.log(chalk.dim(`  Intent: ${description}`));
    console.log(chalk.cyan(`\n  › "${msg}"\n`));

    const result = await ingestMessage(msg, "cli", storage, config);
    console.log(formatIngestResult(result));

    await sleep(50); // Small delay for readability
  }

  // Final board view
  console.log(chalk.bold.magenta("\n  ╔══════════════════════════════════════════════════╗"));
  console.log(chalk.bold.magenta("  ║           FINAL BOARD STATE                       ║"));
  console.log(chalk.bold.magenta("  ╚══════════════════════════════════════════════════╝\n"));
  console.log(renderBoard(storage));

  // Sprint overview
  console.log(renderSprintSummary(storage));

  // Editorial calendar
  const now = new Date();
  console.log(renderCalendar(storage, { month: now.getMonth() + 1, year: now.getFullYear() }));

  // Decisions
  console.log(renderDecisions(storage));

  // Initiatives
  console.log(renderInitiatives(storage));

  // Agent queues
  console.log(generateAgentQueueReport(storage));

  // Process handoff queue
  console.log(chalk.bold.white("\n  ── Processing Agent Handoff Queue ──\n"));
  processQueue(storage, config);

  console.log(chalk.bold.magenta("\n  ╔══════════════════════════════════════════════════╗"));
  console.log(chalk.bold.magenta("  ║              DEMO COMPLETE                        ║"));
  console.log(chalk.bold.magenta("  ╚══════════════════════════════════════════════════╝\n"));
  console.log(chalk.dim("  Try these commands to explore further:"));
  console.log(chalk.cyan("    npm run board"));
  console.log(chalk.cyan("    npm run sprint"));
  console.log(chalk.cyan("    npm run editorial"));
  console.log(chalk.cyan("    npm run decisions"));
  console.log(chalk.cyan('    npm run ingest -- "your message here"'));
  console.log("");
}
