import chalk from "chalk";
import { format, subDays, parseISO, isAfter, isBefore, addDays } from "date-fns";
import type { TicketStatus, TicketPriority, AgentName } from "./types.js";
import type { Storage } from "./storage.js";
import { getActiveSprint, getNextSprint, getBacklog, renderSprint } from "./sprints.js";
import { renderCalendar } from "./editorial-calendar.js";
import { renderInitiatives } from "./initiatives.js";
import { renderDecisions } from "./decision-log.js";
import { getAllQueues, getWorkloadSummary } from "./router.js";
import { getBoardStats } from "./kanban.js";

// ─── Daily summary ─────────────────────────────────────────────────────────────

export function generateDailySummary(storage: Storage): string {
  const lines: string[] = [];
  const today = new Date();

  lines.push(chalk.bold.white("\n  ╔══════════════════════════════════════════════╗"));
  lines.push(
    chalk.bold.white(
      `  ║  DAILY SUMMARY — ${format(today, "EEEE, MMM d, yyyy").padEnd(26)}║`
    )
  );
  lines.push(chalk.bold.white("  ╚══════════════════════════════════════════════╝\n"));

  const stats = getBoardStats(storage);

  // Highlights
  lines.push(chalk.bold("  At a Glance:"));
  lines.push(`    ${chalk.blue("●")} ${stats.inProgressCount} tickets in progress`);
  lines.push(`    ${chalk.red("●")} ${stats.blockedCount} tickets blocked`);
  lines.push(`    ${chalk.green("●")} ${stats.doneThisWeek} tickets closed this week`);
  lines.push(`    ${chalk.gray("●")} ${stats.totalTickets} total tickets\n`);

  // Active sprint
  const activeSprint = getActiveSprint(storage);
  if (activeSprint) {
    const sprintTickets = activeSprint.ticketIds
      .map(id => storage.getTicket(id))
      .filter(Boolean);
    const done = sprintTickets.filter(t => t?.status === "done").length;
    const total = sprintTickets.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    lines.push(chalk.bold("  Active Sprint:"));
    lines.push(`    ${activeSprint.name}`);
    lines.push(`    Progress: ${done}/${total} tickets done (${pct}%)`);
    lines.push(`    End date: ${activeSprint.endDate}\n`);
  }

  // Blocked items
  const blocked = storage.listTickets({ status: "blocked" });
  if (blocked.length > 0) {
    lines.push(chalk.bold.red("  Blocked (needs attention):"));
    for (const t of blocked) {
      lines.push(`    ${chalk.red("✗")} ${t.title}`);
      if (t.blockers.length > 0) {
        lines.push(chalk.dim(`       Blockers: ${t.blockers.join("; ")}`));
      }
    }
    lines.push("");
  }

  // Recent messages
  const messages = storage.listMessages(3);
  if (messages.length > 0) {
    lines.push(chalk.bold("  Recent Activity:"));
    for (const m of messages) {
      lines.push(`    ${chalk.dim("▸")} ${m.raw.slice(0, 80)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Weekly summary ────────────────────────────────────────────────────────────

export function generateWeeklySummary(storage: Storage): string {
  const lines: string[] = [];
  const now = new Date();
  const weekAgo = subDays(now, 7);

  lines.push(chalk.bold.white("\n  ╔══════════════════════════════════════════════╗"));
  lines.push(
    chalk.bold.white(
      `  ║  WEEKLY SUMMARY — Week of ${format(weekAgo, "MMM d").padEnd(20)}║`
    )
  );
  lines.push(chalk.bold.white("  ╚══════════════════════════════════════════════╝\n"));

  const allTickets = storage.listTickets();

  // Completed this week
  const completedThisWeek = allTickets.filter(
    t =>
      t.status === "done" &&
      t.closedAt &&
      isAfter(parseISO(t.closedAt), weekAgo)
  );

  lines.push(chalk.bold(`  Completed This Week (${completedThisWeek.length}):`));
  if (completedThisWeek.length === 0) {
    lines.push(chalk.dim("    None\n"));
  } else {
    for (const t of completedThisWeek) {
      lines.push(
        `    ${chalk.green("✓")} ${t.title} ${chalk.dim(`[${t.assignedAgent?.replace("-agent", "") ?? "—"}]`)}`
      );
    }
    lines.push("");
  }

  // Created this week
  const createdThisWeek = allTickets.filter(t =>
    isAfter(parseISO(t.createdAt), weekAgo)
  );
  lines.push(chalk.bold(`  Created This Week (${createdThisWeek.length}):`));
  if (createdThisWeek.length === 0) {
    lines.push(chalk.dim("    None\n"));
  } else {
    for (const t of createdThisWeek.slice(0, 8)) {
      lines.push(
        `    ${chalk.blue("+")} ${t.title} ${chalk.dim(`[${t.priority}]`)}`
      );
    }
    if (createdThisWeek.length > 8) {
      lines.push(chalk.dim(`    ... and ${createdThisWeek.length - 8} more`));
    }
    lines.push("");
  }

  // Decisions logged this week
  const decisions = storage.listDecisions().filter(d =>
    isAfter(parseISO(d.createdAt), weekAgo)
  );
  if (decisions.length > 0) {
    lines.push(chalk.bold(`  Decisions Logged (${decisions.length}):`));
    for (const d of decisions) {
      lines.push(`    ${chalk.cyan("▸")} ${d.decision}`);
    }
    lines.push("");
  }

  // Agent workload
  const workload = getWorkloadSummary(storage);
  lines.push(chalk.bold("  Agent Workload:"));
  for (const [agent, w] of Object.entries(workload)) {
    if (w.total === 0) continue;
    const workloadIndicator =
      w.workload === "heavy" ? chalk.red("●") :
      w.workload === "moderate" ? chalk.yellow("●") :
      chalk.green("●");
    lines.push(
      `    ${workloadIndicator} ${agent.replace("-agent", "").padEnd(14)} ${w.inProgress} active / ${w.total} total`
    );
  }
  lines.push("");

  return lines.join("\n");
}

// ─── Sprint report ─────────────────────────────────────────────────────────────

export function generateSprintReport(storage: Storage): string {
  const lines: string[] = [];

  lines.push(chalk.bold.white("\n  ╔═══════════════════════════════════════════╗"));
  lines.push(chalk.bold.white("  ║          SPRINT REPORT                     ║"));
  lines.push(chalk.bold.white("  ╚═══════════════════════════════════════════╝\n"));

  const active = getActiveSprint(storage);
  const next = getNextSprint(storage);

  if (active) {
    lines.push(chalk.bold("  ACTIVE SPRINT"));
    lines.push(renderSprint(storage, active));
    lines.push("");
  } else {
    lines.push(chalk.dim("  No active sprint.\n"));
  }

  if (next) {
    lines.push(chalk.bold("  NEXT SPRINT"));
    lines.push(renderSprint(storage, next));
    lines.push("");
  }

  const backlog = getBacklog(storage);
  lines.push(chalk.bold(`  BACKLOG (${backlog.length} items):`));
  if (backlog.length === 0) {
    lines.push(chalk.dim("    Backlog is empty.\n"));
  } else {
    const byPriority: TicketPriority[] = ["critical", "high", "medium", "low"];
    for (const priority of byPriority) {
      const items = backlog.filter(t => t.priority === priority);
      if (items.length === 0) continue;
      lines.push(`    ${priority.toUpperCase()} (${items.length}):`);
      for (const t of items.slice(0, 5)) {
        lines.push(
          `      ${chalk.dim("○")} ${t.title} ${chalk.dim(`[${t.assignedAgent?.replace("-agent", "") ?? "—"}]`)}`
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Editorial report ──────────────────────────────────────────────────────────

export function generateEditorialReport(storage: Storage): string {
  const now = new Date();
  const lines: string[] = [
    renderCalendar(storage, { month: now.getMonth() + 1, year: now.getFullYear() }),
  ];

  // Upcoming (next month)
  const nextMonth = addDays(now, 30);
  const upcomingItems = storage.listCalendarItems().filter(item => {
    if (!item.publishDate) return false;
    const pub = parseISO(item.publishDate);
    return isAfter(pub, now) && isBefore(pub, nextMonth);
  });

  if (upcomingItems.length > 0) {
    lines.push(chalk.bold("  Upcoming 30 Days:"));
    for (const item of upcomingItems.sort((a, b) =>
      (a.publishDate ?? "").localeCompare(b.publishDate ?? "")
    )) {
      lines.push(
        `    ${chalk.cyan(item.publishDate ?? "?")} — ${item.title} (${item.contentType.replace("_", " ")})`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Blocked report ────────────────────────────────────────────────────────────

export function generateBlockedReport(storage: Storage): string {
  const lines: string[] = [];

  lines.push(chalk.bold.red("\n  ╔═══════════════════════════════════════════╗"));
  lines.push(chalk.bold.red("  ║           BLOCKED ITEMS REPORT             ║"));
  lines.push(chalk.bold.red("  ╚═══════════════════════════════════════════╝\n"));

  const blocked = storage.listTickets({ status: "blocked" });

  if (blocked.length === 0) {
    lines.push(chalk.green("  No blocked items. All clear!\n"));
    return lines.join("\n");
  }

  lines.push(chalk.bold(`  ${blocked.length} blocked ticket(s):\n`));

  for (const t of blocked) {
    lines.push(
      `  ${chalk.red("✗")} ${chalk.bold(t.title)} ${chalk.dim(`[${t.priority}]`)}`
    );
    lines.push(
      `    ${chalk.dim("Assigned to:")} ${t.assignedAgent ?? "unassigned"}`
    );

    if (t.blockers.length > 0) {
      lines.push(`    ${chalk.dim("Blockers:")}`);
      for (const b of t.blockers) {
        lines.push(`      ${chalk.yellow("→")} ${b}`);
      }
    }

    if (t.sprintId) {
      const sprint = storage.getSprint(t.sprintId);
      if (sprint) {
        lines.push(`    ${chalk.dim("Sprint:")} ${sprint.name}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ─── Initiatives report ────────────────────────────────────────────────────────

export function generateInitiativesReport(storage: Storage): string {
  return renderInitiatives(storage);
}

// ─── Agent queue report ────────────────────────────────────────────────────────

export function generateAgentQueueReport(storage: Storage): string {
  const lines: string[] = [];

  lines.push(chalk.bold.white("\n  ╔════════════════════════════════════════════╗"));
  lines.push(chalk.bold.white("  ║          AGENT QUEUE REPORT                 ║"));
  lines.push(chalk.bold.white("  ╚════════════════════════════════════════════╝\n"));

  const queues = getAllQueues(storage);
  const workload = getWorkloadSummary(storage);

  for (const [agentName, queue] of Object.entries(queues)) {
    const agentKey = agentName as AgentName;
    const w = workload[agentKey];
    const totalActive = queue.tickets.filter(
      t => t.status !== "done" && t.status !== "icebox"
    ).length;

    if (totalActive === 0 && queue.calendarItems.length === 0) continue;

    const workloadIndicator =
      w?.workload === "heavy" ? chalk.red("●") :
      w?.workload === "moderate" ? chalk.yellow("●") :
      chalk.green("●");

    lines.push(
      `  ${workloadIndicator} ${chalk.bold(agentName.replace("-agent", "").toUpperCase().padEnd(14))} ` +
        `${chalk.dim(`${totalActive} tickets | ${queue.calendarItems.length} content items`)}`
    );

    // Show in-progress tickets
    const inProgress = queue.tickets.filter(t => t.status === "in_progress");
    for (const t of inProgress) {
      lines.push(
        `    ${chalk.blue("▶")} ${t.title.slice(0, 55)} ${chalk.dim(`[${t.priority}]`)}`
      );
    }

    // Show blocked tickets
    const blocked = queue.tickets.filter(t => t.status === "blocked");
    for (const t of blocked) {
      lines.push(
        `    ${chalk.red("✗")} ${t.title.slice(0, 55)} ${chalk.dim("[blocked]")}`
      );
    }

    // Calendar items
    const activeContent = queue.calendarItems.filter(
      ci => ci.status !== "published" && ci.status !== "archived"
    );
    for (const ci of activeContent.slice(0, 3)) {
      lines.push(
        `    ${chalk.cyan("✎")} ${ci.title.slice(0, 55)} ${chalk.dim(`[${ci.status}]`)}`
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}
