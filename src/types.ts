// ─── Core Enumerations ────────────────────────────────────────────────────────

export type TicketStatus =
  | "inbox"
  | "ready"
  | "in_progress"
  | "in_review"
  | "blocked"
  | "done"
  | "icebox";

export type TicketPriority = "critical" | "high" | "medium" | "low";

export type TicketType =
  | "ticket"
  | "bug"
  | "task"
  | "subtask"
  | "epic"
  | "initiative"
  | "sprint_item"
  | "release_note";

export type ContentType =
  | "article"
  | "blog_post"
  | "newsletter"
  | "landing_page"
  | "social_campaign"
  | "release_notes"
  | "content_refresh"
  | "case_study"
  | "announcement";

export type ContentStatus =
  | "idea"
  | "draft"
  | "in_review"
  | "scheduled"
  | "published"
  | "archived";

export type SprintStatus = "planning" | "active" | "completed" | "cancelled";

export type AgentName =
  | "engineering-agent"
  | "ui-agent"
  | "design-agent"
  | "qa-agent"
  | "editorial-agent"
  | "seo-agent"
  | "research-agent"
  | "growth-agent"
  | "pm-agent";

export type MessageChannel =
  | "cli"
  | "webhook"
  | "twilio"
  | "telegram"
  | "email"
  | "api";

export type ParsedIntent =
  | "create_ticket"
  | "update_ticket"
  | "move_ticket"
  | "prioritize"
  | "assign"
  | "create_sprint"
  | "plan_sprint"
  | "create_calendar_item"
  | "schedule_calendar_item"
  | "update_calendar_item"
  | "create_initiative"
  | "log_decision"
  | "request_status"
  | "request_summary"
  | "route_to_agent"
  | "mark_blocked"
  | "mark_done"
  | "split_work"
  | "merge_duplicates";

// ─── Core Entities ─────────────────────────────────────────────────────────────

export interface Ticket {
  id: string;
  title: string;
  description: string;
  type: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  assignedAgent: AgentName | null;
  tags: string[];
  blockers: string[];
  sprintId: string | null;
  initiativeId: string | null;
  parentTicketId: string | null;
  childTicketIds: string[];
  estimatePoints: number | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  dueDate: string | null; // ISO 8601 date
  closedAt: string | null; // ISO 8601
  sourceChannel: MessageChannel;
  sourceMessageId: string | null;
  metadata: Record<string, string | number | boolean>;
}

export interface Sprint {
  id: string;
  name: string;
  goal: string;
  status: SprintStatus;
  startDate: string; // ISO 8601 date
  endDate: string; // ISO 8601 date
  ticketIds: string[];
  velocity: number | null; // story points completed
  createdAt: string;
  updatedAt: string;
}

export interface EditorialCalendarItem {
  id: string;
  title: string;
  contentType: ContentType;
  status: ContentStatus;
  assignedAgent: AgentName | null;
  publishDate: string | null; // ISO 8601 date
  dueDate: string | null; // ISO 8601 date (when draft is due)
  theme: string | null;
  tags: string[];
  keywords: string[];
  initiativeId: string | null;
  sprintId: string | null;
  ticketId: string | null; // linked ticket for release notes, etc.
  notes: string;
  briefUrl: string | null;
  draftUrl: string | null;
  publishedUrl: string | null;
  createdAt: string;
  updatedAt: string;
  sourceChannel: MessageChannel;
  sourceMessageId: string | null;
}

export interface Initiative {
  id: string;
  name: string;
  description: string;
  status: "planning" | "active" | "completed" | "paused";
  startDate: string | null;
  targetDate: string | null;
  ticketIds: string[];
  calendarItemIds: string[];
  tags: string[];
  ownedBy: AgentName | null;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionLogEntry {
  id: string;
  decision: string;
  rationale: string;
  context: string;
  madeBy: string; // person or agent name
  affectedTicketIds: string[];
  affectedInitiativeIds: string[];
  tags: string[];
  createdAt: string;
  channel: MessageChannel;
}

export interface IncomingMessage {
  id: string;
  raw: string;
  normalized: string;
  channel: MessageChannel;
  receivedAt: string;
  parsedIntents: ParsedIntent[];
  processingResult: string | null; // JSON of IngestResult
}

export interface AgentHandoff {
  id: string;
  targetAgent: AgentName;
  sourceAgent: AgentName;
  ticketId: string | null;
  calendarItemId: string | null;
  priority: TicketPriority;
  instruction: string;
  context: string;
  createdAt: string;
  status: "pending" | "delivered" | "acknowledged";
}

// ─── Parser Types ───────────────────────────────────────────────────────────────

export interface ExtractedEntities {
  ticketTitles: string[];
  contentTitles: string[];
  agentNames: AgentName[];
  rawDates: string[];
  resolvedDates: string[]; // ISO 8601 date strings
  priorities: TicketPriority[];
  statuses: TicketStatus[];
  contentTypes: ContentType[];
  ticketTypes: TicketType[];
  tags: string[];
  initiatives: string[];
  decisions: string[];
  blockers: string[];
  sprintRefs: Array<"next" | "current" | "backlog" | string>;
  ticketRefs: string[]; // IDs or fuzzy references like "that one", "the dashboard ticket"
  calendarRefs: string[]; // IDs or fuzzy references
  rawAssignments: Array<{ agent: AgentName; task: string }>;
}

export interface ParseResult {
  intents: ParsedIntent[];
  entities: ExtractedEntities;
  confidence: number; // 0.0 – 1.0
  raw: string;
  normalized: string;
}

export interface IngestResult {
  ticketsCreated: Ticket[];
  ticketsUpdated: Ticket[];
  calendarItemsCreated: EditorialCalendarItem[];
  calendarItemsUpdated: EditorialCalendarItem[];
  sprintsCreated: Sprint[];
  initiativesCreated: Initiative[];
  decisionsLogged: DecisionLogEntry[];
  handoffsCreated: AgentHandoff[];
  statusReport: string | null;
  messages: string[];
  warnings: string[];
}

// ─── Input Types ────────────────────────────────────────────────────────────────

export interface CreateTicketInput {
  title: string;
  description?: string;
  type?: TicketType;
  priority?: TicketPriority;
  status?: TicketStatus;
  assignedAgent?: AgentName;
  tags?: string[];
  sprintId?: string;
  initiativeId?: string;
  parentTicketId?: string;
  estimatePoints?: number;
  dueDate?: string;
  sourceChannel?: MessageChannel;
  sourceMessageId?: string;
}

export interface CreateSprintInput {
  name: string;
  goal?: string;
  startDate: string;
  endDate: string;
  ticketIds?: string[];
}

export interface CreateCalendarItemInput {
  title: string;
  contentType: ContentType;
  status?: ContentStatus;
  assignedAgent?: AgentName;
  publishDate?: string;
  dueDate?: string;
  theme?: string;
  tags?: string[];
  keywords?: string[];
  initiativeId?: string;
  notes?: string;
  sourceChannel?: MessageChannel;
  sourceMessageId?: string;
}

export interface CreateInitiativeInput {
  name: string;
  description?: string;
  startDate?: string;
  targetDate?: string;
  tags?: string[];
  ownedBy?: AgentName;
}

export interface LogDecisionInput {
  decision: string;
  rationale?: string;
  context?: string;
  madeBy?: string;
  affectedTicketIds?: string[];
  affectedInitiativeIds?: string[];
  tags?: string[];
  channel?: MessageChannel;
}

// ─── Board / Report Types ──────────────────────────────────────────────────────

export interface BoardStats {
  totalTickets: number;
  byStatus: Record<TicketStatus, number>;
  byPriority: Record<TicketPriority, number>;
  byAgent: Record<string, number>;
  blockedCount: number;
  inProgressCount: number;
  doneThisWeek: number;
}

export interface RecentContext {
  lastTicketId: string | null;
  lastCalendarItemId: string | null;
  lastAgentName: AgentName | null;
  lastSprintId: string | null;
  lastInitiativeId: string | null;
  lastMessageText: string | null;
}

export type HandoffMode = "file" | "stdout" | "webhook";

export interface AgentConfig {
  name: AgentName;
  displayName: string;
  description: string;
  handles: string[];
  defaultPriority: number;
}
