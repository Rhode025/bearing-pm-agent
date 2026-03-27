import { v4 as uuidv4 } from "uuid";
import Table from "cli-table3";
import chalk from "chalk";
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isWithinInterval,
} from "date-fns";
import type {
  EditorialCalendarItem,
  ContentType,
  ContentStatus,
  AgentName,
  CreateCalendarItemInput,
} from "./types.js";
import type { Storage } from "./storage.js";
import { routeCalendarItem } from "./router.js";

// ─── Status colors ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<ContentStatus, (s: string) => string> = {
  idea: chalk.gray,
  draft: chalk.yellow,
  in_review: chalk.blue,
  scheduled: chalk.cyan,
  published: chalk.green,
  archived: chalk.dim,
};

const CONTENT_TYPE_ICONS: Record<ContentType, string> = {
  article: "📄",
  blog_post: "📝",
  newsletter: "📧",
  landing_page: "🖥",
  social_campaign: "📣",
  release_notes: "🚀",
  content_refresh: "♻",
  case_study: "📊",
  announcement: "📢",
};

// ─── Create calendar item ──────────────────────────────────────────────────────

export function createCalendarItem(
  storage: Storage,
  input: CreateCalendarItemInput
): EditorialCalendarItem {
  const now = new Date().toISOString();
  const id = uuidv4();

  const item: EditorialCalendarItem = {
    id,
    title: input.title,
    contentType: input.contentType,
    status: input.status ?? "idea",
    assignedAgent: input.assignedAgent ?? null,
    publishDate: input.publishDate ?? null,
    dueDate: input.dueDate ?? null,
    theme: input.theme ?? null,
    tags: input.tags ?? [],
    keywords: input.keywords ?? [],
    initiativeId: input.initiativeId ?? null,
    sprintId: null,
    ticketId: null,
    notes: input.notes ?? "",
    briefUrl: null,
    draftUrl: null,
    publishedUrl: null,
    createdAt: now,
    updatedAt: now,
    sourceChannel: input.sourceChannel ?? "cli",
    sourceMessageId: input.sourceMessageId ?? null,
  };

  // Auto-route
  if (!item.assignedAgent) {
    const result = routeCalendarItem(item);
    item.assignedAgent = result.agent;
  }

  // Auto-set status to scheduled if we have a publish date
  if (item.publishDate && item.status === "idea") {
    item.status = "scheduled";
  }

  storage.saveCalendarItem(item);
  return item;
}

// ─── Schedule calendar item ────────────────────────────────────────────────────

export function scheduleCalendarItem(
  storage: Storage,
  itemId: string,
  publishDate: string,
  dueDate?: string
): EditorialCalendarItem {
  const item = storage.getCalendarItem(itemId);
  if (!item) throw new Error(`Calendar item not found: ${itemId}`);

  const updates: Partial<EditorialCalendarItem> = {
    publishDate,
    status: "scheduled",
  };
  if (dueDate) updates.dueDate = dueDate;

  storage.updateCalendarItem(itemId, updates);
  return { ...item, ...updates, updatedAt: new Date().toISOString() };
}

// ─── Update calendar item ──────────────────────────────────────────────────────

export function updateCalendarItem(
  storage: Storage,
  itemId: string,
  updates: Partial<EditorialCalendarItem>
): EditorialCalendarItem {
  const item = storage.getCalendarItem(itemId);
  if (!item) throw new Error(`Calendar item not found: ${itemId}`);

  storage.updateCalendarItem(itemId, updates);
  return { ...item, ...updates, updatedAt: new Date().toISOString() };
}

// ─── Get calendar by month ─────────────────────────────────────────────────────

export function getCalendarByMonth(
  storage: Storage,
  year: number,
  month: number
): EditorialCalendarItem[] {
  const all = storage.listCalendarItems();
  const start = startOfMonth(new Date(year, month - 1));
  const end = endOfMonth(start);

  return all.filter(item => {
    if (!item.publishDate) return false;
    try {
      const date = parseISO(item.publishDate);
      return isWithinInterval(date, { start, end });
    } catch {
      return false;
    }
  });
}

// ─── Get calendar by week ──────────────────────────────────────────────────────

export function getCalendarByWeek(
  storage: Storage,
  weekStart: string
): EditorialCalendarItem[] {
  const all = storage.listCalendarItems();
  try {
    const start = parseISO(weekStart);
    const end = endOfWeek(start, { weekStartsOn: 1 });

    return all.filter(item => {
      if (!item.publishDate) return false;
      try {
        const date = parseISO(item.publishDate);
        return isWithinInterval(date, { start, end });
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

// ─── Get editorial backlog ─────────────────────────────────────────────────────

export function getEditorialBacklog(storage: Storage): EditorialCalendarItem[] {
  return storage.listCalendarItems().filter(
    item =>
      !item.publishDate &&
      item.status !== "published" &&
      item.status !== "archived"
  );
}

// ─── Group by theme ────────────────────────────────────────────────────────────

export function groupByTheme(
  storage: Storage
): Record<string, EditorialCalendarItem[]> {
  const all = storage.listCalendarItems();
  const groups: Record<string, EditorialCalendarItem[]> = {};

  for (const item of all) {
    const theme = item.theme ?? "Unthemed";
    if (!groups[theme]) groups[theme] = [];
    groups[theme].push(item);
  }

  return groups;
}

// ─── Render calendar ───────────────────────────────────────────────────────────

export function renderCalendar(
  storage: Storage,
  options?: { month?: number; year?: number }
): string {
  const lines: string[] = [];
  const now = new Date();
  const year = options?.year ?? now.getFullYear();
  const month = options?.month ?? now.getMonth() + 1;

  lines.push(chalk.bold.white("\n  ╔═══════════════════════════════════════════════╗"));
  lines.push(
    chalk.bold.white(
      `  ║  EDITORIAL CALENDAR — ${format(new Date(year, month - 1), "MMMM yyyy").padEnd(22)}║`
    )
  );
  lines.push(chalk.bold.white("  ╚═══════════════════════════════════════════════╝\n"));

  // Scheduled this month
  const scheduled = getCalendarByMonth(storage, year, month);
  if (scheduled.length > 0) {
    lines.push(chalk.cyan(`  ── Scheduled (${scheduled.length}) ──`));
    const table = new Table({
      head: [
        chalk.dim("Publish Date"),
        chalk.dim("Title"),
        chalk.dim("Type"),
        chalk.dim("Status"),
        chalk.dim("Agent"),
      ],
      colWidths: [14, 38, 16, 12, 20],
      style: { head: [], border: ["dim"] },
      wordWrap: true,
    });

    const sorted = scheduled.sort((a, b) => {
      if (!a.publishDate) return 1;
      if (!b.publishDate) return -1;
      return a.publishDate.localeCompare(b.publishDate);
    });

    for (const item of sorted) {
      const statusFn = STATUS_COLORS[item.status];
      const icon = CONTENT_TYPE_ICONS[item.contentType] ?? "•";
      table.push([
        item.publishDate ? format(parseISO(item.publishDate), "MMM d") : "—",
        `${icon} ${item.title.length > 32 ? item.title.slice(0, 29) + "..." : item.title}`,
        chalk.dim(item.contentType.replace("_", " ")),
        statusFn(item.status),
        item.assignedAgent
          ? chalk.cyan(item.assignedAgent.replace("-agent", ""))
          : chalk.dim("—"),
      ]);
    }
    lines.push(table.toString());
    lines.push("");
  } else {
    lines.push(chalk.dim(`  No items scheduled for ${format(new Date(year, month - 1), "MMMM yyyy")}`));
    lines.push("");
  }

  // Backlog / ideas
  const backlog = getEditorialBacklog(storage);
  if (backlog.length > 0) {
    lines.push(chalk.yellow(`  ── Ideas / Backlog (${backlog.length}) ──`));
    for (const item of backlog.slice(0, 10)) {
      const icon = CONTENT_TYPE_ICONS[item.contentType] ?? "•";
      lines.push(
        `    ${chalk.dim("○")} ${icon} ${item.title} — ${chalk.dim(item.contentType.replace("_", " "))}`
      );
    }
    if (backlog.length > 10) {
      lines.push(chalk.dim(`    ... and ${backlog.length - 10} more`));
    }
    lines.push("");
  }

  // Theme clusters
  const themes = groupByTheme(storage);
  const nonTrivialThemes = Object.entries(themes).filter(
    ([theme, items]) => theme !== "Unthemed" && items.length > 0
  );

  if (nonTrivialThemes.length > 0) {
    lines.push(chalk.magenta("  ── Themes ──"));
    for (const [theme, items] of nonTrivialThemes) {
      lines.push(`    ${chalk.bold(theme)}: ${items.length} item${items.length > 1 ? "s" : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
