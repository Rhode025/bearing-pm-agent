import { v4 as uuidv4 } from "uuid";
import chalk from "chalk";
import { format, parseISO } from "date-fns";
import type {
  DecisionLogEntry,
  LogDecisionInput,
} from "./types.js";
import type { Storage } from "./storage.js";

// ─── Log decision ──────────────────────────────────────────────────────────────

export function logDecision(
  storage: Storage,
  input: LogDecisionInput
): DecisionLogEntry {
  const now = new Date().toISOString();
  const id = uuidv4();

  const entry: DecisionLogEntry = {
    id,
    decision: input.decision,
    rationale: input.rationale ?? "",
    context: input.context ?? "",
    madeBy: input.madeBy ?? "pm",
    affectedTicketIds: input.affectedTicketIds ?? [],
    affectedInitiativeIds: input.affectedInitiativeIds ?? [],
    tags: input.tags ?? [],
    createdAt: now,
    channel: input.channel ?? "cli",
  };

  storage.saveDecision(entry);
  return entry;
}

// ─── List decisions ────────────────────────────────────────────────────────────

export function listDecisions(storage: Storage): DecisionLogEntry[] {
  return storage.listDecisions();
}

// ─── Render decisions ──────────────────────────────────────────────────────────

export function renderDecisions(storage: Storage): string {
  const lines: string[] = [];
  const decisions = storage.listDecisions();

  lines.push(chalk.bold.white("\n  ╔════════════════════════════════════════════╗"));
  lines.push(chalk.bold.white("  ║            DECISION LOG                     ║"));
  lines.push(chalk.bold.white("  ╚════════════════════════════════════════════╝\n"));

  if (decisions.length === 0) {
    lines.push(chalk.dim("  No decisions logged yet.\n"));
    return lines.join("\n");
  }

  for (const d of decisions) {
    let dateStr = d.createdAt;
    try {
      dateStr = format(parseISO(d.createdAt), "MMM d, yyyy h:mm a");
    } catch {
      // keep raw
    }

    lines.push(`  ${chalk.bold.cyan("▸")} ${chalk.bold(d.decision)}`);
    lines.push(`    ${chalk.dim("By:")} ${d.madeBy}  ${chalk.dim("@")} ${chalk.dim(dateStr)}`);

    if (d.rationale) {
      lines.push(`    ${chalk.dim("Rationale:")} ${d.rationale}`);
    }

    if (d.context) {
      lines.push(`    ${chalk.dim("Context:")} ${chalk.italic(d.context)}`);
    }

    if (d.affectedTicketIds.length > 0) {
      lines.push(`    ${chalk.dim("Tickets:")} ${d.affectedTicketIds.join(", ")}`);
    }

    if (d.affectedInitiativeIds.length > 0) {
      lines.push(`    ${chalk.dim("Initiatives:")} ${d.affectedInitiativeIds.join(", ")}`);
    }

    if (d.tags.length > 0) {
      lines.push(`    ${d.tags.map(t => chalk.cyan(`#${t}`)).join(" ")}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}
