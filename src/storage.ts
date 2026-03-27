import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import type {
  Ticket,
  Sprint,
  EditorialCalendarItem,
  Initiative,
  DecisionLogEntry,
  IncomingMessage,
  RecentContext,
  AgentHandoff,
} from "./types.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function serializeArr(arr: unknown[]): string {
  return JSON.stringify(arr);
}

function deserializeArr<T>(val: string | null | undefined): T[] {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function serializeObj(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

function deserializeObj<T extends Record<string, unknown>>(
  val: string | null | undefined
): T {
  if (!val) return {} as T;
  try {
    return JSON.parse(val) as T;
  } catch {
    return {} as T;
  }
}

// ─── Row types (what SQLite returns) ──────────────────────────────────────────

interface TicketRow {
  id: string;
  title: string;
  description: string;
  type: string;
  status: string;
  priority: string;
  assigned_agent: string | null;
  tags: string;
  blockers: string;
  sprint_id: string | null;
  initiative_id: string | null;
  parent_ticket_id: string | null;
  child_ticket_ids: string;
  estimate_points: number | null;
  created_at: string;
  updated_at: string;
  due_date: string | null;
  closed_at: string | null;
  source_channel: string;
  source_message_id: string | null;
  metadata: string;
}

interface SprintRow {
  id: string;
  name: string;
  goal: string;
  status: string;
  start_date: string;
  end_date: string;
  ticket_ids: string;
  velocity: number | null;
  created_at: string;
  updated_at: string;
}

interface CalendarRow {
  id: string;
  title: string;
  content_type: string;
  status: string;
  assigned_agent: string | null;
  publish_date: string | null;
  due_date: string | null;
  theme: string | null;
  tags: string;
  keywords: string;
  initiative_id: string | null;
  sprint_id: string | null;
  ticket_id: string | null;
  notes: string;
  brief_url: string | null;
  draft_url: string | null;
  published_url: string | null;
  created_at: string;
  updated_at: string;
  source_channel: string;
  source_message_id: string | null;
}

interface InitiativeRow {
  id: string;
  name: string;
  description: string;
  status: string;
  start_date: string | null;
  target_date: string | null;
  ticket_ids: string;
  calendar_item_ids: string;
  tags: string;
  owned_by: string | null;
  created_at: string;
  updated_at: string;
}

interface DecisionRow {
  id: string;
  decision: string;
  rationale: string;
  context: string;
  made_by: string;
  affected_ticket_ids: string;
  affected_initiative_ids: string;
  tags: string;
  created_at: string;
  channel: string;
}

interface MessageRow {
  id: string;
  raw: string;
  normalized: string;
  channel: string;
  received_at: string;
  parsed_intents: string;
  processing_result: string | null;
}

interface HandoffRow {
  id: string;
  target_agent: string;
  source_agent: string;
  ticket_id: string | null;
  calendar_item_id: string | null;
  priority: string;
  instruction: string;
  context: string;
  created_at: string;
  status: string;
}

// ─── Mappers ───────────────────────────────────────────────────────────────────

function rowToTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type as Ticket["type"],
    status: row.status as Ticket["status"],
    priority: row.priority as Ticket["priority"],
    assignedAgent: row.assigned_agent as Ticket["assignedAgent"],
    tags: deserializeArr<string>(row.tags),
    blockers: deserializeArr<string>(row.blockers),
    sprintId: row.sprint_id,
    initiativeId: row.initiative_id,
    parentTicketId: row.parent_ticket_id,
    childTicketIds: deserializeArr<string>(row.child_ticket_ids),
    estimatePoints: row.estimate_points,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dueDate: row.due_date,
    closedAt: row.closed_at,
    sourceChannel: row.source_channel as Ticket["sourceChannel"],
    sourceMessageId: row.source_message_id,
    metadata: deserializeObj(row.metadata),
  };
}

function rowToSprint(row: SprintRow): Sprint {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    status: row.status as Sprint["status"],
    startDate: row.start_date,
    endDate: row.end_date,
    ticketIds: deserializeArr<string>(row.ticket_ids),
    velocity: row.velocity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCalendarItem(row: CalendarRow): EditorialCalendarItem {
  return {
    id: row.id,
    title: row.title,
    contentType: row.content_type as EditorialCalendarItem["contentType"],
    status: row.status as EditorialCalendarItem["status"],
    assignedAgent: row.assigned_agent as EditorialCalendarItem["assignedAgent"],
    publishDate: row.publish_date,
    dueDate: row.due_date,
    theme: row.theme,
    tags: deserializeArr<string>(row.tags),
    keywords: deserializeArr<string>(row.keywords),
    initiativeId: row.initiative_id,
    sprintId: row.sprint_id,
    ticketId: row.ticket_id,
    notes: row.notes,
    briefUrl: row.brief_url,
    draftUrl: row.draft_url,
    publishedUrl: row.published_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceChannel: row.source_channel as EditorialCalendarItem["sourceChannel"],
    sourceMessageId: row.source_message_id,
  };
}

function rowToInitiative(row: InitiativeRow): Initiative {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as Initiative["status"],
    startDate: row.start_date,
    targetDate: row.target_date,
    ticketIds: deserializeArr<string>(row.ticket_ids),
    calendarItemIds: deserializeArr<string>(row.calendar_item_ids),
    tags: deserializeArr<string>(row.tags),
    ownedBy: row.owned_by as Initiative["ownedBy"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDecision(row: DecisionRow): DecisionLogEntry {
  return {
    id: row.id,
    decision: row.decision,
    rationale: row.rationale,
    context: row.context,
    madeBy: row.made_by,
    affectedTicketIds: deserializeArr<string>(row.affected_ticket_ids),
    affectedInitiativeIds: deserializeArr<string>(row.affected_initiative_ids),
    tags: deserializeArr<string>(row.tags),
    createdAt: row.created_at,
    channel: row.channel as DecisionLogEntry["channel"],
  };
}

function rowToMessage(row: MessageRow): IncomingMessage {
  return {
    id: row.id,
    raw: row.raw,
    normalized: row.normalized,
    channel: row.channel as IncomingMessage["channel"],
    receivedAt: row.received_at,
    parsedIntents: deserializeArr<IncomingMessage["parsedIntents"][number]>(
      row.parsed_intents
    ),
    processingResult: row.processing_result,
  };
}

function rowToHandoff(row: HandoffRow): AgentHandoff {
  return {
    id: row.id,
    targetAgent: row.target_agent as AgentHandoff["targetAgent"],
    sourceAgent: row.source_agent as AgentHandoff["sourceAgent"],
    ticketId: row.ticket_id,
    calendarItemId: row.calendar_item_id,
    priority: row.priority as AgentHandoff["priority"],
    instruction: row.instruction,
    context: row.context,
    createdAt: row.created_at,
    status: row.status as AgentHandoff["status"],
  };
}

// ─── Storage class ─────────────────────────────────────────────────────────────

export class Storage {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'ticket',
        status TEXT NOT NULL DEFAULT 'inbox',
        priority TEXT NOT NULL DEFAULT 'medium',
        assigned_agent TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        blockers TEXT NOT NULL DEFAULT '[]',
        sprint_id TEXT,
        initiative_id TEXT,
        parent_ticket_id TEXT,
        child_ticket_ids TEXT NOT NULL DEFAULT '[]',
        estimate_points REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        due_date TEXT,
        closed_at TEXT,
        source_channel TEXT NOT NULL DEFAULT 'cli',
        source_message_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS sprints (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        goal TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planning',
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        ticket_ids TEXT NOT NULL DEFAULT '[]',
        velocity REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS calendar_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idea',
        assigned_agent TEXT,
        publish_date TEXT,
        due_date TEXT,
        theme TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        keywords TEXT NOT NULL DEFAULT '[]',
        initiative_id TEXT,
        sprint_id TEXT,
        ticket_id TEXT,
        notes TEXT NOT NULL DEFAULT '',
        brief_url TEXT,
        draft_url TEXT,
        published_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source_channel TEXT NOT NULL DEFAULT 'cli',
        source_message_id TEXT
      );

      CREATE TABLE IF NOT EXISTS initiatives (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planning',
        start_date TEXT,
        target_date TEXT,
        ticket_ids TEXT NOT NULL DEFAULT '[]',
        calendar_item_ids TEXT NOT NULL DEFAULT '[]',
        tags TEXT NOT NULL DEFAULT '[]',
        owned_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        decision TEXT NOT NULL,
        rationale TEXT NOT NULL DEFAULT '',
        context TEXT NOT NULL DEFAULT '',
        made_by TEXT NOT NULL DEFAULT 'pm',
        affected_ticket_ids TEXT NOT NULL DEFAULT '[]',
        affected_initiative_ids TEXT NOT NULL DEFAULT '[]',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'cli'
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        raw TEXT NOT NULL,
        normalized TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'cli',
        received_at TEXT NOT NULL,
        parsed_intents TEXT NOT NULL DEFAULT '[]',
        processing_result TEXT
      );

      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        target_agent TEXT NOT NULL,
        source_agent TEXT NOT NULL DEFAULT 'pm-agent',
        ticket_id TEXT,
        calendar_item_id TEXT,
        priority TEXT NOT NULL DEFAULT 'medium',
        instruction TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS recent_context (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  // ─── Tickets ────────────────────────────────────────────────────────────────

  saveTicket(t: Ticket): void {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO tickets
          (id, title, description, type, status, priority, assigned_agent,
           tags, blockers, sprint_id, initiative_id, parent_ticket_id,
           child_ticket_ids, estimate_points, created_at, updated_at,
           due_date, closed_at, source_channel, source_message_id, metadata)
          VALUES
          (@id, @title, @description, @type, @status, @priority, @assigned_agent,
           @tags, @blockers, @sprint_id, @initiative_id, @parent_ticket_id,
           @child_ticket_ids, @estimate_points, @created_at, @updated_at,
           @due_date, @closed_at, @source_channel, @source_message_id, @metadata)`
        )
        .run({
          id: t.id,
          title: t.title,
          description: t.description,
          type: t.type,
          status: t.status,
          priority: t.priority,
          assigned_agent: t.assignedAgent,
          tags: serializeArr(t.tags),
          blockers: serializeArr(t.blockers),
          sprint_id: t.sprintId,
          initiative_id: t.initiativeId,
          parent_ticket_id: t.parentTicketId,
          child_ticket_ids: serializeArr(t.childTicketIds),
          estimate_points: t.estimatePoints,
          created_at: t.createdAt,
          updated_at: t.updatedAt,
          due_date: t.dueDate,
          closed_at: t.closedAt,
          source_channel: t.sourceChannel,
          source_message_id: t.sourceMessageId,
          metadata: serializeObj(t.metadata as Record<string, unknown>),
        });
      this.setRecentContext("lastTicketId", t.id);
    } catch (err) {
      throw new Error(`Storage.saveTicket failed for id=${t.id}: ${String(err)}`);
    }
  }

  getTicket(id: string): Ticket | null {
    try {
      const row = this.db
        .prepare("SELECT * FROM tickets WHERE id = ?")
        .get(id) as TicketRow | undefined;
      return row ? rowToTicket(row) : null;
    } catch (err) {
      throw new Error(`Storage.getTicket failed for id=${id}: ${String(err)}`);
    }
  }

  listTickets(filter?: Partial<Ticket>): Ticket[] {
    try {
      if (!filter || Object.keys(filter).length === 0) {
        const rows = this.db
          .prepare("SELECT * FROM tickets ORDER BY created_at DESC")
          .all() as TicketRow[];
        return rows.map(rowToTicket);
      }

      const conditions: string[] = [];
      const params: Record<string, unknown> = {};

      if (filter.status) {
        conditions.push("status = @status");
        params["status"] = filter.status;
      }
      if (filter.priority) {
        conditions.push("priority = @priority");
        params["priority"] = filter.priority;
      }
      if (filter.assignedAgent !== undefined) {
        if (filter.assignedAgent === null) {
          conditions.push("assigned_agent IS NULL");
        } else {
          conditions.push("assigned_agent = @assigned_agent");
          params["assigned_agent"] = filter.assignedAgent;
        }
      }
      if (filter.sprintId !== undefined) {
        if (filter.sprintId === null) {
          conditions.push("sprint_id IS NULL");
        } else {
          conditions.push("sprint_id = @sprint_id");
          params["sprint_id"] = filter.sprintId;
        }
      }
      if (filter.type) {
        conditions.push("type = @type");
        params["type"] = filter.type;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = this.db
        .prepare(`SELECT * FROM tickets ${where} ORDER BY created_at DESC`)
        .all(params) as TicketRow[];
      return rows.map(rowToTicket);
    } catch (err) {
      throw new Error(`Storage.listTickets failed: ${String(err)}`);
    }
  }

  updateTicket(id: string, updates: Partial<Ticket>): void {
    try {
      const existing = this.getTicket(id);
      if (!existing) throw new Error(`Ticket ${id} not found`);
      const merged: Ticket = {
        ...existing,
        ...updates,
        id, // never overwrite id
        updatedAt: new Date().toISOString(),
      };
      this.saveTicket(merged);
    } catch (err) {
      throw new Error(`Storage.updateTicket failed for id=${id}: ${String(err)}`);
    }
  }

  deleteTicket(id: string): void {
    try {
      this.db.prepare("DELETE FROM tickets WHERE id = ?").run(id);
    } catch (err) {
      throw new Error(`Storage.deleteTicket failed for id=${id}: ${String(err)}`);
    }
  }

  // ─── Sprints ────────────────────────────────────────────────────────────────

  saveSprint(s: Sprint): void {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO sprints
          (id, name, goal, status, start_date, end_date, ticket_ids, velocity, created_at, updated_at)
          VALUES
          (@id, @name, @goal, @status, @start_date, @end_date, @ticket_ids, @velocity, @created_at, @updated_at)`
        )
        .run({
          id: s.id,
          name: s.name,
          goal: s.goal,
          status: s.status,
          start_date: s.startDate,
          end_date: s.endDate,
          ticket_ids: serializeArr(s.ticketIds),
          velocity: s.velocity,
          created_at: s.createdAt,
          updated_at: s.updatedAt,
        });
      this.setRecentContext("lastSprintId", s.id);
    } catch (err) {
      throw new Error(`Storage.saveSprint failed for id=${s.id}: ${String(err)}`);
    }
  }

  getSprint(id: string): Sprint | null {
    try {
      const row = this.db
        .prepare("SELECT * FROM sprints WHERE id = ?")
        .get(id) as SprintRow | undefined;
      return row ? rowToSprint(row) : null;
    } catch (err) {
      throw new Error(`Storage.getSprint failed for id=${id}: ${String(err)}`);
    }
  }

  listSprints(): Sprint[] {
    try {
      const rows = this.db
        .prepare("SELECT * FROM sprints ORDER BY start_date ASC")
        .all() as SprintRow[];
      return rows.map(rowToSprint);
    } catch (err) {
      throw new Error(`Storage.listSprints failed: ${String(err)}`);
    }
  }

  updateSprint(id: string, updates: Partial<Sprint>): void {
    try {
      const existing = this.getSprint(id);
      if (!existing) throw new Error(`Sprint ${id} not found`);
      const merged: Sprint = {
        ...existing,
        ...updates,
        id,
        updatedAt: new Date().toISOString(),
      };
      this.saveSprint(merged);
    } catch (err) {
      throw new Error(`Storage.updateSprint failed for id=${id}: ${String(err)}`);
    }
  }

  // ─── Calendar Items ──────────────────────────────────────────────────────────

  saveCalendarItem(item: EditorialCalendarItem): void {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO calendar_items
          (id, title, content_type, status, assigned_agent, publish_date, due_date,
           theme, tags, keywords, initiative_id, sprint_id, ticket_id, notes,
           brief_url, draft_url, published_url, created_at, updated_at,
           source_channel, source_message_id)
          VALUES
          (@id, @title, @content_type, @status, @assigned_agent, @publish_date, @due_date,
           @theme, @tags, @keywords, @initiative_id, @sprint_id, @ticket_id, @notes,
           @brief_url, @draft_url, @published_url, @created_at, @updated_at,
           @source_channel, @source_message_id)`
        )
        .run({
          id: item.id,
          title: item.title,
          content_type: item.contentType,
          status: item.status,
          assigned_agent: item.assignedAgent,
          publish_date: item.publishDate,
          due_date: item.dueDate,
          theme: item.theme,
          tags: serializeArr(item.tags),
          keywords: serializeArr(item.keywords),
          initiative_id: item.initiativeId,
          sprint_id: item.sprintId,
          ticket_id: item.ticketId,
          notes: item.notes,
          brief_url: item.briefUrl,
          draft_url: item.draftUrl,
          published_url: item.publishedUrl,
          created_at: item.createdAt,
          updated_at: item.updatedAt,
          source_channel: item.sourceChannel,
          source_message_id: item.sourceMessageId,
        });
      this.setRecentContext("lastCalendarItemId", item.id);
    } catch (err) {
      throw new Error(`Storage.saveCalendarItem failed for id=${item.id}: ${String(err)}`);
    }
  }

  getCalendarItem(id: string): EditorialCalendarItem | null {
    try {
      const row = this.db
        .prepare("SELECT * FROM calendar_items WHERE id = ?")
        .get(id) as CalendarRow | undefined;
      return row ? rowToCalendarItem(row) : null;
    } catch (err) {
      throw new Error(`Storage.getCalendarItem failed for id=${id}: ${String(err)}`);
    }
  }

  listCalendarItems(filter?: Partial<EditorialCalendarItem>): EditorialCalendarItem[] {
    try {
      if (!filter || Object.keys(filter).length === 0) {
        const rows = this.db
          .prepare("SELECT * FROM calendar_items ORDER BY created_at DESC")
          .all() as CalendarRow[];
        return rows.map(rowToCalendarItem);
      }

      const conditions: string[] = [];
      const params: Record<string, unknown> = {};

      if (filter.status) {
        conditions.push("status = @status");
        params["status"] = filter.status;
      }
      if (filter.contentType) {
        conditions.push("content_type = @content_type");
        params["content_type"] = filter.contentType;
      }
      if (filter.assignedAgent !== undefined) {
        if (filter.assignedAgent === null) {
          conditions.push("assigned_agent IS NULL");
        } else {
          conditions.push("assigned_agent = @assigned_agent");
          params["assigned_agent"] = filter.assignedAgent;
        }
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = this.db
        .prepare(`SELECT * FROM calendar_items ${where} ORDER BY created_at DESC`)
        .all(params) as CalendarRow[];
      return rows.map(rowToCalendarItem);
    } catch (err) {
      throw new Error(`Storage.listCalendarItems failed: ${String(err)}`);
    }
  }

  updateCalendarItem(id: string, updates: Partial<EditorialCalendarItem>): void {
    try {
      const existing = this.getCalendarItem(id);
      if (!existing) throw new Error(`CalendarItem ${id} not found`);
      const merged: EditorialCalendarItem = {
        ...existing,
        ...updates,
        id,
        updatedAt: new Date().toISOString(),
      };
      this.saveCalendarItem(merged);
    } catch (err) {
      throw new Error(
        `Storage.updateCalendarItem failed for id=${id}: ${String(err)}`
      );
    }
  }

  // ─── Initiatives ─────────────────────────────────────────────────────────────

  saveInitiative(i: Initiative): void {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO initiatives
          (id, name, description, status, start_date, target_date,
           ticket_ids, calendar_item_ids, tags, owned_by, created_at, updated_at)
          VALUES
          (@id, @name, @description, @status, @start_date, @target_date,
           @ticket_ids, @calendar_item_ids, @tags, @owned_by, @created_at, @updated_at)`
        )
        .run({
          id: i.id,
          name: i.name,
          description: i.description,
          status: i.status,
          start_date: i.startDate,
          target_date: i.targetDate,
          ticket_ids: serializeArr(i.ticketIds),
          calendar_item_ids: serializeArr(i.calendarItemIds),
          tags: serializeArr(i.tags),
          owned_by: i.ownedBy,
          created_at: i.createdAt,
          updated_at: i.updatedAt,
        });
      this.setRecentContext("lastInitiativeId", i.id);
    } catch (err) {
      throw new Error(`Storage.saveInitiative failed for id=${i.id}: ${String(err)}`);
    }
  }

  getInitiative(id: string): Initiative | null {
    try {
      const row = this.db
        .prepare("SELECT * FROM initiatives WHERE id = ?")
        .get(id) as InitiativeRow | undefined;
      return row ? rowToInitiative(row) : null;
    } catch (err) {
      throw new Error(`Storage.getInitiative failed for id=${id}: ${String(err)}`);
    }
  }

  listInitiatives(): Initiative[] {
    try {
      const rows = this.db
        .prepare("SELECT * FROM initiatives ORDER BY created_at DESC")
        .all() as InitiativeRow[];
      return rows.map(rowToInitiative);
    } catch (err) {
      throw new Error(`Storage.listInitiatives failed: ${String(err)}`);
    }
  }

  updateInitiative(id: string, updates: Partial<Initiative>): void {
    try {
      const existing = this.getInitiative(id);
      if (!existing) throw new Error(`Initiative ${id} not found`);
      const merged: Initiative = {
        ...existing,
        ...updates,
        id,
        updatedAt: new Date().toISOString(),
      };
      this.saveInitiative(merged);
    } catch (err) {
      throw new Error(`Storage.updateInitiative failed for id=${id}: ${String(err)}`);
    }
  }

  // ─── Decisions ────────────────────────────────────────────────────────────────

  saveDecision(d: DecisionLogEntry): void {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO decisions
          (id, decision, rationale, context, made_by, affected_ticket_ids,
           affected_initiative_ids, tags, created_at, channel)
          VALUES
          (@id, @decision, @rationale, @context, @made_by, @affected_ticket_ids,
           @affected_initiative_ids, @tags, @created_at, @channel)`
        )
        .run({
          id: d.id,
          decision: d.decision,
          rationale: d.rationale,
          context: d.context,
          made_by: d.madeBy,
          affected_ticket_ids: serializeArr(d.affectedTicketIds),
          affected_initiative_ids: serializeArr(d.affectedInitiativeIds),
          tags: serializeArr(d.tags),
          created_at: d.createdAt,
          channel: d.channel,
        });
    } catch (err) {
      throw new Error(`Storage.saveDecision failed for id=${d.id}: ${String(err)}`);
    }
  }

  listDecisions(): DecisionLogEntry[] {
    try {
      const rows = this.db
        .prepare("SELECT * FROM decisions ORDER BY created_at DESC")
        .all() as DecisionRow[];
      return rows.map(rowToDecision);
    } catch (err) {
      throw new Error(`Storage.listDecisions failed: ${String(err)}`);
    }
  }

  // ─── Messages ────────────────────────────────────────────────────────────────

  saveMessage(m: IncomingMessage): void {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO messages
          (id, raw, normalized, channel, received_at, parsed_intents, processing_result)
          VALUES
          (@id, @raw, @normalized, @channel, @received_at, @parsed_intents, @processing_result)`
        )
        .run({
          id: m.id,
          raw: m.raw,
          normalized: m.normalized,
          channel: m.channel,
          received_at: m.receivedAt,
          parsed_intents: serializeArr(m.parsedIntents),
          processing_result: m.processingResult,
        });
      this.setRecentContext("lastMessageText", m.raw.slice(0, 200));
    } catch (err) {
      throw new Error(`Storage.saveMessage failed for id=${m.id}: ${String(err)}`);
    }
  }

  listMessages(limit?: number): IncomingMessage[] {
    try {
      const sql = limit
        ? "SELECT * FROM messages ORDER BY received_at DESC LIMIT ?"
        : "SELECT * FROM messages ORDER BY received_at DESC";
      const rows = (
        limit
          ? this.db.prepare(sql).all(limit)
          : this.db.prepare(sql).all()
      ) as MessageRow[];
      return rows.map(rowToMessage);
    } catch (err) {
      throw new Error(`Storage.listMessages failed: ${String(err)}`);
    }
  }

  // ─── Handoffs ────────────────────────────────────────────────────────────────

  saveHandoff(h: AgentHandoff): void {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO handoffs
          (id, target_agent, source_agent, ticket_id, calendar_item_id,
           priority, instruction, context, created_at, status)
          VALUES
          (@id, @target_agent, @source_agent, @ticket_id, @calendar_item_id,
           @priority, @instruction, @context, @created_at, @status)`
        )
        .run({
          id: h.id,
          target_agent: h.targetAgent,
          source_agent: h.sourceAgent,
          ticket_id: h.ticketId,
          calendar_item_id: h.calendarItemId,
          priority: h.priority,
          instruction: h.instruction,
          context: h.context,
          created_at: h.createdAt,
          status: h.status,
        });
    } catch (err) {
      throw new Error(`Storage.saveHandoff failed for id=${h.id}: ${String(err)}`);
    }
  }

  listHandoffs(filter?: { status?: string; targetAgent?: string }): AgentHandoff[] {
    try {
      if (!filter) {
        const rows = this.db
          .prepare("SELECT * FROM handoffs ORDER BY created_at DESC")
          .all() as HandoffRow[];
        return rows.map(rowToHandoff);
      }
      const conditions: string[] = [];
      const params: Record<string, unknown> = {};
      if (filter.status) {
        conditions.push("status = @status");
        params["status"] = filter.status;
      }
      if (filter.targetAgent) {
        conditions.push("target_agent = @target_agent");
        params["target_agent"] = filter.targetAgent;
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = this.db
        .prepare(`SELECT * FROM handoffs ${where} ORDER BY created_at DESC`)
        .all(params) as HandoffRow[];
      return rows.map(rowToHandoff);
    } catch (err) {
      throw new Error(`Storage.listHandoffs failed: ${String(err)}`);
    }
  }

  // ─── Recent Context ──────────────────────────────────────────────────────────

  private setRecentContext(key: string, value: string | null): void {
    this.db
      .prepare("INSERT OR REPLACE INTO recent_context (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  private getRecentContextValue(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM recent_context WHERE key = ?")
      .get(key) as { value: string | null } | undefined;
    return row?.value ?? null;
  }

  getRecentContext(): RecentContext {
    return {
      lastTicketId: this.getRecentContextValue("lastTicketId"),
      lastCalendarItemId: this.getRecentContextValue("lastCalendarItemId"),
      lastAgentName: this.getRecentContextValue("lastAgentName") as RecentContext["lastAgentName"],
      lastSprintId: this.getRecentContextValue("lastSprintId"),
      lastInitiativeId: this.getRecentContextValue("lastInitiativeId"),
      lastMessageText: this.getRecentContextValue("lastMessageText"),
    };
  }

  setLastAgent(agent: string): void {
    this.setRecentContext("lastAgentName", agent);
  }

  close(): void {
    this.db.close();
  }
}
