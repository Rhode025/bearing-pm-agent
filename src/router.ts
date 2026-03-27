import { AGENT_DIRECTORY } from "./agent-directory.js";
import type {
  Ticket,
  EditorialCalendarItem,
  AgentName,
  TicketType,
  ContentType,
} from "./types.js";
import type { Storage } from "./storage.js";

// ─── Routing rules ────────────────────────────────────────────────────────────

interface RoutingRule {
  condition: (ticket: Ticket) => boolean;
  agent: AgentName;
  rationale: string;
}

interface CalendarRoutingRule {
  condition: (item: EditorialCalendarItem) => boolean;
  agent: AgentName;
  rationale: string;
}

const TICKET_ROUTING_RULES: RoutingRule[] = [
  {
    condition: (t) => t.type === "bug",
    agent: "qa-agent",
    rationale: "Bug tickets are routed to QA Agent for triage and validation",
  },
  {
    condition: (t) =>
      t.type === "release_note" ||
      t.tags.some(tag => ["release-notes", "release notes", "release_notes"].includes(tag.toLowerCase())),
    agent: "editorial-agent",
    rationale: "Release notes are owned by Editorial Agent",
  },
  {
    condition: (t) =>
      t.tags.some(tag =>
        ["seo", "keyword", "search", "meta", "organic"].includes(tag.toLowerCase())
      ),
    agent: "seo-agent",
    rationale: "SEO-tagged tickets are routed to SEO Agent",
  },
  {
    condition: (t) =>
      t.tags.some(tag =>
        ["research", "user-research", "survey", "analysis"].includes(tag.toLowerCase())
      ),
    agent: "research-agent",
    rationale: "Research-tagged tickets are routed to Research Agent",
  },
  {
    condition: (t) =>
      t.tags.some(tag =>
        ["growth", "marketing", "campaign", "acquisition", "ab-test"].includes(
          tag.toLowerCase()
        )
      ),
    agent: "growth-agent",
    rationale: "Growth-tagged tickets are routed to Growth Agent",
  },
  {
    condition: (t) =>
      t.tags.some(tag =>
        ["design", "ux", "wireframe", "figma", "mockup", "visual"].includes(
          tag.toLowerCase()
        )
      ),
    agent: "design-agent",
    rationale: "Design-tagged tickets are routed to Design Agent",
  },
  {
    condition: (t) =>
      t.tags.some(tag =>
        [
          "ui",
          "frontend",
          "front-end",
          "react",
          "nextjs",
          "component",
          "landing-page",
        ].includes(tag.toLowerCase())
      ),
    agent: "ui-agent",
    rationale: "UI/frontend-tagged tickets are routed to UI Agent",
  },
  {
    condition: (t) =>
      t.tags.some(tag =>
        [
          "backend",
          "api",
          "database",
          "engineering",
          "infrastructure",
          "service",
        ].includes(tag.toLowerCase())
      ),
    agent: "engineering-agent",
    rationale: "Engineering/backend-tagged tickets are routed to Engineering Agent",
  },
];

const CALENDAR_ROUTING_RULES: CalendarRoutingRule[] = [
  {
    condition: (item) =>
      (["article", "blog_post", "newsletter", "release_notes", "case_study", "announcement", "content_refresh"] as ContentType[]).includes(
        item.contentType
      ),
    agent: "editorial-agent",
    rationale: "Written content is owned by Editorial Agent",
  },
  {
    condition: (item) => item.contentType === "landing_page",
    agent: "ui-agent",
    rationale: "Landing pages are built by UI Agent (editorial-agent handles copy)",
  },
  {
    condition: (item) => item.contentType === "social_campaign",
    agent: "growth-agent",
    rationale: "Social campaigns are managed by Growth Agent",
  },
  {
    condition: (item) =>
      item.tags.some(tag =>
        ["seo", "keyword", "organic"].includes(tag.toLowerCase())
      ),
    agent: "seo-agent",
    rationale: "SEO-focused content involves SEO Agent",
  },
];

// ─── Title-based routing hints ────────────────────────────────────────────────

function routeByTitle(title: string): AgentName | null {
  const lower = title.toLowerCase();

  const engineeringKeywords = ["api", "backend", "database", "server", "endpoint", "integration", "migration", "service", "infrastructure"];
  const uiKeywords = ["page", "component", "screen", "layout", "form", "modal", "button", "nav", "header", "footer", "responsive", "mobile"];
  const designKeywords = ["design", "wireframe", "mockup", "prototype", "figma", "visual", "brand", "style"];
  const qaKeywords = ["bug", "fix", "broken", "error", "crash", "fail", "test", "regression", "defect"];
  const editorialKeywords = ["article", "blog", "newsletter", "write", "copy", "content", "editorial", "release notes", "announcement"];
  const seoKeywords = ["seo", "keyword", "meta", "search ranking", "serp", "organic"];
  const growthKeywords = ["growth", "marketing", "campaign", "funnel", "email", "a/b", "acquisition", "referral", "retention"];
  const researchKeywords = ["research", "survey", "user interview", "analysis", "competitive", "insights"];

  if (qaKeywords.some(k => lower.includes(k))) return "qa-agent";
  if (seoKeywords.some(k => lower.includes(k))) return "seo-agent";
  if (growthKeywords.some(k => lower.includes(k))) return "growth-agent";
  if (researchKeywords.some(k => lower.includes(k))) return "research-agent";
  if (editorialKeywords.some(k => lower.includes(k))) return "editorial-agent";
  if (designKeywords.some(k => lower.includes(k))) return "design-agent";
  if (uiKeywords.some(k => lower.includes(k))) return "ui-agent";
  if (engineeringKeywords.some(k => lower.includes(k))) return "engineering-agent";

  return null;
}

// ─── Workload detection ───────────────────────────────────────────────────────

function getAgentWorkload(agent: AgentName, storage: Storage): number {
  const inProgress = storage.listTickets({ assignedAgent: agent, status: "in_progress" });
  const inReview = storage.listTickets({ assignedAgent: agent, status: "in_review" });
  return inProgress.length + inReview.length;
}

// ─── Main routing functions ───────────────────────────────────────────────────

export interface RoutingResult {
  agent: AgentName;
  rationale: string;
}

export function routeTicket(ticket: Ticket, override?: AgentName): RoutingResult {
  if (override) {
    return {
      agent: override,
      rationale: `Manual override: assigned to ${override}`,
    };
  }

  // Check tag-based rules first (most specific)
  for (const rule of TICKET_ROUTING_RULES) {
    if (rule.condition(ticket)) {
      return { agent: rule.agent, rationale: rule.rationale };
    }
  }

  // Fall back to title-based routing
  const titleRoute = routeByTitle(ticket.title);
  if (titleRoute) {
    return {
      agent: titleRoute,
      rationale: `Title-based routing: "${ticket.title}" matches ${titleRoute} keywords`,
    };
  }

  // Default: engineering-agent for generic tickets
  return {
    agent: "engineering-agent",
    rationale: "Default routing: unclassified ticket routed to Engineering Agent",
  };
}

export function routeCalendarItem(
  item: EditorialCalendarItem,
  override?: AgentName
): RoutingResult {
  if (override) {
    return {
      agent: override,
      rationale: `Manual override: assigned to ${override}`,
    };
  }

  for (const rule of CALENDAR_ROUTING_RULES) {
    if (rule.condition(item)) {
      return { agent: rule.agent, rationale: rule.rationale };
    }
  }

  // Default: editorial-agent
  return {
    agent: "editorial-agent",
    rationale: "Default routing: calendar items routed to Editorial Agent",
  };
}

export function getAgentQueue(
  agent: AgentName,
  storage: Storage
): { tickets: Ticket[]; calendarItems: EditorialCalendarItem[] } {
  const tickets = storage.listTickets({ assignedAgent: agent });
  const calendarItems = storage.listCalendarItems({ assignedAgent: agent });
  return { tickets, calendarItems };
}

export function getAllQueues(
  storage: Storage
): Record<AgentName, { tickets: Ticket[]; calendarItems: EditorialCalendarItem[] }> {
  const agentNames = Object.keys(AGENT_DIRECTORY) as AgentName[];
  const result = {} as Record<AgentName, { tickets: Ticket[]; calendarItems: EditorialCalendarItem[] }>;

  for (const agent of agentNames) {
    result[agent] = getAgentQueue(agent, storage);
  }

  return result;
}

export function getWorkloadSummary(
  storage: Storage
): Record<AgentName, { inProgress: number; total: number; workload: string }> {
  const agentNames = Object.keys(AGENT_DIRECTORY) as AgentName[];
  const summary = {} as Record<AgentName, { inProgress: number; total: number; workload: string }>;

  for (const agent of agentNames) {
    const inProgress = getAgentWorkload(agent, storage);
    const { tickets } = getAgentQueue(agent, storage);
    const total = tickets.filter(t => t.status !== "done" && t.status !== "icebox").length;

    let workload = "light";
    if (inProgress >= 4) workload = "heavy";
    else if (inProgress >= 2) workload = "moderate";

    summary[agent] = { inProgress, total, workload };
  }

  return summary;
}

export function suggestLeastLoadedAgent(
  candidates: AgentName[],
  storage: Storage
): AgentName {
  let leastLoaded = candidates[0] ?? "engineering-agent";
  let minWorkload = Infinity;

  for (const agent of candidates) {
    const workload = getAgentWorkload(agent, storage);
    if (workload < minWorkload) {
      minWorkload = workload;
      leastLoaded = agent;
    }
  }

  return leastLoaded;
}
