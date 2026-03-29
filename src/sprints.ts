import { v4 as uuidv4 } from "uuid";
import Table from "cli-table3";
import chalk from "chalk";
import { format, parseISO, isWithinInterval, addWeeks } from "date-fns";
import type {
  Sprint,
  Ticket,
  TicketPriority,
  CreateSprintInput,
} from "./types.js";
import type { Storage } from "./storage.js";

// ─── Create sprint ─────────────────────────────────────────────────────────────

export function createSprint(storage: Storage, input: CreateSprintInput): Sprint {
  const now = new Date().toISOString();
  const id = uuidv4();

  const sprint: Sprint = {
    id,
    name: input.name,
    goal: input.goal ?? "",
    status: "planning",
    startDate: input.startDate,
    endDate: input.endDate,
    ticketIds: input.ticketIds ?? [],
    velocity: null,
    createdAt: now,
    updatedAt: now,
  };

  storage.saveSprint(sprint);
  return sprint;
}

// ─── Add / Remove from sprint ──────────────────────────────────────────────────

export function addToSprint(
  storage: Storage,
  sprintId: string,
  ticketId: string
): void {
  const sprint = storage.getSprint(sprintId);
  if (!sprint) throw new Error(`Sprint not found: ${sprintId}`);
  if (sprint.ticketIds.includes(ticketId)) return; // already in sprint

  const ticketIds = [...sprint.ticketIds, ticketId];
  storage.updateSprint(sprintId, { ticketIds });

  // Also update the ticket's sprintId
  const ticket = storage.getTicket(ticketId);
  if (ticket) {
    storage.updateTicket(ticketId, { sprintId });
  }
}

export function removeFromSprint(
  storage: Storage,
  sprintId: string,
  ticketId: string
): void {
  const sprint = storage.getSprint(sprintId);
  if (!sprint) throw new Error(`Sprint not found: ${sprintId}`);

  const ticketIds = sprint.ticketIds.filter(id => id !== ticketId);
  storage.updateSprint(sprintId, { ticketIds });

  // Also clear the ticket's sprintId
  const ticket = storage.getTicket(ticketId);
  if (ticket && ticket.sprintId === sprintId) {
    storage.updateTicket(ticketId, { sprintId: null });
  }
}

// ─── List sprints ──────────────────────────────────────────────────────────────

export function listSprints(storage: Storage): Sprint[] {
  return storage.listSprints();
}

// ─── Get active / next sprint ──────────────────────────────────────────────────

export function getActiveSprint(storage: Storage): Sprint | null {
  const sprints = storage.listSprints();
  const now = new Date();

  // First look for explicitly active
  const active = sprints.find(s => s.status === "active");
  if (active) return active;

  // Fall back to one that contains today's date
  const current = sprints.find(s => {
    try {
      const start = parseISO(s.startDate);
      const end = parseISO(s.endDate);
      return isWithinInterval(now, { start, end }) && s.status !== "cancelled";
    } catch {
      return false;
    }
  });

  return current ?? null;
}

export function getNextSprint(storage: Storage): Sprint | null {
  const sprints = storage.listSprints();
  const now = new Date();
  const activeSprint = getActiveSprint(storage);

  if (activeSprint) {
    // Next sprint = planning sprint after current
    const planningAfterActive = sprints.find(
      s =>
        s.status === "planning" &&
        s.id !== activeSprint.id &&
        new Date(s.startDate) > now
    );
    return planningAfterActive ?? null;
  }

  // No active sprint – return the first future planning sprint
  const futurePlanning = sprints
    .filter(s => s.status === "planning" && new Date(s.startDate) > now)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  return futurePlanning[0] ?? null;
}

// ─── Backlog ────────────────────────────────────────────────────────────────────

export function getBacklog(storage: Storage): Ticket[] {
  const tickets = storage.listTickets();
  return tickets.filter(
    t =>
      !t.sprintId &&
      t.status !== "done" &&
      t.status !== "icebox"
  );
}

// ─── Suggest sprint scope ──────────────────────────────────────────────────────

export function suggestSprintScope(storage: Storage, sprintId: string): Ticket[] {
  const sprint = storage.getSprint(sprintId);
  if (!sprint) throw new Error(`Sprint not found: ${sprintId}`);

  const backlog = getBacklog(storage);

  // Sort by priority
  const priorityOrder: TicketPriority[] = ["critical", "high", "medium", "low"];
  const sorted = backlog.sort(
    (a, b) => priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority)
  );

  // Suggest up to 8 tickets (typical 2-week sprint)
  return sorted.slice(0, 8);
}

// ─── Ensure default sprints exist ─────────────────────────────────────────────

export function ensureDefaultSprints(storage: Storage): void {
  const sprints = storage.listSprints();
  if (sprints.length > 0) return;

  const now = new Date();

  // Current sprint
  const currentStart = new Date(now);
  currentStart.setDate(currentStart.getDate() - currentStart.getDay() + 1); // Monday
  const currentEnd = addWeeks(currentStart, 2);
  currentEnd.setDate(currentEnd.getDate() - 1); // Friday

  const current = createSprint(storage, {
    name: `Sprint ${format(currentStart, "MMM d")} – ${format(currentEnd, "MMM d, yyyy")}`,
    goal: "Travel Windows polish and member onboarding improvements",
    startDate: format(currentStart, "yyyy-MM-dd"),
    endDate: format(currentEnd, "yyyy-MM-dd"),
  });
  storage.updateSprint(current.id, { status: "active" });

  // Next sprint
  const nextStart = addWeeks(currentStart, 2);
  const nextEnd = addWeeks(nextStart, 2);
  nextEnd.setDate(nextEnd.getDate() - 1);

  createSprint(storage, {
    name: `Sprint ${format(nextStart, "MMM d")} – ${format(nextEnd, "MMM d, yyyy")}`,
    goal: "Platform stability and growth initiatives",
    startDate: format(nextStart, "yyyy-MM-dd"),
    endDate: format(nextEnd, "yyyy-MM-dd"),
  });
}

// ─── Render sprint ─────────────────────────────────────────────────────────────

export function renderSprint(storage: Storage, sprint: Sprint): string {
  const lines: string[] = [];

  const statusColor =
    sprint.status === "active"
      ? chalk.green
      : sprint.status === "completed"
      ? chalk.dim
      : chalk.yellow;

  lines.push(
    chalk.bold.white(`\n  Sprint: ${sprint.name}`)
  );
  lines.push(`  Status: ${statusColor(sprint.status.toUpperCase())}`);
  lines.push(`  Period: ${sprint.startDate} → ${sprint.endDate}`);
  if (sprint.goal) {
    lines.push(`  Goal:   ${chalk.italic(sprint.goal)}`);
  }
  lines.push("");

  const tickets = sprint.ticketIds
    .map(id => storage.getTicket(id))
    .filter((t): t is Ticket => t !== null);

  if (tickets.length === 0) {
    lines.push(chalk.dim("  No tickets in this sprint yet.\n"));
    return lines.join("\n");
  }

  const table = new Table({
    head: [
      chalk.dim("ID"),
      chalk.dim("Title"),
      chalk.dim("Status"),
      chalk.dim("Priority"),
      chalk.dim("Agent"),
    ],
    colWidths: [10, 40, 14, 10, 20],
    style: { head: [], border: ["dim"] },
    wordWrap: true,
  });

  const statusOrder = ["in_progress", "in_review", "blocked", "ready", "inbox", "done"];
  const sorted = tickets.sort(
    (a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
  );

  for (const t of sorted) {
    const statusColors: Record<string, (s: string) => string> = {
      in_progress: chalk.blue,
      in_review: chalk.yellow,
      blocked: chalk.red,
      ready: chalk.cyan,
      done: chalk.green,
      inbox: chalk.gray,
    };
    const colorFn = statusColors[t.status] ?? chalk.white;

    table.push([
      chalk.dim(t.id.slice(0, 8)),
      t.title.length > 38 ? t.title.slice(0, 35) + "..." : t.title,
      colorFn(t.status.replace("_", " ")),
      t.priority,
      t.assignedAgent ? chalk.cyan(t.assignedAgent.replace("-agent", "")) : chalk.dim("—"),
    ]);
  }

  lines.push(table.toString());
  lines.push(
    chalk.dim(
      `\n  ${tickets.length} tickets | ` +
        `Done: ${tickets.filter(t => t.status === "done").length} | ` +
        `In Progress: ${tickets.filter(t => t.status === "in_progress").length} | ` +
        `Blocked: ${tickets.filter(t => t.status === "blocked").length}`
    )
  );

  return lines.join("\n");
}

// ─── Render sprint summary ─────────────────────────────────────────────────────

export function renderSprintSummary(storage: Storage): string {
  const lines: string[] = [];
  const sprints = storage.listSprints();

  lines.push(chalk.bold.white("\n  ╔════════════════════════════════════╗"));
  lines.push(chalk.bold.white("  ║        SPRINT OVERVIEW              ║"));
  lines.push(chalk.bold.white("  ╚════════════════════════════════════╝\n"));

  if (sprints.length === 0) {
    lines.push(chalk.dim("  No sprints found. Run 'npm run demo' to seed data.\n"));
    return lines.join("\n");
  }

  const active = getActiveSprint(storage);
  const next = getNextSprint(storage);

  if (active) {
    lines.push(chalk.green("  ► ACTIVE SPRINT"));
    lines.push(renderSprint(storage, active));
  }

  if (next) {
    lines.push(chalk.yellow("\n  ► NEXT SPRINT (Planning)"));
    lines.push(renderSprint(storage, next));
  }

  // Backlog summary
  const backlog = getBacklog(storage);
  if (backlog.length > 0) {
    lines.push(chalk.bold("\n  ► BACKLOG"));
    lines.push(chalk.dim(`  ${backlog.length} items waiting for sprint assignment`));
    const highPriority = backlog.filter(t => t.priority === "critical" || t.priority === "high");
    if (highPriority.length > 0) {
      lines.push(chalk.yellow(`  ${highPriority.length} high/critical priority:`));
      for (const t of highPriority.slice(0, 5)) {
        lines.push(`    ${chalk.red("●")} ${t.title} (${t.priority})`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}
