import { v4 as uuidv4 } from "uuid";
import Table from "cli-table3";
import chalk from "chalk";
import { format, subDays } from "date-fns";
import type {
  Ticket,
  TicketStatus,
  TicketPriority,
  AgentName,
  BoardStats,
  CreateTicketInput,
} from "./types.js";
import type { Storage } from "./storage.js";
import { routeTicket } from "./router.js";

// ─── Status ordering and colors ───────────────────────────────────────────────

const STATUS_ORDER: TicketStatus[] = [
  "inbox",
  "ready",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "icebox",
];

const STATUS_COLORS: Record<TicketStatus, (s: string) => string> = {
  inbox: chalk.gray,
  ready: chalk.cyan,
  in_progress: chalk.blue,
  in_review: chalk.yellow,
  blocked: chalk.red,
  done: chalk.green,
  icebox: chalk.dim,
};

const PRIORITY_COLORS: Record<TicketPriority, (s: string) => string> = {
  critical: chalk.bgRed.white,
  high: chalk.red,
  medium: chalk.yellow,
  low: chalk.gray,
};

const STATUS_DISPLAY: Record<TicketStatus, string> = {
  inbox: "Inbox",
  ready: "Ready",
  in_progress: "In Progress",
  in_review: "In Review",
  blocked: "Blocked",
  done: "Done",
  icebox: "Icebox",
};

// ─── Create ticket ─────────────────────────────────────────────────────────────

export function createTicket(storage: Storage, input: CreateTicketInput): Ticket {
  const now = new Date().toISOString();
  const id = uuidv4();

  // Auto-detect type from title
  let ticketType = input.type ?? "ticket";
  const titleLower = (input.title ?? "").toLowerCase();
  if (!input.type) {
    if (/\bbug\b/.test(titleLower) || /\bfix\b/.test(titleLower)) ticketType = "bug";
    else if (/\brelease\s*notes?\b/.test(titleLower)) ticketType = "release_note";
    else if (/\bepic\b/.test(titleLower)) ticketType = "epic";
    else if (/\btask\b/.test(titleLower)) ticketType = "task";
  }

  const ticket: Ticket = {
    id,
    title: input.title,
    description: input.description ?? "",
    type: ticketType,
    status: input.status ?? "inbox",
    priority: input.priority ?? "medium",
    assignedAgent: input.assignedAgent ?? null,
    tags: input.tags ?? [],
    blockers: [],
    sprintId: input.sprintId ?? null,
    initiativeId: input.initiativeId ?? null,
    parentTicketId: input.parentTicketId ?? null,
    childTicketIds: [],
    estimatePoints: input.estimatePoints ?? null,
    createdAt: now,
    updatedAt: now,
    dueDate: input.dueDate ?? null,
    closedAt: null,
    sourceChannel: input.sourceChannel ?? "cli",
    sourceMessageId: input.sourceMessageId ?? null,
    metadata: {},
  };

  // Auto-route if no agent assigned
  if (!ticket.assignedAgent) {
    const result = routeTicket(ticket);
    ticket.assignedAgent = result.agent;
  }

  storage.saveTicket(ticket);
  return ticket;
}

// ─── Move ticket ────────────────────────────────────────────────────────────────

export function moveTicket(
  storage: Storage,
  ticketId: string,
  newStatus: TicketStatus
): Ticket {
  const ticket = storage.getTicket(ticketId);
  if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);

  const updates: Partial<Ticket> = { status: newStatus };

  if (newStatus === "done") {
    updates.closedAt = new Date().toISOString();
  }
  if (newStatus === "in_progress" && !ticket.assignedAgent) {
    // Try to auto-assign
    const result = routeTicket(ticket);
    updates.assignedAgent = result.agent;
  }

  storage.updateTicket(ticketId, updates);
  return { ...ticket, ...updates, updatedAt: new Date().toISOString() };
}

// ─── Assign ticket ─────────────────────────────────────────────────────────────

export function assignTicket(
  storage: Storage,
  ticketId: string,
  agent: AgentName
): Ticket {
  const ticket = storage.getTicket(ticketId);
  if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);

  storage.updateTicket(ticketId, { assignedAgent: agent });
  storage.setLastAgent(agent);
  return { ...ticket, assignedAgent: agent, updatedAt: new Date().toISOString() };
}

// ─── Prioritize ticket ─────────────────────────────────────────────────────────

export function prioritizeTicket(
  storage: Storage,
  ticketId: string,
  priority: TicketPriority
): Ticket {
  const ticket = storage.getTicket(ticketId);
  if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);

  storage.updateTicket(ticketId, { priority });
  return { ...ticket, priority, updatedAt: new Date().toISOString() };
}

// ─── Blockers ───────────────────────────────────────────────────────────────────

export function addBlocker(
  storage: Storage,
  ticketId: string,
  blocker: string
): Ticket {
  const ticket = storage.getTicket(ticketId);
  if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);

  const blockers = [...ticket.blockers, blocker];
  storage.updateTicket(ticketId, { blockers, status: "blocked" });
  return {
    ...ticket,
    blockers,
    status: "blocked",
    updatedAt: new Date().toISOString(),
  };
}

export function resolveBlocker(
  storage: Storage,
  ticketId: string,
  blocker: string
): Ticket {
  const ticket = storage.getTicket(ticketId);
  if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);

  const blockers = ticket.blockers.filter(
    b => !b.toLowerCase().includes(blocker.toLowerCase())
  );
  const newStatus: TicketStatus = blockers.length === 0 ? "ready" : "blocked";
  storage.updateTicket(ticketId, { blockers, status: newStatus });
  return {
    ...ticket,
    blockers,
    status: newStatus,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Find similar tickets ──────────────────────────────────────────────────────

export function findSimilarTickets(storage: Storage, title: string): Ticket[] {
  const all = storage.listTickets();
  const titleWords = title
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3);

  return all.filter(ticket => {
    const ticketWords = ticket.title.toLowerCase().split(/\s+/);
    const matches = titleWords.filter(w => ticketWords.some(tw => tw.includes(w) || w.includes(tw)));
    return matches.length >= Math.min(2, titleWords.length);
  });
}

// ─── Board stats ────────────────────────────────────────────────────────────────

export function getBoardStats(storage: Storage): BoardStats {
  const tickets = storage.listTickets();
  const now = new Date();
  const weekAgo = subDays(now, 7);

  const byStatus: Record<TicketStatus, number> = {
    inbox: 0, ready: 0, in_progress: 0, in_review: 0,
    blocked: 0, done: 0, icebox: 0,
  };
  const byPriority: Record<TicketPriority, number> = {
    critical: 0, high: 0, medium: 0, low: 0,
  };
  const byAgent: Record<string, number> = {};

  let doneThisWeek = 0;

  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;

    if (t.assignedAgent) {
      byAgent[t.assignedAgent] = (byAgent[t.assignedAgent] ?? 0) + 1;
    }

    if (
      t.status === "done" &&
      t.closedAt &&
      new Date(t.closedAt) >= weekAgo
    ) {
      doneThisWeek++;
    }
  }

  return {
    totalTickets: tickets.length,
    byStatus,
    byPriority,
    byAgent,
    blockedCount: byStatus.blocked,
    inProgressCount: byStatus.in_progress,
    doneThisWeek,
  };
}

// ─── Render board ───────────────────────────────────────────────────────────────

export function renderBoard(storage: Storage): string {
  const tickets = storage.listTickets();
  const lines: string[] = [];

  lines.push(chalk.bold.white("\n  ╔══════════════════════════════════════════╗"));
  lines.push(chalk.bold.white("  ║        BEARING KANBAN BOARD               ║"));
  lines.push(chalk.bold.white("  ╚══════════════════════════════════════════╝\n"));

  const activeStatuses: TicketStatus[] = ["inbox", "ready", "in_progress", "in_review", "blocked"];

  for (const status of activeStatuses) {
    const statusTickets = tickets.filter(t => t.status === status);
    if (statusTickets.length === 0) continue;

    const colorFn = STATUS_COLORS[status];
    lines.push(colorFn(`  ── ${STATUS_DISPLAY[status].toUpperCase()} (${statusTickets.length}) ──`));

    const table = new Table({
      head: [
        chalk.dim("ID"),
        chalk.dim("Title"),
        chalk.dim("Type"),
        chalk.dim("Priority"),
        chalk.dim("Agent"),
        chalk.dim("Sprint"),
      ],
      colWidths: [10, 38, 12, 10, 20, 12],
      style: { head: [], border: ["dim"] },
      wordWrap: true,
    });

    const sorted = statusTickets.sort((a, b) => {
      const pOrder = ["critical", "high", "medium", "low"];
      return pOrder.indexOf(a.priority) - pOrder.indexOf(b.priority);
    });

    for (const t of sorted) {
      const priorityFn = PRIORITY_COLORS[t.priority];
      table.push([
        chalk.dim(t.id.slice(0, 8)),
        t.title.length > 36 ? t.title.slice(0, 33) + "..." : t.title,
        chalk.dim(t.type),
        priorityFn(t.priority),
        t.assignedAgent ? chalk.cyan(t.assignedAgent.replace("-agent", "")) : chalk.dim("unassigned"),
        t.sprintId ? chalk.green("S-" + t.sprintId.slice(0, 6)) : chalk.dim("backlog"),
      ]);
    }

    lines.push(table.toString());
    lines.push("");
  }

  // Done section (compact)
  const doneTickets = tickets.filter(t => t.status === "done");
  if (doneTickets.length > 0) {
    lines.push(chalk.green(`  ── DONE (${doneTickets.length}) ──`));
    const recent = doneTickets.slice(0, 5);
    for (const t of recent) {
      lines.push(
        chalk.dim(`    ✓ [${t.id.slice(0, 8)}] ${t.title.slice(0, 50)}`)
      );
    }
    if (doneTickets.length > 5) {
      lines.push(chalk.dim(`    ... and ${doneTickets.length - 5} more`));
    }
    lines.push("");
  }

  // Stats footer
  const stats = getBoardStats(storage);
  lines.push(chalk.dim("  ─────────────────────────────────────────────────"));
  lines.push(
    chalk.dim(
      `  Total: ${stats.totalTickets} | In Progress: ${stats.inProgressCount} | Blocked: ${stats.blockedCount} | Done This Week: ${stats.doneThisWeek}`
    )
  );
  lines.push("");

  return lines.join("\n");
}
