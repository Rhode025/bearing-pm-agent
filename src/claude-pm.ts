import Anthropic from "@anthropic-ai/sdk";
import { format, parseISO } from "date-fns";
import type { Storage } from "./storage.js";
import type { Config } from "./config.js";
import type {
  AgentName,
  ContentType,
  TicketStatus,
  TicketPriority,
} from "./types.js";
import { createTicket, moveTicket, assignTicket } from "./kanban.js";
import {
  createCalendarItem,
  scheduleCalendarItem,
} from "./editorial-calendar.js";
import { createInitiative, findInitiativeByKeyword } from "./initiatives.js";
import { logDecision } from "./decision-log.js";
import { getActiveSprint, getNextSprint, getBacklog } from "./sprints.js";

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

## How you work
- You receive messages from the product owner (Steven) via Telegram or API
- Messages are often short and informal, sent from a phone
- You interpret intent and create structured work items
- You always respond conversationally and confirm what you did
- You never make up ticket IDs — always reference real data from the board state provided
- You keep responses concise but complete — bullet points over paragraphs
- When something is ambiguous, make a reasonable assumption and state it

## Current board state
${boardState}

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

export function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  storage: Storage,
  config: Config
): string {
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
      const result = executeToolCall(toolUse.name, toolInput, storage, config);
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
