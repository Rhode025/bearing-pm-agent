import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { format, parseISO } from "date-fns";
import type {
  Ticket,
  EditorialCalendarItem,
  AgentHandoff,
  HandoffMode,
  AgentName,
} from "./types.js";
import type { Storage } from "./storage.js";
import type { Config } from "./config.js";
import { AGENT_DIRECTORY } from "./agent-directory.js";

// ─── Create handoff ────────────────────────────────────────────────────────────

export function createHandoff(
  item: Ticket | EditorialCalendarItem,
  storage: Storage,
  overrideAgent?: AgentName
): AgentHandoff {
  const now = new Date().toISOString();
  const id = uuidv4();

  // Determine if it's a Ticket or EditorialCalendarItem
  const isTicket = "type" in item && "status" in item;

  let targetAgent: AgentName;
  let instruction: string;
  let context: string;
  let ticketId: string | null = null;
  let calendarItemId: string | null = null;

  if (isTicket) {
    const ticket = item as Ticket;
    targetAgent = overrideAgent ?? ticket.assignedAgent ?? "engineering-agent";
    ticketId = ticket.id;
    instruction = buildTicketInstruction(ticket);
    context = buildTicketContext(ticket, storage);
  } else {
    const calItem = item as EditorialCalendarItem;
    targetAgent = overrideAgent ?? calItem.assignedAgent ?? "editorial-agent";
    calendarItemId = calItem.id;
    instruction = buildCalendarInstruction(calItem);
    context = buildCalendarContext(calItem, storage);
  }

  const priority = isTicket ? (item as Ticket).priority : "medium";

  const handoff: AgentHandoff = {
    id,
    targetAgent,
    sourceAgent: "pm-agent",
    ticketId,
    calendarItemId,
    priority,
    instruction,
    context,
    createdAt: now,
    status: "pending",
  };

  storage.saveHandoff(handoff);
  return handoff;
}

// ─── Instruction builders ──────────────────────────────────────────────────────

function buildTicketInstruction(ticket: Ticket): string {
  const statusMap: Record<string, string> = {
    inbox: "Pick up and begin work on",
    ready: "Begin implementation of",
    in_progress: "Continue work on",
    in_review: "Review and provide feedback on",
    blocked: "Investigate blockers for and resume work on",
    done: "Verify completion of",
    icebox: "Review for potential activation:",
  };

  const verb = statusMap[ticket.status] ?? "Handle";
  let instruction = `${verb}: ${ticket.title}`;

  if (ticket.priority === "critical") {
    instruction = `[CRITICAL] ${instruction}`;
  } else if (ticket.priority === "high") {
    instruction = `[HIGH] ${instruction}`;
  }

  if (ticket.blockers.length > 0) {
    instruction += `\n\nBlockers to resolve:\n${ticket.blockers.map(b => `  - ${b}`).join("\n")}`;
  }

  return instruction;
}

function buildCalendarInstruction(item: EditorialCalendarItem): string {
  const statusMap: Record<string, string> = {
    idea: "Write a brief and begin draft for",
    draft: "Complete and polish the draft for",
    in_review: "Review and provide editorial feedback on",
    scheduled: "Prepare final copy and assets for scheduled publication of",
    published: "Archive and document metrics for",
    archived: "Review archived piece for potential refresh:",
  };

  const verb = statusMap[item.status] ?? "Handle";
  let instruction = `${verb}: "${item.title}"`;

  if (item.publishDate) {
    instruction += `\nScheduled to publish: ${item.publishDate}`;
  }

  if (item.dueDate) {
    instruction += `\nDraft due: ${item.dueDate}`;
  }

  if (item.keywords.length > 0) {
    instruction += `\nTarget keywords: ${item.keywords.join(", ")}`;
  }

  return instruction;
}

function buildTicketContext(ticket: Ticket, storage: Storage): string {
  const parts: string[] = [];

  parts.push(`Ticket ID: ${ticket.id}`);
  parts.push(`Type: ${ticket.type}`);
  parts.push(`Priority: ${ticket.priority}`);
  parts.push(`Created: ${ticket.createdAt}`);

  if (ticket.tags.length > 0) {
    parts.push(`Tags: ${ticket.tags.join(", ")}`);
  }

  if (ticket.description) {
    parts.push(`Description: ${ticket.description}`);
  }

  if (ticket.sprintId) {
    const sprint = storage.getSprint(ticket.sprintId);
    if (sprint) {
      parts.push(`Sprint: ${sprint.name} (${sprint.startDate} – ${sprint.endDate})`);
    }
  }

  if (ticket.initiativeId) {
    const initiative = storage.getInitiative(ticket.initiativeId);
    if (initiative) {
      parts.push(`Initiative: ${initiative.name}`);
    }
  }

  return parts.join("\n");
}

function buildCalendarContext(item: EditorialCalendarItem, storage: Storage): string {
  const parts: string[] = [];

  parts.push(`Item ID: ${item.id}`);
  parts.push(`Content Type: ${item.contentType}`);
  parts.push(`Status: ${item.status}`);

  if (item.theme) {
    parts.push(`Theme: ${item.theme}`);
  }

  if (item.tags.length > 0) {
    parts.push(`Tags: ${item.tags.join(", ")}`);
  }

  if (item.notes) {
    parts.push(`Notes: ${item.notes}`);
  }

  if (item.initiativeId) {
    const initiative = storage.getInitiative(item.initiativeId);
    if (initiative) {
      parts.push(`Initiative: ${initiative.name}`);
    }
  }

  return parts.join("\n");
}

// ─── Emit handoff ──────────────────────────────────────────────────────────────

export function emitHandoff(
  handoff: AgentHandoff,
  mode: HandoffMode,
  config: Config
): void {
  const payload = {
    ...handoff,
    agentDisplayName:
      AGENT_DIRECTORY[handoff.targetAgent]?.displayName ?? handoff.targetAgent,
    emittedAt: new Date().toISOString(),
  };

  switch (mode) {
    case "file": {
      const dir = config.queueDir;
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const filename = path.join(
        dir,
        `${handoff.targetAgent}-${handoff.id}.json`
      );
      fs.writeFileSync(filename, JSON.stringify(payload, null, 2), "utf-8");
      break;
    }

    case "stdout": {
      console.log(
        chalk.cyan(`\n  [HANDOFF → ${handoff.targetAgent}]`),
        chalk.white(handoff.instruction.split("\n")[0])
      );
      break;
    }

    case "webhook": {
      // Placeholder for HTTP delivery — log intent, skip actual HTTP in this implementation
      console.log(
        chalk.dim(
          `  [WEBHOOK] Would POST handoff ${handoff.id} to ${handoff.targetAgent} queue`
        )
      );
      break;
    }

    default: {
      // Exhaustive check
      const _exhaustive: never = mode;
      throw new Error(`Unknown handoff mode: ${String(_exhaustive)}`);
    }
  }
}

// ─── Process queue ─────────────────────────────────────────────────────────────

export function processQueue(storage: Storage, config: Config): void {
  const pending = storage.listHandoffs({ status: "pending" });

  if (pending.length === 0) {
    console.log(chalk.dim("  No pending handoffs in queue."));
    return;
  }

  console.log(chalk.bold(`\n  Processing ${pending.length} pending handoff(s)...\n`));

  for (const handoff of pending) {
    emitHandoff(handoff, "file", config);
    storage.saveHandoff({ ...handoff, status: "delivered" });
    console.log(
      chalk.green(`  ✓ Delivered: [${handoff.id.slice(0, 8)}]`),
      chalk.white(handoff.targetAgent),
      chalk.dim("—"),
      chalk.dim(handoff.instruction.split("\n")[0]?.slice(0, 60))
    );
  }

  console.log(chalk.dim(`\n  Queue files written to: ${config.queueDir}\n`));
}

// ─── Render handoff summary ────────────────────────────────────────────────────

export function renderHandoffSummary(handoffs: AgentHandoff[]): string {
  const lines: string[] = [];

  if (handoffs.length === 0) {
    return chalk.dim("  No handoffs created.\n");
  }

  lines.push(chalk.bold.white(`\n  ── Agent Handoffs Created (${handoffs.length}) ──`));

  for (const h of handoffs) {
    const agentConfig = AGENT_DIRECTORY[h.targetAgent];
    const displayName = agentConfig?.displayName ?? h.targetAgent;

    let dateStr = h.createdAt;
    try {
      dateStr = format(parseISO(h.createdAt), "h:mm a");
    } catch {
      // keep raw
    }

    const priorityColors: Record<string, (s: string) => string> = {
      critical: chalk.red,
      high: chalk.yellow,
      medium: chalk.white,
      low: chalk.dim,
    };
    const colorFn = priorityColors[h.priority] ?? chalk.white;

    lines.push(
      `  ${chalk.cyan("→")} ${chalk.bold(displayName)}  ${colorFn(`[${h.priority}]`)}  ${chalk.dim(dateStr)}`
    );

    const instruction = h.instruction.split("\n")[0] ?? h.instruction;
    lines.push(`    ${instruction.slice(0, 80)}`);

    if (h.ticketId) {
      lines.push(`    ${chalk.dim("ticket:")} ${h.ticketId.slice(0, 8)}`);
    }
    if (h.calendarItemId) {
      lines.push(`    ${chalk.dim("content:")} ${h.calendarItemId.slice(0, 8)}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}
