import { v4 as uuidv4 } from "uuid";
import chalk from "chalk";
import type {
  MessageChannel,
  IngestResult,
  ParsedIntent,
  AgentHandoff,
  Ticket,
  EditorialCalendarItem,
  Sprint,
  Initiative,
  DecisionLogEntry,
  TicketStatus,
  ContentType,
} from "./types.js";
import type { Storage } from "./storage.js";
import type { Config } from "./config.js";
import { parseMessage, resolveEntityReferences, normalizeText } from "./parser.js";
import type { ParseResult } from "./types.js";
import { createTicket, moveTicket, assignTicket, addBlocker } from "./kanban.js";
import { createCalendarItem, scheduleCalendarItem, updateCalendarItem } from "./editorial-calendar.js";
import { getActiveSprint, getNextSprint, addToSprint, ensureDefaultSprints } from "./sprints.js";
import { createInitiative, findInitiativeByKeyword, linkTicketToInitiative, linkCalendarItemToInitiative } from "./initiatives.js";
import { logDecision } from "./decision-log.js";
import { routeTicket, routeCalendarItem } from "./router.js";
import { createHandoff, emitHandoff } from "./agent-handoff.js";
import { renderBoard } from "./kanban.js";

// ─── Empty result factory ──────────────────────────────────────────────────────

function emptyResult(): IngestResult {
  return {
    ticketsCreated: [],
    ticketsUpdated: [],
    calendarItemsCreated: [],
    calendarItemsUpdated: [],
    sprintsCreated: [],
    initiativesCreated: [],
    decisionsLogged: [],
    handoffsCreated: [],
    statusReport: null,
    messages: [],
    warnings: [],
  };
}

// ─── Intent execution ──────────────────────────────────────────────────────────

export function executeIntents(
  parsed: ParseResult,
  storage: Storage,
  config: Config
): IngestResult {
  const result = emptyResult();
  const { intents, entities } = parsed;

  // Ensure sprints exist
  ensureDefaultSprints(storage);

  // ── request_status ────────────────────────────────────────────────────────
  if (intents.includes("request_status")) {
    result.statusReport = renderBoard(storage);
    result.messages.push("Generated board status report.");
  }

  // ── request_summary ───────────────────────────────────────────────────────
  if (intents.includes("request_summary")) {
    result.statusReport = renderBoard(storage);
    result.messages.push("Generated summary report.");
  }

  // ── log_decision ──────────────────────────────────────────────────────────
  if (intents.includes("log_decision") || intents.includes("create_initiative")) {
    if (entities.initiatives.length > 0) {
      for (const initiativeName of entities.initiatives) {
        // Avoid duplicate initiatives
        const existing = findInitiativeByKeyword(storage, initiativeName);
        if (!existing) {
          const initiative = createInitiative(storage, {
            name: initiativeName,
            description: `Initiative derived from: "${parsed.raw}"`,
            tags: entities.tags,
          });
          result.initiativesCreated.push(initiative);
          result.messages.push(`Created initiative: "${initiative.name}"`);
        } else {
          result.messages.push(`Initiative already exists: "${existing.name}"`);
        }
      }

      // Log the decision
      const decisionText = parsed.raw.length > 120
        ? parsed.raw.slice(0, 120) + "..."
        : parsed.raw;

      const decision = logDecision(storage, {
        decision: `Focus area: ${entities.initiatives.join(", ")}`,
        rationale: decisionText,
        context: `Ingested from ${parsed.raw}`,
        madeBy: "pm",
        tags: entities.tags,
      });
      result.decisionsLogged.push(decision);
      result.messages.push(`Logged decision: "${decision.decision}"`);
    } else if (intents.includes("log_decision")) {
      // Log as a plain decision
      const decision = logDecision(storage, {
        decision: parsed.normalized,
        rationale: "",
        context: parsed.raw,
        madeBy: "pm",
        tags: entities.tags,
      });
      result.decisionsLogged.push(decision);
      result.messages.push("Logged decision.");
    }
  }

  // ── create_calendar_item / schedule_calendar_item ─────────────────────────
  if (
    intents.includes("create_calendar_item") ||
    intents.includes("schedule_calendar_item")
  ) {
    // For "put the fare drop article on the calendar for May 14" style messages:
    // first try to find an existing item by fuzzy keyword search, then create new.
    const publishDate = entities.resolvedDates[0] ?? undefined;

    // Resolve initiative context
    let initiativeId: string | null = null;
    if (entities.initiatives.length > 0 && entities.initiatives[0]) {
      const ini = findInitiativeByKeyword(storage, entities.initiatives[0]);
      initiativeId = ini?.id ?? null;
    }

    // Check if this is purely a scheduling operation on an existing item
    // Pattern: "put [article name] on the calendar for [date]"
    const pureSchedulePattern = /put\s+(?:the\s+)?(.+?)\s+on\s+(?:the\s+)?calendar\s+for\s+/i;
    const pureScheduleMatch = pureSchedulePattern.exec(parsed.normalized);

    if (
      intents.includes("schedule_calendar_item") &&
      pureScheduleMatch &&
      pureScheduleMatch[1] &&
      publishDate
    ) {
      const keyword = pureScheduleMatch[1].trim();
      // Search for existing item matching the keyword
      const allItems = storage.listCalendarItems();
      const existingItem = allItems.find(ci => {
        const titleLower = ci.title.toLowerCase();
        const keyLower = keyword.toLowerCase();
        // Check for substantial overlap
        const keyWords = keyLower.split(/\s+/).filter(w => w.length > 3);
        return keyWords.filter(w => titleLower.includes(w)).length >= Math.min(2, keyWords.length);
      });

      if (existingItem) {
        // Schedule the existing item
        const updated = scheduleCalendarItem(storage, existingItem.id, publishDate);
        result.calendarItemsUpdated.push(updated);
        result.messages.push(
          `Scheduled "${existingItem.title}" for ${publishDate}`
        );
        // existingItem was found — skip create block below
      } else {
        // Create new item with the keyword as title
        const contentType: ContentType = entities.contentTypes[0] ?? "article";
        // Filter out "calendar" as a title word
        const cleanTitle = keyword
          .replace(/\s+on\s+(?:the\s+)?calendar.*/i, "")
          .replace(/^the\s+/i, "")
          .trim();

        if (cleanTitle.length > 3) {
          const item = createCalendarItem(storage, {
            title: cleanTitle,
            contentType,
            publishDate,
            status: "scheduled",
            tags: entities.tags,
            initiativeId: initiativeId ?? undefined,
            sourceChannel: "cli",
          });
          result.calendarItemsCreated.push(item);
          result.messages.push(
            `Created ${contentType.replace("_", " ")}: "${cleanTitle}" → scheduled ${publishDate}`
          );
          const handoff = createHandoff(item, storage);
          emitHandoff(handoff, "stdout", config);
          result.handoffsCreated.push(handoff);
        }
      }
    } else {
      // Standard creation path
      const titles = entities.contentTitles.length > 0
        ? entities.contentTitles
        : entities.ticketTitles;

      // If multiple content types detected with one title, create one item per content type
      const contentTypesToCreate = entities.contentTypes.length > 0
        ? entities.contentTypes
        : (["article"] as ContentType[]);

      const skipWords = new Set(["the calendar", "calendar", "it", "that", "this", "them"]);

      // If we have multiple content types (e.g. release_notes + blog_post) and one title,
      // create one item per type
      if (contentTypesToCreate.length > 1 && titles.length === 1 && titles[0]) {
        const baseTitle = titles[0];
        for (const ct of contentTypesToCreate) {
          const titleForType = ct === "release_notes"
            ? `Release notes: ${baseTitle}`
            : ct === "blog_post"
            ? `Blog post: ${baseTitle}`
            : baseTitle;

          const allItems = storage.listCalendarItems();
          const existing = allItems.find(ci =>
            ci.title.toLowerCase() === titleForType.toLowerCase()
          );
          if (existing) {
            if (publishDate) {
              const updated = scheduleCalendarItem(storage, existing.id, publishDate);
              result.calendarItemsUpdated.push(updated);
              result.messages.push(`Scheduled "${existing.title}" for ${publishDate}`);
            } else {
              result.warnings.push(`Already exists: "${existing.title}" — skipping.`);
            }
            continue;
          }

          const item = createCalendarItem(storage, {
            title: titleForType,
            contentType: ct,
            publishDate,
            status: publishDate ? "scheduled" : "idea",
            tags: entities.tags,
            initiativeId: initiativeId ?? undefined,
            sourceChannel: "cli",
          });
          result.calendarItemsCreated.push(item);
          result.messages.push(
            `Created ${ct.replace("_", " ")}: "${titleForType}"` +
              (publishDate ? ` → scheduled ${publishDate}` : " → idea backlog")
          );
          const handoff = createHandoff(item, storage);
          emitHandoff(handoff, "stdout", config);
          result.handoffsCreated.push(handoff);
          if (initiativeId) {
            linkCalendarItemToInitiative(storage, initiativeId, item.id);
          }
        }
      } else {
        const contentType: ContentType = contentTypesToCreate[0] ?? "article";

        for (const title of titles) {
          if (skipWords.has(title.toLowerCase())) continue;

          const allItems = storage.listCalendarItems();
          const existing = allItems.find(
            ci => ci.title.toLowerCase() === title.toLowerCase()
          );
          if (existing) {
            if (publishDate) {
              const updated = scheduleCalendarItem(storage, existing.id, publishDate);
              result.calendarItemsUpdated.push(updated);
              result.messages.push(`Scheduled existing item "${existing.title}" for ${publishDate}`);
            } else {
              result.warnings.push(`Calendar item already exists: "${existing.title}" — skipping.`);
            }
            continue;
          }

          const assignmentOverride = entities.rawAssignments.find(
            a => ["editorial-agent", "seo-agent"].includes(a.agent)
          );

          const item = createCalendarItem(storage, {
            title,
            contentType,
            publishDate,
            status: publishDate ? "scheduled" : "idea",
            tags: entities.tags,
            initiativeId: initiativeId ?? undefined,
            sourceChannel: "cli",
            assignedAgent: assignmentOverride?.agent,
          });

          result.calendarItemsCreated.push(item);
          result.messages.push(
            `Created ${contentType.replace("_", " ")}: "${title}"` +
              (publishDate ? ` → scheduled ${publishDate}` : " → idea backlog")
          );

          const handoff = createHandoff(item, storage);
          emitHandoff(handoff, "stdout", config);
          result.handoffsCreated.push(handoff);

          if (initiativeId) {
            linkCalendarItemToInitiative(storage, initiativeId, item.id);
          }
        }
      }
    }
  }

  // ── schedule_calendar_item (reschedule existing) ───────────────────────────
  if (
    intents.includes("schedule_calendar_item") &&
    entities.calendarRefs.length > 0 &&
    entities.resolvedDates.length > 0
  ) {
    for (const ref of entities.calendarRefs) {
      const item = storage.getCalendarItem(ref);
      if (item && entities.resolvedDates[0]) {
        const updated = scheduleCalendarItem(
          storage,
          item.id,
          entities.resolvedDates[0]
        );
        result.calendarItemsUpdated.push(updated);
        result.messages.push(
          `Scheduled "${item.title}" for ${entities.resolvedDates[0]}`
        );
      }
    }
  }

  // ── create_ticket ──────────────────────────────────────────────────────────
  if (intents.includes("create_ticket") && !intents.includes("create_calendar_item")) {
    const titles = entities.ticketTitles.length > 0
      ? entities.ticketTitles
      : [];

    // Determine sprint placement
    let sprintId: string | null = null;
    if (entities.sprintRefs.includes("next")) {
      const next = getNextSprint(storage);
      sprintId = next?.id ?? null;
    } else if (entities.sprintRefs.includes("current")) {
      const active = getActiveSprint(storage);
      sprintId = active?.id ?? null;
    }

    // Resolve initiative
    let initiativeId: string | null = null;
    if (entities.initiatives.length > 0 && entities.initiatives[0]) {
      const ini = findInitiativeByKeyword(storage, entities.initiatives[0]);
      initiativeId = ini?.id ?? null;
    }

    for (const title of titles) {
      // Check for similar existing tickets
      const existing = storage.listTickets().find(
        t => t.title.toLowerCase() === title.toLowerCase()
      );
      if (existing) {
        result.warnings.push(`Ticket already exists: "${existing.title}" — skipping.`);
        continue;
      }

      // Determine agent from explicit assignments
      const assignmentOverride = entities.rawAssignments[0]?.agent;

      const ticket = createTicket(storage, {
        title,
        priority: entities.priorities[0] ?? "medium",
        tags: entities.tags,
        sprintId: sprintId ?? undefined,
        initiativeId: initiativeId ?? undefined,
        sourceChannel: "cli",
        assignedAgent: assignmentOverride,
        dueDate: entities.resolvedDates[0] ?? undefined,
        type: entities.ticketTypes[0],
      });

      // If we have a sprint, add ticket to sprint
      if (sprintId) {
        addToSprint(storage, sprintId, ticket.id);
      }

      result.ticketsCreated.push(ticket);
      result.messages.push(
        `Created ticket: "${ticket.title}" → ${ticket.assignedAgent ?? "unassigned"}` +
          (sprintId ? " (added to sprint)" : " (backlog)")
      );

      // Create handoff
      const handoff = createHandoff(ticket, storage);
      emitHandoff(handoff, "stdout", config);
      result.handoffsCreated.push(handoff);

      // Link to initiative
      if (initiativeId) {
        linkTicketToInitiative(storage, initiativeId, ticket.id);
      }
    }
  }

  // ── assign ─────────────────────────────────────────────────────────────────
  if (intents.includes("assign") || intents.includes("route_to_agent")) {
    for (const assignment of entities.rawAssignments) {
      // Find tickets matching the task description
      const tickets = storage.listTickets();
      const matchingTicket = tickets.find(t =>
        t.title.toLowerCase().includes(assignment.task.toLowerCase()) ||
        assignment.task.toLowerCase().includes(t.title.toLowerCase().slice(0, 20))
      );

      if (matchingTicket) {
        const updated = assignTicket(storage, matchingTicket.id, assignment.agent);
        result.ticketsUpdated.push(updated);
        result.messages.push(
          `Assigned "${matchingTicket.title}" to ${assignment.agent}`
        );
      } else {
        // Create new ticket for the assignment
        if (assignment.task.length > 3) {
          const ticket = createTicket(storage, {
            title: assignment.task,
            assignedAgent: assignment.agent,
            tags: entities.tags,
            sourceChannel: "cli",
          });
          result.ticketsCreated.push(ticket);
          result.messages.push(
            `Created ticket and assigned to ${assignment.agent}: "${ticket.title}"`
          );

          const handoff = createHandoff(ticket, storage);
          emitHandoff(handoff, "stdout", config);
          result.handoffsCreated.push(handoff);
        }
      }
    }
  }

  // ── move_ticket / mark_done / mark_blocked ─────────────────────────────────
  if (
    intents.includes("move_ticket") ||
    intents.includes("mark_done") ||
    intents.includes("mark_blocked")
  ) {
    let newStatus: TicketStatus | null = null;

    if (intents.includes("mark_done")) {
      newStatus = "done";
    } else if (intents.includes("mark_blocked")) {
      newStatus = "blocked";
    } else {
      // Extract status from entities
      newStatus = entities.statuses[0] ?? null;
    }

    // Get ticket refs (already resolved by resolveEntityReferences)
    const ticketRefs = entities.ticketRefs.filter(
      ref => ref.match(/^[0-9a-f]{8}-[0-9a-f]{4}/)
    );

    for (const ref of ticketRefs) {
      const ticket = storage.getTicket(ref);
      if (!ticket) continue;

      if (newStatus) {
        const updated = moveTicket(storage, ticket.id, newStatus);
        result.ticketsUpdated.push(updated);
        result.messages.push(
          `Moved "${ticket.title}" to ${newStatus}`
        );
      }

      // Add blockers if present
      if (
        intents.includes("mark_blocked") &&
        entities.blockers.length > 0
      ) {
        for (const blocker of entities.blockers) {
          addBlocker(storage, ticket.id, blocker);
          result.messages.push(`Added blocker to "${ticket.title}": ${blocker}`);
        }
      }
    }

    // If no explicit UUID ticket refs were found, search by title keywords from the message
    // This handles "Move dashboard review to blocked" style messages
    if (ticketRefs.length === 0 && newStatus && result.ticketsUpdated.length === 0) {
      const allTickets = storage.listTickets();
      const normalizedMsg = parsed.normalized.toLowerCase();

      // Build a set of significant words from the message (>3 chars, not stopwords)
      const stopwords = new Set(["move", "mark", "that", "this", "with", "into", "from", "blocked", "blocking", "review", "done", "complete", "ticket"]);
      const msgWords = normalizedMsg
        .replace(/[,;:.!?]/g, " ")
        .split(/\s+/)
        .map(w => w.trim())
        .filter(w => w.length > 3 && !stopwords.has(w));

      let bestMatch: { ticket: typeof allTickets[0]; score: number } | null = null;

      for (const ticket of allTickets) {
        const titleWords = ticket.title.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const score = titleWords.filter(w =>
          msgWords.some(mw => mw.includes(w) || w.includes(mw))
        ).length;
        if (score >= 1 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { ticket, score };
        }
      }

      if (bestMatch) {
        const ticket = bestMatch.ticket;
        const updated = moveTicket(storage, ticket.id, newStatus);
        result.ticketsUpdated.push(updated);
        result.messages.push(
          `Moved "${ticket.title}" to ${newStatus}`
        );
        for (const blocker of entities.blockers) {
          addBlocker(storage, ticket.id, blocker);
          result.messages.push(`Added blocker: "${blocker}"`);
        }
      } else if (intents.includes("mark_blocked")) {
        // Fall back to recent context
        const recentCtx = storage.getRecentContext();
        if (recentCtx.lastTicketId) {
          const ticket = storage.getTicket(recentCtx.lastTicketId);
          if (ticket) {
            const updated = moveTicket(storage, ticket.id, newStatus);
            result.ticketsUpdated.push(updated);
            result.messages.push(`Moved "${ticket.title}" to ${newStatus} (via recent context)`);
            for (const blocker of entities.blockers) {
              addBlocker(storage, ticket.id, blocker);
              result.messages.push(`Added blocker: "${blocker}"`);
            }
          }
        }
      }
    }
  }

  // ── plan_sprint (add items to sprint) ─────────────────────────────────────
  if (intents.includes("plan_sprint")) {
    const sprint = entities.sprintRefs.includes("next")
      ? getNextSprint(storage)
      : getActiveSprint(storage);

    if (sprint) {
      // Add any newly created tickets to the sprint
      for (const ticket of result.ticketsCreated) {
        if (!ticket.sprintId) {
          addToSprint(storage, sprint.id, ticket.id);
          result.messages.push(`Added "${ticket.title}" to sprint: ${sprint.name}`);
        }
      }
    }
  }

  return result;
}

// ─── Full ingest pipeline ──────────────────────────────────────────────────────

export async function ingestMessage(
  raw: string,
  channel: MessageChannel,
  storage: Storage,
  config: Config
): Promise<IngestResult> {
  const messageId = uuidv4();
  const now = new Date().toISOString();

  // 1. Normalize
  const normalized = normalizeText(raw);

  // 2. Parse
  const parsed = parseMessage(raw, storage);

  // 3. Resolve entity references (fuzzy "that one", etc.)
  const resolved = resolveEntityReferences(parsed, storage);

  // 4. Save message record
  storage.saveMessage({
    id: messageId,
    raw,
    normalized,
    channel,
    receivedAt: now,
    parsedIntents: resolved.intents,
    processingResult: null, // will update after
  });

  // 5. Execute intents
  const result = executeIntents(resolved, storage, config);

  // 6. Update message record with result
  storage.saveMessage({
    id: messageId,
    raw,
    normalized,
    channel,
    receivedAt: now,
    parsedIntents: resolved.intents,
    processingResult: JSON.stringify({
      ticketsCreated: result.ticketsCreated.length,
      calendarItemsCreated: result.calendarItemsCreated.length,
      decisionsLogged: result.decisionsLogged.length,
      initiativesCreated: result.initiativesCreated.length,
      handoffsCreated: result.handoffsCreated.length,
    }),
  });

  return result;
}

// ─── Format result ─────────────────────────────────────────────────────────────

export function formatIngestResult(result: IngestResult): string {
  const lines: string[] = [];

  lines.push(chalk.bold.white("\n  ── Ingest Result ──"));

  for (const msg of result.messages) {
    lines.push(`  ${chalk.green("✓")} ${msg}`);
  }

  for (const warn of result.warnings) {
    lines.push(`  ${chalk.yellow("⚠")} ${warn}`);
  }

  const counts: string[] = [];
  if (result.ticketsCreated.length > 0)
    counts.push(`${result.ticketsCreated.length} ticket(s) created`);
  if (result.ticketsUpdated.length > 0)
    counts.push(`${result.ticketsUpdated.length} ticket(s) updated`);
  if (result.calendarItemsCreated.length > 0)
    counts.push(`${result.calendarItemsCreated.length} calendar item(s) created`);
  if (result.calendarItemsUpdated.length > 0)
    counts.push(`${result.calendarItemsUpdated.length} calendar item(s) updated`);
  if (result.initiativesCreated.length > 0)
    counts.push(`${result.initiativesCreated.length} initiative(s) created`);
  if (result.decisionsLogged.length > 0)
    counts.push(`${result.decisionsLogged.length} decision(s) logged`);
  if (result.handoffsCreated.length > 0)
    counts.push(`${result.handoffsCreated.length} handoff(s) queued`);

  if (counts.length > 0) {
    lines.push(chalk.dim(`\n  Summary: ${counts.join(", ")}`));
  }

  if (result.statusReport) {
    lines.push(result.statusReport);
  }

  lines.push("");
  return lines.join("\n");
}
