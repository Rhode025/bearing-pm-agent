import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import { format, parseISO } from "date-fns";
import type { Storage } from "./storage.js";
import type { Config } from "./config.js";
import type {
  AgentName,
  ContentType,
  ContentStatus,
  TicketStatus,
  TicketPriority,
} from "./types.js";
import { createTicket, moveTicket, assignTicket } from "./kanban.js";
import {
  createCalendarItem,
  scheduleCalendarItem,
  updateCalendarItem,
} from "./editorial-calendar.js";
import { createInitiative, findInitiativeByKeyword } from "./initiatives.js";
import { logDecision, listDecisions } from "./decision-log.js";
import {
  getActiveSprint,
  getNextSprint,
  getBacklog,
  addToSprint,
  removeFromSprint,
  createSprint,
  listSprints,
} from "./sprints.js";
import {
  readRepoFile,
  listRepoDirectory,
  searchRepoCode,
  getRecentCommits,
  getRepoStructure,
} from "./github.js";
import { runAgent, AGENT_SYSTEM_PROMPTS } from "./agent-runner.js";
import {
  createAgentDefinition,
  listAgentDefinitions,
  deleteAgentDefinition,
} from "./agent-registry.js";

// ─── Conversation history type ────────────────────────────────────────────────

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── Board state builder ──────────────────────────────────────────────────────

export function buildBoardStateString(storage: Storage): string {
  const lines: string[] = [];

  // Active sprint
  const activeSprint = getActiveSprint(storage);
  if (activeSprint) {
    let startStr = activeSprint.startDate;
    let endStr = activeSprint.endDate;
    try {
      startStr = format(parseISO(activeSprint.startDate), "MMM d");
      endStr = format(parseISO(activeSprint.endDate), "MMM d");
    } catch {
      // keep raw
    }
    lines.push(
      `ACTIVE SPRINT: ${activeSprint.name} (${startStr} – ${endStr})`
    );
    if (activeSprint.goal) {
      lines.push(`  Goal: ${activeSprint.goal}`);
    }

    const sprintTickets = activeSprint.ticketIds
      .map((id) => storage.getTicket(id))
      .filter((t) => t !== null);

    lines.push(`Tickets in sprint: ${sprintTickets.length}`);
    for (const t of sprintTickets) {
      const agent = t.assignedAgent ?? "unassigned";
      const blockerNote =
        t.status === "blocked" && t.blockers.length > 0
          ? `: ${t.blockers[0]}`
          : "";
      lines.push(
        `  - [${agent}] ${t.title} [${t.status}${blockerNote}]`
      );
    }
  } else {
    lines.push("ACTIVE SPRINT: none");
  }

  // Next sprint
  const nextSprint = getNextSprint(storage);
  if (nextSprint) {
    lines.push(`\nNEXT SPRINT (planning): ${nextSprint.name}`);
    const nextTickets = nextSprint.ticketIds
      .map((id) => storage.getTicket(id))
      .filter((t) => t !== null);
    if (nextTickets.length > 0) {
      for (const t of nextTickets) {
        lines.push(`  - [${t.assignedAgent ?? "unassigned"}] ${t.title}`);
      }
    }
  }

  // Backlog
  const backlog = getBacklog(storage);
  if (backlog.length > 0) {
    lines.push(`\nBACKLOG (${backlog.length} tickets):`);
    for (const t of backlog.slice(0, 10)) {
      lines.push(
        `  - [${t.assignedAgent ?? "unassigned"}] ${t.title} [${t.status}] (${t.priority})`
      );
    }
    if (backlog.length > 10) {
      lines.push(`  ... and ${backlog.length - 10} more`);
    }
  }

  // Editorial calendar
  const allCalItems = storage.listCalendarItems();
  const scheduled = allCalItems
    .filter((i) => i.status === "scheduled" && i.publishDate)
    .sort((a, b) => (a.publishDate ?? "").localeCompare(b.publishDate ?? ""));
  const ideas = allCalItems.filter(
    (i) => i.status === "idea" || (!i.publishDate && i.status !== "published" && i.status !== "archived")
  );

  lines.push("\nEDITORIAL CALENDAR:");
  if (scheduled.length === 0 && ideas.length === 0) {
    lines.push("  (empty)");
  } else {
    for (const item of scheduled.slice(0, 5)) {
      lines.push(
        `  Scheduled: "${item.title}" → ${item.publishDate}`
      );
    }
    if (ideas.length > 0) {
      lines.push(`  Ideas: ${ideas.length} item${ideas.length !== 1 ? "s" : ""}`);
      for (const item of ideas.slice(0, 3)) {
        lines.push(`    - "${item.title}" (${item.contentType})`);
      }
    }
  }

  // Initiatives
  const initiatives = storage.listInitiatives();
  if (initiatives.length > 0) {
    lines.push("\nINITIATIVES:");
    for (const ini of initiatives) {
      lines.push(`  ${ini.name} [${ini.status}]`);
    }
  }

  // Recent decisions
  const decisions = storage.listDecisions();
  const recentDecisions = decisions.slice(-3).reverse();
  if (recentDecisions.length > 0) {
    lines.push("\nRECENT DECISIONS (last 3):");
    for (const d of recentDecisions) {
      let dateStr = "";
      try {
        dateStr = format(parseISO(d.createdAt), "MMM d");
      } catch {
        dateStr = d.createdAt.slice(0, 10);
      }
      lines.push(`  - ${d.decision} (${dateStr})`);
    }
  }

  return lines.join("\n");
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(storage: Storage): string {
  const boardState = buildBoardStateString(storage);

  const decisions = storage.listDecisions();
  const recentDecisions = decisions
    .slice(-5)
    .reverse()
    .map((d) => {
      let dateStr = "";
      try {
        dateStr = format(parseISO(d.createdAt), "MMM d, yyyy");
      } catch {
        dateStr = d.createdAt.slice(0, 10);
      }
      return `- ${d.decision}${d.rationale ? ` — ${d.rationale}` : ""} (${dateStr})`;
    })
    .join("\n");

  return `You are the BEARING PM Agent — an intelligent project manager for BEARING, a ski trip intelligence platform.

## About BEARING
BEARING is a premium web app (bearingtravel.com) that helps serious skiers make smarter trip decisions. It provides:
- Opportunity Rankings: AI-scored resort conditions across North America and Europe
- Travel Windows: Set recurring or one-time trip windows (e.g. "Presidents Week at Aspen every year"), get automatic fare monitoring, snow condition scoring, and Go Now / Strong Watch / Watch alerts
- Reports: Deep-dive snow and conditions reports per resort
- Journeys: Trip planning and itinerary tracking
- Member Dashboard: Pro and Expedition tier members get personalized intelligence

## Tech stack
- Next.js 14 App Router, TypeScript strict mode, Tailwind CSS
- Supabase (PostgreSQL + auth + RLS)
- Vercel deployment
- Duffel API for flight search
- Cron jobs for Travel Windows pipeline (condition snapshots → fare snapshots → recommendations → alerts)

## Key product areas
1. Travel Windows — the newest major feature. Members set windows, BEARING scores them and fires alerts
2. Dashboard — member home page with opportunity rankings and quick actions
3. Reports — per-resort condition reports
4. Membership — free / pro / expedition tiers
5. Onboarding — sign-up and first-run experience

## Sub-agents
- engineering-agent: backend logic, APIs, database, server actions, cron jobs
- ui-agent: React components, Tailwind styling, layouts, responsive design
- design-agent: visual design, UX review, layout decisions, brand consistency
- qa-agent: test coverage, regression testing, verification
- editorial-agent: articles, blog posts, newsletters, content strategy
- seo-agent: SEO optimization, meta tags, structured data
- research-agent: user research, competitive analysis
- growth-agent: conversion, onboarding, marketing

## BEARING Codebase (Rhode025/bearing)
Key directories:
- app/ — Next.js App Router pages and layouts
  - app/dashboard/ — member dashboard (page.tsx, travel-windows/, etc.)
  - app/login/, app/signup/ — auth pages
  - app/membership/ — membership/upgrade pages
  - app/api/ — API routes (cron, pro, etc.)
- lib/ — shared utilities and business logic
  - lib/travel-windows/ — Travel Windows pipeline (jobs.ts, scoring.ts, types.ts, providers/)
  - lib/supabase/ — Supabase client helpers (server.ts, admin.ts, client.ts)
  - lib/integrations/duffel.ts — Duffel flight search
  - lib/data/airports.ts — airport data and fuzzy search
- components/ — shared React components (airport-combobox.tsx, etc.)
- supabase/migrations/ — SQL migrations

## Recent UX Audit Findings (from automated audit, Mar 27 2026)
High priority:
- POST /dashboard returning 500 errors (console errors on dashboard load)
- /api/pro/opportunity-report returning failed
- Membership upgrade page missing benefit bullets before CTA

Medium priority:
- Missing aria-label on AirportCombobox input and icon-only buttons
- Annual vs one-time window type toggle needs helper text
- Alert count on Travel Windows list doesn't drive action (no inline dismiss)

## How you work
- You receive messages from the product owner (Steven) via Telegram or API
- Messages are often short and informal, sent from a phone
- You interpret intent and create structured work items
- You always respond conversationally and confirm what you did
- You never make up ticket IDs — always reference real data from the board state provided
- You keep responses concise but complete — bullet points over paragraphs
- When something is ambiguous, make a reasonable assumption and state it
- You can read files from the BEARING GitHub repo using read_repo_file
- You can list directories, search code, and view recent commits
- When asked about the codebase, fetch the actual file rather than guessing
- You have access to the PM board AND the actual code — use both
- Today's date is 2026-03-29

## Current board state
${boardState}

## Agent Execution
You can actually RUN agents using dispatch_to_agent. This makes a real Claude API call where the agent reads code, analyzes the problem, and produces concrete output.

Example uses:
- "Have engineering-agent analyze the 500 error on the dashboard" → dispatch_to_agent with engineering-agent
- "Get editorial-agent to draft the fare drop article" → dispatch_to_agent with editorial-agent
- "Create a new conversion-rate-agent to work on membership upgrade flow" → create_agent

When dispatching, give the agent:
- A clear, specific task description
- The relevant ticket ID or title if applicable
- Any additional context that will help

Agent output is stored in the ticket description and the run log. You can retrieve it with get_agent_runs.

## Recent decisions
${recentDecisions || "(none yet)"}`;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "create_ticket",
    description:
      "Create a new ticket on the BEARING kanban board and assign it to the appropriate sub-agent.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Short, clear ticket title" },
        description: {
          type: "string",
          description: "Full description of the work",
        },
        agent: {
          type: "string",
          enum: [
            "engineering-agent",
            "ui-agent",
            "design-agent",
            "qa-agent",
            "editorial-agent",
            "seo-agent",
            "research-agent",
            "growth-agent",
            "pm-agent",
          ],
          description: "Which sub-agent should own this ticket",
        },
        priority: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
        },
        sprint: {
          type: "string",
          enum: ["current", "next", "backlog"],
          description: "Which sprint to place this ticket in",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Relevant tags",
        },
        initiative_keyword: {
          type: "string",
          description:
            "Optional keyword to link to an existing initiative (fuzzy match)",
        },
      },
      required: ["title", "description", "agent", "priority", "sprint", "tags"],
    },
  },
  {
    name: "create_calendar_item",
    description: "Add an item to the editorial calendar.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        content_type: {
          type: "string",
          enum: [
            "article",
            "blog_post",
            "newsletter",
            "landing_page",
            "social_campaign",
            "release_notes",
            "content_refresh",
            "case_study",
            "announcement",
          ],
        },
        publish_date: {
          type: "string",
          description: "ISO date YYYY-MM-DD, optional",
        },
        status: {
          type: "string",
          enum: ["idea", "scheduled", "draft"],
        },
        notes: { type: "string", description: "Optional notes or brief" },
        initiative_keyword: {
          type: "string",
          description: "Optional keyword to link to an existing initiative",
        },
      },
      required: ["title", "content_type", "status"],
    },
  },
  {
    name: "move_ticket",
    description:
      "Move a ticket to a new status. Accepts a ticket UUID or a partial title (fuzzy match).",
    input_schema: {
      type: "object" as const,
      properties: {
        ticket_id_or_title: {
          type: "string",
          description: "UUID or partial ticket title",
        },
        new_status: {
          type: "string",
          enum: [
            "inbox",
            "ready",
            "in_progress",
            "in_review",
            "blocked",
            "done",
            "icebox",
          ],
        },
        blocker: {
          type: "string",
          description:
            "If moving to blocked, describe what is blocking the ticket",
        },
      },
      required: ["ticket_id_or_title", "new_status"],
    },
  },
  {
    name: "assign_ticket",
    description:
      "Reassign a ticket to a different sub-agent. Accepts UUID or partial title.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticket_id_or_title: { type: "string" },
        agent: {
          type: "string",
          enum: [
            "engineering-agent",
            "ui-agent",
            "design-agent",
            "qa-agent",
            "editorial-agent",
            "seo-agent",
            "research-agent",
            "growth-agent",
            "pm-agent",
          ],
        },
      },
      required: ["ticket_id_or_title", "agent"],
    },
  },
  {
    name: "schedule_calendar_item",
    description:
      "Set or update the publish date of a calendar item. Accepts item UUID or partial title.",
    input_schema: {
      type: "object" as const,
      properties: {
        item_id_or_title: { type: "string" },
        publish_date: {
          type: "string",
          description: "ISO date YYYY-MM-DD",
        },
      },
      required: ["item_id_or_title", "publish_date"],
    },
  },
  {
    name: "log_decision",
    description:
      "Record a product or technical decision in the decision log for future reference.",
    input_schema: {
      type: "object" as const,
      properties: {
        decision: {
          type: "string",
          description: "The decision that was made",
        },
        rationale: { type: "string", description: "Why this decision was made" },
        tags: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["decision", "rationale", "tags"],
    },
  },
  {
    name: "create_initiative",
    description:
      "Create a new strategic initiative that groups related tickets and content.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        tags: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["name", "description", "tags"],
    },
  },
  {
    name: "get_board_status",
    description:
      "Return the current board snapshot: active sprint, backlog, and recent activity.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_sprint_status",
    description: "Return detailed info on the active and upcoming sprints.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_editorial_calendar",
    description:
      "Return all scheduled and idea-stage editorial calendar items.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_tickets",
    description:
      "List all tickets with optional filters. Returns full ticket details.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["inbox", "ready", "in_progress", "in_review", "blocked", "done", "icebox"],
          description: "Filter by status",
        },
        agent: {
          type: "string",
          enum: [
            "engineering-agent", "ui-agent", "design-agent", "qa-agent",
            "editorial-agent", "seo-agent", "research-agent", "growth-agent", "pm-agent",
          ],
          description: "Filter by assigned agent",
        },
        priority: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "Filter by priority",
        },
        sprint: {
          type: "string",
          enum: ["current", "next", "backlog", "all"],
          description: "Filter by sprint context",
        },
      },
      required: [],
    },
  },
  {
    name: "update_ticket",
    description:
      "Update fields of an existing ticket. Accepts UUID or partial title.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticket_id_or_title: {
          type: "string",
          description: "UUID or partial ticket title",
        },
        title: { type: "string" },
        description: { type: "string" },
        priority: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
        },
        tags: { type: "array", items: { type: "string" } },
        status: {
          type: "string",
          enum: ["inbox", "ready", "in_progress", "in_review", "blocked", "done", "icebox"],
        },
        agent: {
          type: "string",
          enum: [
            "engineering-agent", "ui-agent", "design-agent", "qa-agent",
            "editorial-agent", "seo-agent", "research-agent", "growth-agent", "pm-agent",
          ],
        },
      },
      required: ["ticket_id_or_title"],
    },
  },
  {
    name: "delete_ticket",
    description:
      "Permanently remove a ticket. Requires explicit confirmation in the tool call.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticket_id_or_title: {
          type: "string",
          description: "UUID or partial ticket title",
        },
        confirm: {
          type: "boolean",
          description: "Must be true to confirm deletion",
        },
      },
      required: ["ticket_id_or_title", "confirm"],
    },
  },
  {
    name: "manage_sprint",
    description:
      "Add or remove a ticket from a sprint, or create a new sprint.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["add", "remove", "create"],
          description: "Action to perform",
        },
        sprint_id_or_name: {
          type: "string",
          description: "Sprint ID or name (for add/remove)",
        },
        ticket_id_or_title: {
          type: "string",
          description: "Ticket ID or partial title (for add/remove)",
        },
        sprint_name: {
          type: "string",
          description: "Name of the new sprint (for create)",
        },
        sprint_goal: {
          type: "string",
          description: "Goal of the new sprint (for create)",
        },
        start_date: {
          type: "string",
          description: "Start date YYYY-MM-DD (for create)",
        },
        end_date: {
          type: "string",
          description: "End date YYYY-MM-DD (for create)",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "update_calendar_item",
    description:
      "Update fields of an existing calendar item. Accepts UUID or partial title.",
    input_schema: {
      type: "object" as const,
      properties: {
        item_id_or_title: {
          type: "string",
          description: "UUID or partial title",
        },
        title: { type: "string" },
        content_type: {
          type: "string",
          enum: [
            "article", "blog_post", "newsletter", "landing_page",
            "social_campaign", "release_notes", "content_refresh", "case_study", "announcement",
          ],
        },
        status: {
          type: "string",
          enum: ["idea", "draft", "in_review", "scheduled", "published", "archived"],
        },
        notes: { type: "string" },
        publish_date: { type: "string", description: "ISO date YYYY-MM-DD" },
        due_date: { type: "string", description: "ISO date YYYY-MM-DD" },
      },
      required: ["item_id_or_title"],
    },
  },
  {
    name: "delete_calendar_item",
    description: "Remove a calendar item.",
    input_schema: {
      type: "object" as const,
      properties: {
        item_id_or_title: {
          type: "string",
          description: "UUID or partial title",
        },
        confirm: {
          type: "boolean",
          description: "Must be true to confirm deletion",
        },
      },
      required: ["item_id_or_title", "confirm"],
    },
  },
  {
    name: "read_repo_file",
    description:
      "Read the content of a file from the BEARING GitHub repository.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "File path, e.g. \"app/dashboard/page.tsx\"",
        },
        repo: {
          type: "string",
          description: "Repository name (default: Rhode025/bearing)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_repo_directory",
    description:
      "List files and subdirectories at a path in the BEARING repo.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Directory path, e.g. \"app/dashboard\" or \"\" for root",
        },
        repo: {
          type: "string",
          description: "Repository name (default: Rhode025/bearing)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "search_repo_code",
    description:
      "Search for code patterns across the BEARING repository.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query, e.g. \"runWindowPipeline\" or \"travel_windows\"",
        },
        repo: {
          type: "string",
          description: "Repository name (default: Rhode025/bearing)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_recent_commits",
    description:
      "Get recent git commits from the BEARING repository.",
    input_schema: {
      type: "object" as const,
      properties: {
        repo: {
          type: "string",
          description: "Repository name (default: Rhode025/bearing)",
        },
        limit: {
          type: "number",
          description: "Number of commits to return (default: 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "list_all_decisions",
    description: "Return all decision log entries.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_all_initiatives",
    description:
      "Return all initiatives with linked ticket and content counts.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "dispatch_to_agent",
    description:
      "Actually run a sub-agent on a task. The agent uses Claude to analyze the ticket, read relevant code, and produce a concrete output. Returns the agent's work product.",
    input_schema: {
      type: "object" as const,
      properties: {
        agent_name: {
          type: "string",
          description: "Name of built-in or custom agent (e.g. engineering-agent)",
        },
        task: {
          type: "string",
          description: "Clear task description for the agent",
        },
        ticket_id_or_title: {
          type: "string",
          description: "Optional: UUID or partial title of a linked ticket",
        },
        context: {
          type: "string",
          description: "Additional context to pass to the agent",
        },
      },
      required: ["agent_name", "task"],
    },
  },
  {
    name: "create_agent",
    description:
      "Define a new agent type with a custom name, system prompt, and capabilities. The agent can then be dispatched to do work.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Unique slug, e.g. \"conversion-agent\"",
        },
        display_name: {
          type: "string",
          description: "Human-readable name",
        },
        description: {
          type: "string",
          description: "What this agent does",
        },
        system_prompt: {
          type: "string",
          description: "Full system prompt for the agent",
        },
        capabilities: {
          type: "array",
          items: { type: "string" },
          description: "List of capabilities/tools this agent has",
        },
      },
      required: ["name", "display_name", "description", "system_prompt", "capabilities"],
    },
  },
  {
    name: "list_agents",
    description:
      "List all available agents (built-in and custom) with their descriptions and recent run counts.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_agent_runs",
    description:
      "Get recent agent run results, optionally filtered by ticket.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticket_id_or_title: {
          type: "string",
          description: "Optional: UUID or partial title of a ticket to filter by",
        },
        limit: {
          type: "number",
          description: "Number of runs to return (default: 5)",
        },
      },
      required: [],
    },
  },
];

// ─── Fuzzy ticket finder ───────────────────────────────────────────────────────

function fuzzyFindTicket(
  storage: Storage,
  idOrTitle: string
): string | null {
  const all = storage.listTickets();

  // Exact UUID match
  const exact = all.find((t) => t.id === idOrTitle);
  if (exact) return exact.id;

  // UUID prefix match
  const prefix = all.find((t) => t.id.startsWith(idOrTitle));
  if (prefix) return prefix.id;

  const needle = idOrTitle.toLowerCase();

  // Exact title match
  const exactTitle = all.find(
    (t) => t.title.toLowerCase() === needle
  );
  if (exactTitle) return exactTitle.id;

  // Substring match
  const sub = all.find((t) => t.title.toLowerCase().includes(needle));
  if (sub) return sub.id;

  // Word overlap scoring
  const needleWords = needle
    .split(/\s+/)
    .filter((w) => w.length > 2);

  let bestId: string | null = null;
  let bestScore = 0;
  for (const t of all) {
    const titleWords = t.title.toLowerCase().split(/\s+/);
    const overlap = needleWords.filter((w) =>
      titleWords.some((tw) => tw.includes(w) || w.includes(tw))
    ).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestId = t.id;
    }
  }

  return bestScore > 0 ? bestId : null;
}

// ─── Fuzzy calendar item finder ───────────────────────────────────────────────

function fuzzyFindCalendarItem(
  storage: Storage,
  idOrTitle: string
): string | null {
  const all = storage.listCalendarItems();

  const exact = all.find((i) => i.id === idOrTitle);
  if (exact) return exact.id;

  const prefix = all.find((i) => i.id.startsWith(idOrTitle));
  if (prefix) return prefix.id;

  const needle = idOrTitle.toLowerCase();
  const exactTitle = all.find(
    (i) => i.title.toLowerCase() === needle
  );
  if (exactTitle) return exactTitle.id;

  const sub = all.find((i) => i.title.toLowerCase().includes(needle));
  if (sub) return sub.id;

  const needleWords = needle.split(/\s+/).filter((w) => w.length > 2);
  let bestId: string | null = null;
  let bestScore = 0;
  for (const item of all) {
    const titleWords = item.title.toLowerCase().split(/\s+/);
    const overlap = needleWords.filter((w) =>
      titleWords.some((tw) => tw.includes(w) || w.includes(tw))
    ).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestId = item.id;
    }
  }

  return bestScore > 0 ? bestId : null;
}

// ─── Tool executor ────────────────────────────────────────────────────────────

export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  storage: Storage,
  config: Config
): Promise<string> {
  try {
    switch (toolName) {
      case "create_ticket": {
        const title = String(toolInput["title"] ?? "");
        const description = String(toolInput["description"] ?? "");
        const agent = (toolInput["agent"] as AgentName) ?? "engineering-agent";
        const priority = (toolInput["priority"] as TicketPriority) ?? "medium";
        const sprintRef = String(toolInput["sprint"] ?? "backlog");
        const tags = (toolInput["tags"] as string[]) ?? [];
        const initiativeKeyword = toolInput["initiative_keyword"]
          ? String(toolInput["initiative_keyword"])
          : undefined;

        // Resolve sprint ID
        let sprintId: string | undefined;
        if (sprintRef === "current") {
          const active = getActiveSprint(storage);
          sprintId = active?.id;
        } else if (sprintRef === "next") {
          const next = getNextSprint(storage);
          sprintId = next?.id;
        }

        // Resolve initiative ID
        let initiativeId: string | undefined;
        if (initiativeKeyword) {
          const ini = findInitiativeByKeyword(storage, initiativeKeyword);
          initiativeId = ini?.id;
        }

        const ticket = createTicket(storage, {
          title,
          description,
          assignedAgent: agent,
          priority,
          status: "inbox",
          tags,
          sprintId,
          initiativeId,
          sourceChannel: "telegram",
        });

        return JSON.stringify({
          ok: true,
          action: "create_ticket",
          ticket_id: ticket.id,
          title: ticket.title,
          agent: ticket.assignedAgent,
          sprint: sprintRef,
          priority: ticket.priority,
        });
      }

      case "create_calendar_item": {
        const title = String(toolInput["title"] ?? "");
        const contentType = (toolInput["content_type"] as ContentType) ?? "article";
        const publishDate = toolInput["publish_date"]
          ? String(toolInput["publish_date"])
          : undefined;
        const status = (toolInput["status"] as "idea" | "scheduled" | "draft") ?? "idea";
        const notes = toolInput["notes"] ? String(toolInput["notes"]) : undefined;
        const initiativeKeyword = toolInput["initiative_keyword"]
          ? String(toolInput["initiative_keyword"])
          : undefined;

        let initiativeId: string | undefined;
        if (initiativeKeyword) {
          const ini = findInitiativeByKeyword(storage, initiativeKeyword);
          initiativeId = ini?.id;
        }

        const item = createCalendarItem(storage, {
          title,
          contentType,
          publishDate,
          status: publishDate ? "scheduled" : status,
          notes,
          initiativeId,
          sourceChannel: "telegram",
        });

        return JSON.stringify({
          ok: true,
          action: "create_calendar_item",
          item_id: item.id,
          title: item.title,
          content_type: item.contentType,
          publish_date: item.publishDate ?? null,
          status: item.status,
        });
      }

      case "move_ticket": {
        const idOrTitle = String(toolInput["ticket_id_or_title"] ?? "");
        const newStatus = (toolInput["new_status"] as TicketStatus);
        const blocker = toolInput["blocker"]
          ? String(toolInput["blocker"])
          : undefined;

        const ticketId = fuzzyFindTicket(storage, idOrTitle);
        if (!ticketId) {
          return JSON.stringify({
            ok: false,
            error: `No ticket found matching: "${idOrTitle}"`,
          });
        }

        if (newStatus === "blocked" && blocker) {
          // Add blocker text directly via updateTicket
          const ticket = storage.getTicket(ticketId);
          if (ticket) {
            storage.updateTicket(ticketId, {
              status: "blocked",
              blockers: [...ticket.blockers, blocker],
            });
          }
          const updated = storage.getTicket(ticketId);
          return JSON.stringify({
            ok: true,
            action: "move_ticket",
            ticket_id: ticketId,
            title: updated?.title,
            new_status: "blocked",
            blocker,
          });
        }

        const ticket = moveTicket(storage, ticketId, newStatus);
        return JSON.stringify({
          ok: true,
          action: "move_ticket",
          ticket_id: ticket.id,
          title: ticket.title,
          new_status: ticket.status,
        });
      }

      case "assign_ticket": {
        const idOrTitle = String(toolInput["ticket_id_or_title"] ?? "");
        const agent = (toolInput["agent"] as AgentName);

        const ticketId = fuzzyFindTicket(storage, idOrTitle);
        if (!ticketId) {
          return JSON.stringify({
            ok: false,
            error: `No ticket found matching: "${idOrTitle}"`,
          });
        }

        const ticket = assignTicket(storage, ticketId, agent);
        return JSON.stringify({
          ok: true,
          action: "assign_ticket",
          ticket_id: ticket.id,
          title: ticket.title,
          agent,
        });
      }

      case "schedule_calendar_item": {
        const idOrTitle = String(toolInput["item_id_or_title"] ?? "");
        const publishDate = String(toolInput["publish_date"] ?? "");

        const itemId = fuzzyFindCalendarItem(storage, idOrTitle);
        if (!itemId) {
          return JSON.stringify({
            ok: false,
            error: `No calendar item found matching: "${idOrTitle}"`,
          });
        }

        const item = scheduleCalendarItem(storage, itemId, publishDate);
        return JSON.stringify({
          ok: true,
          action: "schedule_calendar_item",
          item_id: item.id,
          title: item.title,
          publish_date: item.publishDate,
        });
      }

      case "log_decision": {
        const decision = String(toolInput["decision"] ?? "");
        const rationale = String(toolInput["rationale"] ?? "");
        const tags = (toolInput["tags"] as string[]) ?? [];

        const entry = logDecision(storage, {
          decision,
          rationale,
          tags,
          madeBy: "pm (via Claude)",
          channel: "telegram",
        });

        return JSON.stringify({
          ok: true,
          action: "log_decision",
          id: entry.id,
          decision: entry.decision,
        });
      }

      case "create_initiative": {
        const name = String(toolInput["name"] ?? "");
        const description = String(toolInput["description"] ?? "");
        const tags = (toolInput["tags"] as string[]) ?? [];

        const initiative = createInitiative(storage, { name, description, tags });
        return JSON.stringify({
          ok: true,
          action: "create_initiative",
          initiative_id: initiative.id,
          name: initiative.name,
        });
      }

      case "get_board_status": {
        return JSON.stringify({
          ok: true,
          board_state: buildBoardStateString(storage),
        });
      }

      case "get_sprint_status": {
        const active = getActiveSprint(storage);
        const next = getNextSprint(storage);
        const backlog = getBacklog(storage);

        const activeInfo = active
          ? {
              id: active.id,
              name: active.name,
              start: active.startDate,
              end: active.endDate,
              goal: active.goal,
              ticket_count: active.ticketIds.length,
              tickets: active.ticketIds
                .map((id) => storage.getTicket(id))
                .filter(Boolean)
                .map((t) => ({
                  id: t!.id,
                  title: t!.title,
                  status: t!.status,
                  agent: t!.assignedAgent,
                })),
            }
          : null;

        return JSON.stringify({
          ok: true,
          active_sprint: activeInfo,
          next_sprint: next
            ? { id: next.id, name: next.name, start: next.startDate }
            : null,
          backlog_count: backlog.length,
        });
      }

      case "get_editorial_calendar": {
        const items = storage.listCalendarItems();
        return JSON.stringify({
          ok: true,
          items: items.map((i) => ({
            id: i.id,
            title: i.title,
            content_type: i.contentType,
            status: i.status,
            publish_date: i.publishDate,
          })),
        });
      }

      case "list_tickets": {
        const statusFilter = toolInput["status"] as TicketStatus | undefined;
        const agentFilter = toolInput["agent"] as AgentName | undefined;
        const priorityFilter = toolInput["priority"] as TicketPriority | undefined;
        const sprintFilter = toolInput["sprint"] as string | undefined;

        let tickets = storage.listTickets();

        // Apply filters
        if (statusFilter) {
          tickets = tickets.filter((t) => t.status === statusFilter);
        }
        if (agentFilter) {
          tickets = tickets.filter((t) => t.assignedAgent === agentFilter);
        }
        if (priorityFilter) {
          tickets = tickets.filter((t) => t.priority === priorityFilter);
        }
        if (sprintFilter && sprintFilter !== "all") {
          if (sprintFilter === "current") {
            const active = getActiveSprint(storage);
            const ids = new Set(active?.ticketIds ?? []);
            tickets = tickets.filter((t) => ids.has(t.id));
          } else if (sprintFilter === "next") {
            const next = getNextSprint(storage);
            const ids = new Set(next?.ticketIds ?? []);
            tickets = tickets.filter((t) => ids.has(t.id));
          } else if (sprintFilter === "backlog") {
            tickets = tickets.filter((t) => !t.sprintId);
          }
        }

        return JSON.stringify({
          ok: true,
          count: tickets.length,
          tickets: tickets.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            agent: t.assignedAgent,
            priority: t.priority,
            sprint_id: t.sprintId,
            tags: t.tags,
            blockers: t.blockers,
            created_at: t.createdAt,
          })),
        });
      }

      case "update_ticket": {
        const idOrTitle = String(toolInput["ticket_id_or_title"] ?? "");
        const ticketId = fuzzyFindTicket(storage, idOrTitle);
        if (!ticketId) {
          return JSON.stringify({
            ok: false,
            error: `No ticket found matching: "${idOrTitle}"`,
          });
        }

        const updates: Record<string, unknown> = {};
        if (toolInput["title"] !== undefined) updates["title"] = String(toolInput["title"]);
        if (toolInput["description"] !== undefined) updates["description"] = String(toolInput["description"]);
        if (toolInput["priority"] !== undefined) updates["priority"] = toolInput["priority"] as TicketPriority;
        if (toolInput["tags"] !== undefined) updates["tags"] = toolInput["tags"] as string[];

        if (toolInput["agent"] !== undefined) {
          assignTicket(storage, ticketId, toolInput["agent"] as AgentName);
        }
        if (toolInput["status"] !== undefined) {
          moveTicket(storage, ticketId, toolInput["status"] as TicketStatus);
        }
        if (Object.keys(updates).length > 0) {
          storage.updateTicket(ticketId, updates as Partial<Parameters<typeof storage.updateTicket>[1]>);
        }

        const updated = storage.getTicket(ticketId);
        return JSON.stringify({
          ok: true,
          action: "update_ticket",
          ticket_id: ticketId,
          title: updated?.title,
          status: updated?.status,
          agent: updated?.assignedAgent,
          priority: updated?.priority,
        });
      }

      case "delete_ticket": {
        const confirm = toolInput["confirm"];
        if (confirm !== true) {
          return JSON.stringify({
            ok: false,
            error: "Deletion requires confirm: true",
          });
        }
        const idOrTitle = String(toolInput["ticket_id_or_title"] ?? "");
        const ticketId = fuzzyFindTicket(storage, idOrTitle);
        if (!ticketId) {
          return JSON.stringify({
            ok: false,
            error: `No ticket found matching: "${idOrTitle}"`,
          });
        }
        const ticket = storage.getTicket(ticketId);
        storage.deleteTicket(ticketId);
        return JSON.stringify({
          ok: true,
          action: "delete_ticket",
          ticket_id: ticketId,
          title: ticket?.title,
        });
      }

      case "manage_sprint": {
        const action = String(toolInput["action"] ?? "");

        if (action === "create") {
          const name = String(toolInput["sprint_name"] ?? "New Sprint");
          const goal = toolInput["sprint_goal"] ? String(toolInput["sprint_goal"]) : undefined;
          const startDate = String(toolInput["start_date"] ?? new Date().toISOString().slice(0, 10));
          const endDate = String(toolInput["end_date"] ?? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
          const sprint = createSprint(storage, { name, goal, startDate, endDate });
          return JSON.stringify({
            ok: true,
            action: "create_sprint",
            sprint_id: sprint.id,
            name: sprint.name,
          });
        }

        if (action === "add" || action === "remove") {
          const ticketIdOrTitle = String(toolInput["ticket_id_or_title"] ?? "");
          const ticketId = fuzzyFindTicket(storage, ticketIdOrTitle);
          if (!ticketId) {
            return JSON.stringify({
              ok: false,
              error: `No ticket found matching: "${ticketIdOrTitle}"`,
            });
          }

          // Resolve sprint
          let sprintId: string | null = null;
          const sprintIdOrName = toolInput["sprint_id_or_name"]
            ? String(toolInput["sprint_id_or_name"])
            : null;

          if (sprintIdOrName) {
            const allSprints = listSprints(storage);
            // Try exact ID first
            const byId = allSprints.find((s) => s.id === sprintIdOrName);
            if (byId) {
              sprintId = byId.id;
            } else {
              // Try name match
              const needle = sprintIdOrName.toLowerCase();
              const byName = allSprints.find((s) =>
                s.name.toLowerCase().includes(needle)
              );
              if (byName) sprintId = byName.id;
            }
          }

          if (!sprintId) {
            // Default to current sprint for "add", find which sprint for "remove"
            if (action === "add") {
              const active = getActiveSprint(storage);
              sprintId = active?.id ?? null;
            } else {
              // Find the sprint that contains this ticket
              const allSprints = listSprints(storage);
              const containing = allSprints.find((s) =>
                s.ticketIds.includes(ticketId)
              );
              sprintId = containing?.id ?? null;
            }
          }

          if (!sprintId) {
            return JSON.stringify({
              ok: false,
              error: action === "add"
                ? "No active sprint found to add ticket to"
                : "Ticket is not in any sprint",
            });
          }

          if (action === "add") {
            addToSprint(storage, sprintId, ticketId);
            return JSON.stringify({
              ok: true,
              action: "add_to_sprint",
              ticket_id: ticketId,
              sprint_id: sprintId,
            });
          } else {
            removeFromSprint(storage, sprintId, ticketId);
            return JSON.stringify({
              ok: true,
              action: "remove_from_sprint",
              ticket_id: ticketId,
              sprint_id: sprintId,
            });
          }
        }

        return JSON.stringify({ ok: false, error: `Unknown manage_sprint action: "${action}"` });
      }

      case "update_calendar_item": {
        const idOrTitle = String(toolInput["item_id_or_title"] ?? "");
        const itemId = fuzzyFindCalendarItem(storage, idOrTitle);
        if (!itemId) {
          return JSON.stringify({
            ok: false,
            error: `No calendar item found matching: "${idOrTitle}"`,
          });
        }

        const updates: Partial<import("./types.js").EditorialCalendarItem> = {};
        if (toolInput["title"] !== undefined) updates.title = String(toolInput["title"]);
        if (toolInput["content_type"] !== undefined) updates.contentType = toolInput["content_type"] as ContentType;
        if (toolInput["status"] !== undefined) updates.status = toolInput["status"] as ContentStatus;
        if (toolInput["notes"] !== undefined) updates.notes = String(toolInput["notes"]);
        if (toolInput["publish_date"] !== undefined) updates.publishDate = String(toolInput["publish_date"]);
        if (toolInput["due_date"] !== undefined) updates.dueDate = String(toolInput["due_date"]);

        const updated = updateCalendarItem(storage, itemId, updates);
        return JSON.stringify({
          ok: true,
          action: "update_calendar_item",
          item_id: itemId,
          title: updated.title,
          status: updated.status,
          publish_date: updated.publishDate,
        });
      }

      case "delete_calendar_item": {
        const confirm = toolInput["confirm"];
        if (confirm !== true) {
          return JSON.stringify({
            ok: false,
            error: "Deletion requires confirm: true",
          });
        }
        const idOrTitle = String(toolInput["item_id_or_title"] ?? "");
        const itemId = fuzzyFindCalendarItem(storage, idOrTitle);
        if (!itemId) {
          return JSON.stringify({
            ok: false,
            error: `No calendar item found matching: "${idOrTitle}"`,
          });
        }
        const item = storage.getCalendarItem(itemId);
        // Archive the item (soft delete)
        storage.updateCalendarItem(itemId, { status: "archived" });
        return JSON.stringify({
          ok: true,
          action: "delete_calendar_item",
          item_id: itemId,
          title: item?.title,
          note: "Item archived (status set to archived)",
        });
      }

      case "read_repo_file": {
        if (!config.githubToken) {
          return JSON.stringify({
            ok: false,
            error: "GITHUB_TOKEN is not configured. Set it in .env to read repo files.",
          });
        }
        const filePath = String(toolInput["path"] ?? "");
        const repo = toolInput["repo"] ? String(toolInput["repo"]) : config.githubRepo;
        const content = await readRepoFile(config.githubToken, repo, filePath);
        return JSON.stringify({
          ok: true,
          repo,
          path: filePath,
          content,
        });
      }

      case "list_repo_directory": {
        if (!config.githubToken) {
          return JSON.stringify({
            ok: false,
            error: "GITHUB_TOKEN is not configured. Set it in .env to browse the repo.",
          });
        }
        const dirPath = String(toolInput["path"] ?? "");
        const repo = toolInput["repo"] ? String(toolInput["repo"]) : config.githubRepo;
        const files = await listRepoDirectory(config.githubToken, repo, dirPath);
        return JSON.stringify({
          ok: true,
          repo,
          path: dirPath,
          files,
        });
      }

      case "search_repo_code": {
        if (!config.githubToken) {
          return JSON.stringify({
            ok: false,
            error: "GITHUB_TOKEN is not configured. Set it in .env to search code.",
          });
        }
        const query = String(toolInput["query"] ?? "");
        const repo = toolInput["repo"] ? String(toolInput["repo"]) : config.githubRepo;
        const results = await searchRepoCode(config.githubToken, repo, query);
        return JSON.stringify({
          ok: true,
          repo,
          query,
          results,
        });
      }

      case "get_recent_commits": {
        if (!config.githubToken) {
          return JSON.stringify({
            ok: false,
            error: "GITHUB_TOKEN is not configured. Set it in .env to view commits.",
          });
        }
        const repo = toolInput["repo"] ? String(toolInput["repo"]) : config.githubRepo;
        const limit = toolInput["limit"] ? Number(toolInput["limit"]) : 10;
        const commits = await getRecentCommits(config.githubToken, repo, limit);
        return JSON.stringify({
          ok: true,
          repo,
          commits,
        });
      }

      case "list_all_decisions": {
        const decisions = listDecisions(storage);
        return JSON.stringify({
          ok: true,
          count: decisions.length,
          decisions: decisions.map((d) => ({
            id: d.id,
            decision: d.decision,
            rationale: d.rationale,
            tags: d.tags,
            made_by: d.madeBy,
            created_at: d.createdAt,
          })),
        });
      }

      case "list_all_initiatives": {
        const initiatives = storage.listInitiatives();
        return JSON.stringify({
          ok: true,
          count: initiatives.length,
          initiatives: initiatives.map((ini) => ({
            id: ini.id,
            name: ini.name,
            description: ini.description,
            status: ini.status,
            ticket_count: ini.ticketIds.length,
            content_count: ini.calendarItemIds.length,
            tags: ini.tags,
            target_date: ini.targetDate,
          })),
        });
      }

      case "dispatch_to_agent": {
        const agentName = String(toolInput["agent_name"] ?? "engineering-agent");
        const task = String(toolInput["task"] ?? "");
        const ticketIdOrTitle = toolInput["ticket_id_or_title"]
          ? String(toolInput["ticket_id_or_title"])
          : undefined;
        const extraContext = toolInput["context"]
          ? String(toolInput["context"])
          : "";

        // Build context from ticket if provided
        let context = extraContext;
        let ticketId: string | undefined;
        if (ticketIdOrTitle) {
          ticketId = fuzzyFindTicket(storage, ticketIdOrTitle) ?? undefined;
          if (ticketId) {
            const ticket = storage.getTicket(ticketId);
            if (ticket) {
              context = `Ticket: ${ticket.title}\nDescription: ${ticket.description}\nPriority: ${ticket.priority}\nTags: ${ticket.tags.join(", ")}\n\n${extraContext}`;
            }
          }
        }

        // Get custom system prompt if this is a custom agent
        const customDef = storage.getAgentDefinition(agentName);
        const customSystemPrompt =
          customDef && !customDef.isBuiltIn ? customDef.systemPrompt : undefined;

        // Save run record
        const runId = uuidv4();
        const startTime = Date.now();
        storage.saveAgentRun({
          id: runId,
          ticketId,
          agentName,
          task,
          status: "running",
          nextSteps: [],
          toolsUsed: [],
          createdAt: new Date().toISOString(),
        });

        // Run the agent
        const result = await runAgent(
          agentName,
          task,
          context,
          storage,
          config,
          customSystemPrompt
        );

        // Update run record
        storage.updateAgentRun(runId, {
          output: result.output,
          nextSteps: result.nextSteps,
          blocker: result.blocker,
          needsClarification: result.needsClarification,
          toolsUsed: result.toolsUsed,
          durationMs: result.durationMs,
          status: result.blocker
            ? "blocked"
            : result.needsClarification
            ? "needs_clarification"
            : "completed",
          completedAt: new Date().toISOString(),
        });

        // Update ticket if linked
        if (ticketId) {
          const ticket = storage.getTicket(ticketId);
          if (ticket) {
            const newDescription = `${ticket.description ?? ""}\n\n---\n**${agentName} output (${new Date().toLocaleDateString()}):**\n${result.output}`;
            storage.updateTicket(ticketId, {
              description: newDescription,
              status: result.blocker ? "blocked" : "in_review",
              blockers: result.blocker
                ? [...ticket.blockers, result.blocker]
                : ticket.blockers,
            });
          }
        }

        console.log(
          `  [claude] ${agentName} completed in ${result.durationMs}ms, tools: ${result.toolsUsed.join(", ") || "none"}`
        );

        return JSON.stringify({
          ok: true,
          action: "dispatch_to_agent",
          agent: agentName,
          run_id: runId,
          duration_ms: result.durationMs,
          summary: result.taskSummary,
          output: result.output.slice(0, 2000),
          next_steps: result.nextSteps,
          blocker: result.blocker ?? null,
          needs_clarification: result.needsClarification ?? null,
          tools_used: result.toolsUsed,
        });
      }

      case "create_agent": {
        const name = String(toolInput["name"] ?? "");
        const displayName = String(toolInput["display_name"] ?? "");
        const description = String(toolInput["description"] ?? "");
        const systemPrompt = String(toolInput["system_prompt"] ?? "");
        const capabilities = (toolInput["capabilities"] as string[]) ?? [];

        if (!name) {
          return JSON.stringify({ ok: false, error: "Agent name is required" });
        }

        // Don't overwrite built-ins
        if (AGENT_SYSTEM_PROMPTS[name]) {
          return JSON.stringify({
            ok: false,
            error: `"${name}" is a built-in agent and cannot be redefined`,
          });
        }

        const def = createAgentDefinition(storage, {
          name,
          displayName,
          description,
          systemPrompt,
          capabilities,
        });

        return JSON.stringify({
          ok: true,
          action: "create_agent",
          agent_id: def.id,
          name: def.name,
          display_name: def.displayName,
          description: def.description,
        });
      }

      case "list_agents": {
        const allDefs = listAgentDefinitions(storage);
        const allRuns = storage.listAgentRuns();

        // Count runs per agent
        const runCounts: Record<string, number> = {};
        for (const run of allRuns) {
          runCounts[run.agentName] = (runCounts[run.agentName] ?? 0) + 1;
        }

        return JSON.stringify({
          ok: true,
          count: allDefs.length,
          agents: allDefs.map((def) => ({
            name: def.name,
            display_name: def.displayName,
            description: def.description,
            is_built_in: def.isBuiltIn,
            capabilities: def.capabilities,
            recent_runs: runCounts[def.name] ?? 0,
          })),
        });
      }

      case "get_agent_runs": {
        const ticketIdOrTitle = toolInput["ticket_id_or_title"]
          ? String(toolInput["ticket_id_or_title"])
          : undefined;
        const limit = toolInput["limit"] ? Number(toolInput["limit"]) : 5;

        let ticketId: string | undefined;
        if (ticketIdOrTitle) {
          ticketId = fuzzyFindTicket(storage, ticketIdOrTitle) ?? undefined;
        }

        const runs = storage.listAgentRuns(ticketId);
        const limited = runs.slice(0, limit);

        return JSON.stringify({
          ok: true,
          count: limited.length,
          runs: limited.map((r) => ({
            id: r.id,
            agent: r.agentName,
            task: r.task,
            status: r.status,
            summary: r.output ? r.output.slice(0, 300) : null,
            next_steps: r.nextSteps,
            blocker: r.blocker ?? null,
            needs_clarification: r.needsClarification ?? null,
            tools_used: r.toolsUsed,
            duration_ms: r.durationMs ?? null,
            ticket_id: r.ticketId ?? null,
            created_at: r.createdAt,
            completed_at: r.completedAt ?? null,
          })),
        });
      }

      default:
        return JSON.stringify({ ok: false, error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Main export: claudePMChat ────────────────────────────────────────────────

export async function claudePMChat(
  message: string,
  storage: Storage,
  config: Config,
  conversationHistory: ConversationMessage[]
): Promise<{ reply: string; toolsExecuted: string[] }> {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const systemPrompt = buildSystemPrompt(storage);
  const toolsExecuted: string[] = [];

  // Build message array for the API
  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: message },
  ];

  try {
    // First call
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    // Check for tool use
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      // No tools called — extract text directly
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      return {
        reply: textBlock?.text ?? "Done.",
        toolsExecuted: [],
      };
    }

    // Execute all tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      const toolInput = toolUse.input as Record<string, unknown>;
      console.log(`  [claude] executing tool: ${toolUse.name}`);
      const result = await executeToolCall(toolUse.name, toolInput, storage, config);
      toolsExecuted.push(toolUse.name);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    // Second call with tool results
    const followUpMessages: Anthropic.MessageParam[] = [
      ...messages,
      { role: "assistant" as const, content: response.content },
      { role: "user" as const, content: toolResults },
    ];

    const finalResponse = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: systemPrompt,
      tools: TOOLS,
      messages: followUpMessages,
    });

    const finalText = finalResponse.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );

    console.log(
      `  [claude] executed: ${toolsExecuted.join(", ")}`
    );

    return {
      reply: finalText?.text ?? "Done.",
      toolsExecuted,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`  [claude] API error: ${errMsg}`);
    throw err;
  }
}
