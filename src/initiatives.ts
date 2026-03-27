import { v4 as uuidv4 } from "uuid";
import chalk from "chalk";
import type {
  Initiative,
  CreateInitiativeInput,
} from "./types.js";
import type { Storage } from "./storage.js";

// ─── Create initiative ─────────────────────────────────────────────────────────

export function createInitiative(
  storage: Storage,
  input: CreateInitiativeInput
): Initiative {
  const now = new Date().toISOString();
  const id = uuidv4();

  const initiative: Initiative = {
    id,
    name: input.name,
    description: input.description ?? "",
    status: "active",
    startDate: input.startDate ?? null,
    targetDate: input.targetDate ?? null,
    ticketIds: [],
    calendarItemIds: [],
    tags: input.tags ?? [],
    ownedBy: input.ownedBy ?? "pm-agent",
    createdAt: now,
    updatedAt: now,
  };

  storage.saveInitiative(initiative);
  return initiative;
}

// ─── Link ticket to initiative ─────────────────────────────────────────────────

export function linkTicketToInitiative(
  storage: Storage,
  initiativeId: string,
  ticketId: string
): void {
  const initiative = storage.getInitiative(initiativeId);
  if (!initiative) throw new Error(`Initiative not found: ${initiativeId}`);
  if (initiative.ticketIds.includes(ticketId)) return;

  const ticketIds = [...initiative.ticketIds, ticketId];
  storage.updateInitiative(initiativeId, { ticketIds });

  // Also link back on the ticket
  const ticket = storage.getTicket(ticketId);
  if (ticket && !ticket.initiativeId) {
    storage.updateTicket(ticketId, { initiativeId });
  }
}

// ─── Link calendar item to initiative ─────────────────────────────────────────

export function linkCalendarItemToInitiative(
  storage: Storage,
  initiativeId: string,
  itemId: string
): void {
  const initiative = storage.getInitiative(initiativeId);
  if (!initiative) throw new Error(`Initiative not found: ${initiativeId}`);
  if (initiative.calendarItemIds.includes(itemId)) return;

  const calendarItemIds = [...initiative.calendarItemIds, itemId];
  storage.updateInitiative(initiativeId, { calendarItemIds });

  // Also link back on the calendar item
  const calItem = storage.getCalendarItem(itemId);
  if (calItem && !calItem.initiativeId) {
    storage.updateCalendarItem(itemId, { initiativeId });
  }
}

// ─── Find initiative by keyword ────────────────────────────────────────────────

export function findInitiativeByKeyword(
  storage: Storage,
  keyword: string
): Initiative | null {
  const initiatives = storage.listInitiatives();
  const lower = keyword.toLowerCase();

  // Exact match first
  const exact = initiatives.find(
    i => i.name.toLowerCase() === lower
  );
  if (exact) return exact;

  // Partial name match
  const partial = initiatives.find(
    i => i.name.toLowerCase().includes(lower) || lower.includes(i.name.toLowerCase())
  );
  if (partial) return partial;

  // Tag match
  const tagged = initiatives.find(
    i => i.tags.some(tag => tag.toLowerCase().includes(lower) || lower.includes(tag.toLowerCase()))
  );
  if (tagged) return tagged;

  return null;
}

// ─── Render initiatives ────────────────────────────────────────────────────────

export function renderInitiatives(storage: Storage): string {
  const lines: string[] = [];
  const initiatives = storage.listInitiatives();

  lines.push(chalk.bold.white("\n  ╔════════════════════════════════════════╗"));
  lines.push(chalk.bold.white("  ║          INITIATIVES OVERVIEW           ║"));
  lines.push(chalk.bold.white("  ╚════════════════════════════════════════╝\n"));

  if (initiatives.length === 0) {
    lines.push(chalk.dim("  No initiatives found.\n"));
    return lines.join("\n");
  }

  const statusColors: Record<Initiative["status"], (s: string) => string> = {
    active: chalk.green,
    planning: chalk.yellow,
    completed: chalk.dim,
    paused: chalk.red,
  };

  for (const initiative of initiatives) {
    const colorFn = statusColors[initiative.status];
    lines.push(
      `  ${chalk.bold(initiative.name)}  ${colorFn(`[${initiative.status.toUpperCase()}]`)}`
    );

    if (initiative.description) {
      lines.push(`    ${chalk.dim(initiative.description)}`);
    }

    if (initiative.targetDate) {
      lines.push(`    Target: ${chalk.cyan(initiative.targetDate)}`);
    }

    // Tickets
    const tickets = initiative.ticketIds
      .map(id => storage.getTicket(id))
      .filter(Boolean);

    if (tickets.length > 0) {
      const done = tickets.filter(t => t?.status === "done").length;
      const inProgress = tickets.filter(t => t?.status === "in_progress").length;
      const blocked = tickets.filter(t => t?.status === "blocked").length;
      lines.push(
        `    Tickets: ${tickets.length} total | ${done} done | ${inProgress} in progress | ${blocked} blocked`
      );
    }

    // Calendar items
    const calItems = initiative.calendarItemIds
      .map(id => storage.getCalendarItem(id))
      .filter(Boolean);

    if (calItems.length > 0) {
      const published = calItems.filter(ci => ci?.status === "published").length;
      lines.push(`    Content: ${calItems.length} items | ${published} published`);
    }

    if (initiative.tags.length > 0) {
      lines.push(`    Tags: ${initiative.tags.map(t => chalk.cyan(`#${t}`)).join(" ")}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}
