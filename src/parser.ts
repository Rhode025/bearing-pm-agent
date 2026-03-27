import { format, addDays, addWeeks, nextDay, parse, isValid } from "date-fns";
import type {
  ParsedIntent,
  ParseResult,
  ExtractedEntities,
  TicketPriority,
  TicketStatus,
  ContentType,
  TicketType,
  AgentName,
} from "./types.js";
import type { Storage } from "./storage.js";

// ─── Agent name aliases ───────────────────────────────────────────────────────

const AGENT_ALIASES: Record<string, AgentName> = {
  engineering: "engineering-agent",
  "engineering-agent": "engineering-agent",
  "engineering agent": "engineering-agent",
  backend: "engineering-agent",
  api: "engineering-agent",
  dev: "engineering-agent",
  developer: "engineering-agent",
  developers: "engineering-agent",
  ui: "ui-agent",
  "ui-agent": "ui-agent",
  "ui agent": "ui-agent",
  frontend: "ui-agent",
  "front-end": "ui-agent",
  "front end": "ui-agent",
  design: "design-agent",
  "design-agent": "design-agent",
  "design agent": "design-agent",
  designer: "design-agent",
  qa: "qa-agent",
  "qa-agent": "qa-agent",
  "qa agent": "qa-agent",
  testing: "qa-agent",
  tester: "qa-agent",
  editorial: "editorial-agent",
  "editorial-agent": "editorial-agent",
  "editorial agent": "editorial-agent",
  content: "editorial-agent",
  writer: "editorial-agent",
  writing: "editorial-agent",
  seo: "seo-agent",
  "seo-agent": "seo-agent",
  "seo agent": "seo-agent",
  research: "research-agent",
  "research-agent": "research-agent",
  "research agent": "research-agent",
  growth: "growth-agent",
  "growth-agent": "growth-agent",
  "growth agent": "growth-agent",
  marketing: "growth-agent",
  pm: "pm-agent",
  "pm-agent": "pm-agent",
  "pm agent": "pm-agent",
  "project manager": "pm-agent",
};

// ─── Keyword patterns ─────────────────────────────────────────────────────────

const CONTENT_TYPE_PATTERNS: Array<{ pattern: RegExp; type: ContentType }> = [
  { pattern: /\barticle\b/i, type: "article" },
  { pattern: /\bblog\s*post\b/i, type: "blog_post" },
  { pattern: /\bnewsletter\b/i, type: "newsletter" },
  { pattern: /\blanding\s*page\b/i, type: "landing_page" },
  { pattern: /\bsocial\s*campaign\b/i, type: "social_campaign" },
  { pattern: /\brelease\s*notes?\b/i, type: "release_notes" },
  { pattern: /\bcontent\s*refresh\b/i, type: "content_refresh" },
  { pattern: /\bcase\s*study\b/i, type: "case_study" },
  { pattern: /\bannouncement\b/i, type: "announcement" },
];

const TICKET_TYPE_PATTERNS: Array<{ pattern: RegExp; type: TicketType }> = [
  { pattern: /\bbug\b/i, type: "bug" },
  { pattern: /\bepic\b/i, type: "epic" },
  { pattern: /\bsubtask\b/i, type: "subtask" },
  { pattern: /\btask\b/i, type: "task" },
  { pattern: /\brelease\s*notes?\b/i, type: "release_note" },
  { pattern: /\binitiative\b/i, type: "initiative" },
];

const PRIORITY_PATTERNS: Array<{ pattern: RegExp; priority: TicketPriority }> = [
  { pattern: /\bcritical\b/i, priority: "critical" },
  { pattern: /\burgent\b/i, priority: "critical" },
  { pattern: /\bhigh\s*priority\b/i, priority: "high" },
  { pattern: /\bhigh\b/i, priority: "high" },
  { pattern: /\blow\s*priority\b/i, priority: "low" },
  { pattern: /\blow\b/i, priority: "low" },
  { pattern: /\bmedium\b/i, priority: "medium" },
  { pattern: /\bnormal\b/i, priority: "medium" },
];

const STATUS_PATTERNS: Array<{ pattern: RegExp; status: TicketStatus }> = [
  { pattern: /\bblocked\b/i, status: "blocked" },
  { pattern: /\bdone\b/i, status: "done" },
  { pattern: /\bcomplete[d]?\b/i, status: "done" },
  { pattern: /\bfinish[ed]?\b/i, status: "done" },
  { pattern: /\bin[\s_-]?progress\b/i, status: "in_progress" },
  { pattern: /\bin[\s_-]?review\b/i, status: "in_review" },
  { pattern: /\breadyb/i, status: "ready" },
  { pattern: /\bicebox\b/i, status: "icebox" },
  { pattern: /\binbox\b/i, status: "inbox" },
  { pattern: /\bbacklog\b/i, status: "inbox" },
];

// ─── Day resolution ───────────────────────────────────────────────────────────

const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTH_MAP: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

function resolveDate(raw: string, referenceDate: Date = new Date()): string | null {
  const lower = raw.toLowerCase().trim();

  if (lower === "today") {
    return format(referenceDate, "yyyy-MM-dd");
  }
  if (lower === "tomorrow") {
    return format(addDays(referenceDate, 1), "yyyy-MM-dd");
  }
  if (lower === "this week" || lower === "this sprint") {
    return format(referenceDate, "yyyy-MM-dd");
  }
  if (lower === "next week") {
    return format(addWeeks(referenceDate, 1), "yyyy-MM-dd");
  }
  if (lower === "next sprint") {
    return format(addWeeks(referenceDate, 2), "yyyy-MM-dd");
  }
  if (lower === "next month") {
    const d = new Date(referenceDate);
    d.setMonth(d.getMonth() + 1);
    return format(d, "yyyy-MM-dd");
  }

  // "next Thursday", "next Monday"
  const nextDayMatch = lower.match(/^next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)$/);
  if (nextDayMatch && nextDayMatch[1]) {
    const dayNum = WEEKDAY_MAP[nextDayMatch[1]];
    if (dayNum !== undefined) {
      // Find next occurrence of that day
      let d = addDays(referenceDate, 1);
      let iterations = 0;
      while (d.getDay() !== dayNum && iterations < 8) {
        d = addDays(d, 1);
        iterations++;
      }
      return format(d, "yyyy-MM-dd");
    }
  }

  // "this Thursday"
  const thisDayMatch = lower.match(/^this\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)$/);
  if (thisDayMatch && thisDayMatch[1]) {
    const dayNum = WEEKDAY_MAP[thisDayMatch[1]];
    if (dayNum !== undefined) {
      let d = new Date(referenceDate);
      let iterations = 0;
      while (d.getDay() !== dayNum && iterations < 8) {
        d = addDays(d, 1);
        iterations++;
      }
      return format(d, "yyyy-MM-dd");
    }
  }

  // "May 14", "April 3"
  const monthDayMatch = lower.match(
    /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?$/
  );
  if (monthDayMatch && monthDayMatch[1] && monthDayMatch[2]) {
    const monthNum = MONTH_MAP[monthDayMatch[1]];
    const day = parseInt(monthDayMatch[2], 10);
    if (monthNum !== undefined && !isNaN(day)) {
      const year = referenceDate.getFullYear();
      const d = new Date(year, monthNum, day);
      if (d < referenceDate) d.setFullYear(year + 1);
      return format(d, "yyyy-MM-dd");
    }
  }

  // "late April", "early May", "mid June"
  const periodMonthMatch = lower.match(
    /^(early|mid|late)\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)$/
  );
  if (periodMonthMatch && periodMonthMatch[1] && periodMonthMatch[2]) {
    const monthNum = MONTH_MAP[periodMonthMatch[2]];
    if (monthNum !== undefined) {
      const period = periodMonthMatch[1];
      const day = period === "early" ? 5 : period === "mid" ? 15 : 25;
      const year = referenceDate.getFullYear();
      const d = new Date(year, monthNum, day);
      if (d < referenceDate) d.setFullYear(year + 1);
      return format(d, "yyyy-MM-dd");
    }
  }

  // ISO format passthrough
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
    return lower;
  }

  // M/D or M/D/YYYY
  const slashDate = lower.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashDate && slashDate[1] && slashDate[2]) {
    const month = parseInt(slashDate[1], 10) - 1;
    const day = parseInt(slashDate[2], 10);
    const year = slashDate[3]
      ? (slashDate[3].length === 2 ? 2000 + parseInt(slashDate[3], 10) : parseInt(slashDate[3], 10))
      : referenceDate.getFullYear();
    const d = new Date(year, month, day);
    if (isValid(d)) return format(d, "yyyy-MM-dd");
  }

  return null;
}

// ─── Date extraction from text ────────────────────────────────────────────────

const DATE_REGEXES: RegExp[] = [
  /\bnext\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/gi,
  /\bthis\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/gi,
  /\b(?:next|this)\s+(?:week|sprint|month)\b/gi,
  /\btoday\b/gi,
  /\btomorrow\b/gi,
  /\b(?:early|mid|late)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/gi,
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
];

function extractDates(text: string): { raw: string[]; resolved: string[] } {
  const rawDates: string[] = [];
  const resolvedDates: string[] = [];
  const seen = new Set<string>();

  for (const regex of DATE_REGEXES) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const raw = match[0].trim();
      if (!seen.has(raw.toLowerCase())) {
        seen.add(raw.toLowerCase());
        rawDates.push(raw);
        const resolved = resolveDate(raw);
        if (resolved) resolvedDates.push(resolved);
      }
    }
  }

  return { raw: rawDates, resolved: resolvedDates };
}

// ─── Agent extraction ─────────────────────────────────────────────────────────

function extractAgents(text: string): AgentName[] {
  const lower = text.toLowerCase();
  const found = new Set<AgentName>();

  // "have [agent] do X" / "assign to [agent]" / "[agent] should"
  for (const [alias, agent] of Object.entries(AGENT_ALIASES)) {
    if (lower.includes(alias.toLowerCase())) {
      found.add(agent);
    }
  }

  return Array.from(found);
}

// ─── Raw assignment extraction ────────────────────────────────────────────────

function extractAssignments(
  text: string
): Array<{ agent: AgentName; task: string }> {
  const assignments: Array<{ agent: AgentName; task: string }> = [];
  const lower = text.toLowerCase();

  // "have [agent] [do/review/focus on/work on] X"
  const havePattern = /have\s+([\w\s-]+?)\s+(?:do|work on|review|focus on|handle|build|write)\s+(.+?)(?:\s+and\s+|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = havePattern.exec(text)) !== null) {
    if (m[1] && m[2]) {
      const agentRaw = m[1].trim().toLowerCase();
      const agentName = AGENT_ALIASES[agentRaw];
      if (agentName) {
        assignments.push({ agent: agentName, task: m[2].trim() });
      }
    }
  }

  // "[agent] focus on X" / "[agent] should focus on X"
  const focusPattern = /(engineering|design|ui|editorial|qa|seo|research|growth)\s+(?:should\s+)?focus\s+on\s+(.+?)(?:\s+and\s+|$)/gi;
  while ((m = focusPattern.exec(text)) !== null) {
    if (m[1] && m[2]) {
      const agentRaw = m[1].trim().toLowerCase();
      const agentName = AGENT_ALIASES[agentRaw];
      if (agentName) {
        assignments.push({ agent: agentName, task: m[2].trim() });
      }
    }
  }

  // "assign X to [agent]"
  const assignToPattern = /assign\s+(.+?)\s+to\s+([\w\s-]+?)(?:\s*$|\s+and\b)/gi;
  while ((m = assignToPattern.exec(text)) !== null) {
    if (m[2]) {
      const agentRaw = m[2].trim().toLowerCase();
      const agentName = AGENT_ALIASES[agentRaw];
      if (agentName && m[1]) {
        assignments.push({ agent: agentName, task: m[1].trim() });
      }
    }
  }

  return assignments;
}

// ─── Intent classification ─────────────────────────────────────────────────────

interface IntentRule {
  patterns: RegExp[];
  intent: ParsedIntent;
  weight: number;
}

const INTENT_RULES: IntentRule[] = [
  // Status / summary requests
  {
    patterns: [
      /what'?s?\s+in\s+flight/i,
      /show\s+(?:me\s+)?(?:the\s+)?board/i,
      /what\s+are\s+we\s+working\s+on/i,
      /status\s+update/i,
      /current\s+status/i,
      /what'?s?\s+happening/i,
      /show\s+(?:me\s+)?(?:the\s+)?status/i,
    ],
    intent: "request_status",
    weight: 1.0,
  },
  {
    patterns: [
      /give\s+me\s+a\s+summary/i,
      /weekly\s+summary/i,
      /daily\s+summary/i,
      /sprint\s+summary/i,
      /what\s+did\s+we\s+do/i,
      /what\s+have\s+we\s+done/i,
    ],
    intent: "request_summary",
    weight: 1.0,
  },

  // Mark done / blocked
  {
    patterns: [
      /mark\s+(?:it\s+|that\s+)?(?:as\s+)?done/i,
      /close\s+(?:it|that|ticket)/i,
      /finish(?:ed)?\s+(?:that|it)/i,
      /that'?s?\s+done/i,
      /(?:it|that)\s+is\s+done/i,
    ],
    intent: "mark_done",
    weight: 1.0,
  },
  {
    patterns: [
      /(?:mark|move)\s+(?:it|that|this)?\s*(?:to\s+)?blocked/i,
      /(?:mark|move)\s+.+?\s+(?:to\s+)?blocked/i,
      /it'?s?\s+blocked/i,
      /blocked\s+(?:by|on|because)/i,
      /blocking\s+issue/i,
    ],
    intent: "mark_blocked",
    weight: 1.0,
  },

  // Move ticket
  {
    patterns: [
      /move\s+(?:it|that|this|ticket)?\s*to\s+/i,
      /move\s+.+?\s+to\s+(?:blocked|done|in.?progress|in.?review|ready|inbox|icebox)/i,
      /update\s+(?:status|it|that)\s+to/i,
      /change\s+(?:status|it|that)\s+to/i,
      /put\s+(?:it|that)\s+in(?:to)?\s+/i,
    ],
    intent: "move_ticket",
    weight: 0.9,
  },

  // Assign
  {
    patterns: [
      /assign\s+(?:to|it\s+to)/i,
      /have\s+(?:engineering|design|ui|editorial|qa|seo|research|growth|engineering-agent|design-agent)/i,
      /(?:engineering|design|ui|editorial|qa|seo|research|growth)\s+(?:should|needs?\s+to|will)\s+/i,
      /give\s+(?:it|that|this)\s+to/i,
      /hand\s+(?:it|that|this)\s+(?:off\s+)?to/i,
    ],
    intent: "assign",
    weight: 0.9,
  },

  // Route to agent
  {
    patterns: [
      /(?:have|get)\s+(?:engineering|design|ui|editorial|qa|seo|research|growth)\s+(?:review|check|look\s+at)/i,
      /route\s+(?:to|it\s+to)/i,
      /(?:engineering|design|ui|editorial|qa|seo|research|growth)\s+(?:agent\s+)?should\s+(?:review|check)/i,
    ],
    intent: "route_to_agent",
    weight: 0.85,
  },

  // Sprint operations
  {
    patterns: [
      /create\s+(?:a\s+)?(?:new\s+)?sprint/i,
      /new\s+sprint/i,
      /start\s+(?:a\s+)?sprint/i,
    ],
    intent: "create_sprint",
    weight: 1.0,
  },
  {
    patterns: [
      /(?:add\s+(?:to|it\s+to)|put\s+(?:in|into|on))\s+(?:next|this|current)\s+sprint/i,
      /(?:next|this)\s+sprint\s+(?:scope|items?|tickets?)/i,
      /plan\s+(?:the\s+)?sprint/i,
    ],
    intent: "plan_sprint",
    weight: 0.9,
  },

  // Calendar operations
  {
    patterns: [
      /put\s+(?:that|it|this)\s+on\s+(?:the\s+)?calendar/i,
      /schedule\s+(?:it|that|the\s+article|the\s+post|the\s+newsletter)/i,
      /add\s+to\s+(?:the\s+)?calendar/i,
      /calendar\s+for\s+/i,
    ],
    intent: "schedule_calendar_item",
    weight: 1.0,
  },
  {
    patterns: [
      /update\s+(?:the\s+)?(?:article|blog|newsletter|calendar\s+item)/i,
      /change\s+(?:the\s+)?(?:article|blog|newsletter)/i,
    ],
    intent: "update_calendar_item",
    weight: 0.85,
  },
  {
    patterns: [
      /\b(?:article|blog\s*post|newsletter|landing\s*page|release\s*notes?|case\s*study|announcement)\s+(?:idea|about|on|for)\b/i,
      /(?:idea|write|draft)\s+(?:an?\s+)?(?:article|blog\s*post|newsletter)/i,
      /put\s+(?:together\s+)?(?:an?\s+)?(?:article|blog\s*post|newsletter)\b/i,
      /\bwrite\s+release\s+notes?\b/i,
    ],
    intent: "create_calendar_item",
    weight: 0.95,
  },

  // Initiative
  {
    patterns: [
      /create\s+(?:an?\s+)?initiative/i,
      /new\s+initiative/i,
      /we\s+are\s+focusing\s+(?:on\s+)?(?:\w+\s+on\s+)?/i,
      /focusing\s+(?:\w+\s+)?on\s+/i,
      /(?:april|may|june|july|q[1-4])\s+(?:focus|initiative|push)/i,
    ],
    intent: "create_initiative",
    weight: 0.9,
  },

  // Decisions
  {
    patterns: [
      /we\s+(?:are|will|have)\s+focusing/i,
      /we\s+decided\s+to/i,
      /decision[:\s]/i,
      /going\s+(?:with|forward\s+with)/i,
      /we'?re?\s+prioritizing/i,
    ],
    intent: "log_decision",
    weight: 0.9,
  },

  // Prioritize
  {
    patterns: [
      /prioritize\s+/i,
      /make\s+(?:it|that|this)\s+(?:high|critical|urgent|low|medium)\s+priority/i,
      /(?:bump|increase|lower)\s+(?:the\s+)?priority/i,
      /high\s+priority/i,
      /critical\s+(?:issue|bug|ticket)/i,
    ],
    intent: "prioritize",
    weight: 0.85,
  },

  // Split / merge
  {
    patterns: [/split\s+(?:it|that|this|the\s+ticket)/i, /break\s+(?:it|that|this)\s+(?:down|up)/i],
    intent: "split_work",
    weight: 0.9,
  },
  {
    patterns: [/merge\s+(?:these|those|the)\s+(?:two\s+)?tickets?/i, /they'?re?\s+duplicates?/i],
    intent: "merge_duplicates",
    weight: 0.9,
  },

  // Update ticket
  {
    patterns: [
      /update\s+(?:the\s+)?(?:ticket|task|item)/i,
      /edit\s+(?:the\s+)?(?:ticket|task|item)/i,
      /change\s+(?:the\s+)?(?:title|description|estimate)/i,
    ],
    intent: "update_ticket",
    weight: 0.85,
  },

  // Create ticket (broad — check LAST after calendar)
  {
    patterns: [
      /\b(?:build|create|add|make|implement|fix|set\s+up|scaffold|refactor)\b/i,
      /\b(?:we\s+need|we\s+should|let'?s?\s+(?:build|create|add|make))\b/i,
      /\bnew\s+(?:ticket|task|feature|page|component|screen|endpoint|service)\b/i,
    ],
    intent: "create_ticket",
    weight: 0.7,
  },
];

export function classifyIntents(text: string): Array<{ intent: ParsedIntent; confidence: number }> {
  const results: Array<{ intent: ParsedIntent; confidence: number }> = [];
  const seenIntents = new Set<ParsedIntent>();

  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        if (!seenIntents.has(rule.intent)) {
          seenIntents.add(rule.intent);
          results.push({ intent: rule.intent, confidence: rule.weight });
        }
        break;
      }
    }
  }

  return results;
}

// ─── Entity extraction ─────────────────────────────────────────────────────────

function extractContentTitles(text: string): string[] {
  const titles: string[] = [];

  // "article about X", "blog post on X", "newsletter about X"
  const aboutPatterns = [
    /(?:article|blog\s*post|newsletter|case\s*study)\s+(?:idea[:\s]+|about|on|for)\s+["""]?(.+?)["""]?(?:\s+(?:and\s+put|and\s+on|for|by|next\s+sprint|this\s+sprint|put\s+it|put\s+on|put\s+the)|$)/gi,
    /(?:write|draft|create)\s+(?:an?\s+)?(?:article|blog\s*post|newsletter)\s+(?:about|on|for)?\s+["""]?(.+?)["""]?(?:\s+(?:and|for|on|by|next|this|the|put)|$)/gi,
    // release notes extraction — capture the subject separately
    /(?:write|create)\s+release\s+notes?\s+(?:for\s+)?(?:the\s+)?["""]?(.+?)["""]?(?:\s+and\s+put|\s+and\s+add|\s+and\s+schedule|\s*$)/gi,
  ];

  for (const pattern of aboutPatterns) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[1]) {
        const cleaned = m[1].trim().replace(/\s+/g, " ");
        if (cleaned.length > 2 && cleaned.length < 200) {
          titles.push(cleaned);
        }
      }
    }
  }

  return [...new Set(titles)];
}

function extractTicketTitles(text: string, contentTitles: string[]): string[] {
  const titles: string[] = [];

  // Quoted titles
  const quotedPattern = /["""](.+?)["""]/g;
  let m: RegExpExecArray | null;
  while ((m = quotedPattern.exec(text)) !== null) {
    if (m[1]) titles.push(m[1].trim());
  }

  // "build X" / "create X" / "add X" / "implement X"
  const buildPatterns = [
    /(?:build|create|add|make|implement|fix|set\s+up|scaffold|refactor)\s+(?:a\s+|an\s+|the\s+)?(.+?)(?:\s+(?:next|this|for|by|on)\s+sprint|\s+by\s+|\s+due\s+|$)/gi,
    /(?:new\s+)(?:ticket\s+for|task\s+for|feature\s+for)?\s*(.+?)(?:\s+next\s+sprint|\s+by\s+|$)/gi,
  ];

  for (const pattern of buildPatterns) {
    pattern.lastIndex = 0;
    while ((m = pattern.exec(text)) !== null) {
      if (m[1]) {
        const candidate = m[1].trim();
        // Skip if it's an agent reference or a date keyword
        if (
          candidate.length > 2 &&
          candidate.length < 150 &&
          !Object.keys(AGENT_ALIASES).some(a => candidate.toLowerCase().startsWith(a)) &&
          !contentTitles.includes(candidate)
        ) {
          titles.push(candidate);
        }
      }
    }
  }

  return [...new Set(titles)];
}

function extractInitiatives(text: string): string[] {
  const initiatives: string[] = [];

  // "we are focusing April on X and Y"
  const focusPat = /(?:we\s+are\s+focusing\s+\w+\s+on|focusing\s+(?:\w+\s+)?on)\s+(.+?)(?:\s+and\s+(.+?))?(?:\s*$|\s+this|\s+next)/i;
  const m = focusPat.exec(text);
  if (m) {
    if (m[1]) initiatives.push(m[1].trim());
    if (m[2]) initiatives.push(m[2].trim());
  }

  return initiatives;
}

function extractBlockers(text: string): string[] {
  const blockers: string[] = [];

  // "X is unstable", "blocked because X", "blocked by X"
  const blockerPat = /(?:blocked\s+(?:by|because|on|due\s+to)|blocking\s+issue[:\s]+)\s*(.+?)(?:\s*$|\.)/gi;
  let m: RegExpExecArray | null;
  while ((m = blockerPat.exec(text)) !== null) {
    if (m[1]) blockers.push(m[1].trim());
  }

  // "X API is unstable"
  const apiUnstable = /(\w+\s+api)\s+is\s+(?:unstable|down|broken|flaky)/gi;
  while ((m = apiUnstable.exec(text)) !== null) {
    if (m[1]) blockers.push(m[1].trim());
  }

  return blockers;
}

function extractSprintRefs(text: string): Array<"next" | "current" | "backlog" | string> {
  const refs: Array<"next" | "current" | "backlog" | string> = [];
  const lower = text.toLowerCase();

  if (/next\s+sprint/.test(lower)) refs.push("next");
  if (/(?:this|current)\s+sprint/.test(lower) || /this\s+week/.test(lower)) refs.push("current");
  if (/backlog/.test(lower)) refs.push("backlog");

  return refs;
}

function extractTicketRefs(text: string): string[] {
  const refs: string[] = [];
  const lower = text.toLowerCase();

  const fuzzyPhrases = [
    "that one", "move it", "it", "that ticket", "the ticket", "that item",
    "the dashboard ticket", "the travel windows ticket", "the article",
    "the blog post", "the newsletter",
  ];

  for (const phrase of fuzzyPhrases) {
    if (lower.includes(phrase)) {
      refs.push(phrase);
    }
  }

  // UUID-style IDs
  const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  let m: RegExpExecArray | null;
  while ((m = uuidPattern.exec(text)) !== null) {
    refs.push(m[0]);
  }

  return refs;
}

function extractTags(text: string): string[] {
  const tags: string[] = [];
  const lower = text.toLowerCase();

  const tagKeywords = [
    "ui", "frontend", "backend", "api", "design", "engineering", "seo",
    "research", "growth", "mobile", "performance", "onboarding", "travel-windows",
    "travel windows", "dashboard", "fare-drop", "fare drop", "member", "launch",
    "polish", "release",
  ];

  for (const kw of tagKeywords) {
    if (lower.includes(kw)) {
      tags.push(kw.replace(/\s+/g, "-"));
    }
  }

  return [...new Set(tags)];
}

// ─── Main parse function ───────────────────────────────────────────────────────

export function normalizeText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .trim();
}

export function parseMessage(text: string, storage?: Storage): ParseResult {
  const normalized = normalizeText(text);
  const intentResults = classifyIntents(normalized);

  const intents = intentResults.map(r => r.intent);
  const overallConfidence =
    intentResults.length > 0
      ? intentResults.reduce((sum, r) => sum + r.confidence, 0) / intentResults.length
      : 0;

  const contentTitles = extractContentTitles(normalized);
  const ticketTitles = extractTicketTitles(normalized, contentTitles);
  const agents = extractAgents(normalized);
  const assignments = extractAssignments(normalized);
  const { raw: rawDates, resolved: resolvedDates } = extractDates(normalized);

  const priorities: TicketPriority[] = [];
  for (const { pattern, priority } of PRIORITY_PATTERNS) {
    if (pattern.test(normalized)) {
      priorities.push(priority);
    }
  }

  const statuses: TicketStatus[] = [];
  for (const { pattern, status } of STATUS_PATTERNS) {
    if (pattern.test(normalized)) {
      statuses.push(status);
    }
  }

  const contentTypes: ContentType[] = [];
  const seenContentTypes = new Set<ContentType>();
  for (const { pattern, type } of CONTENT_TYPE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(normalized) && !seenContentTypes.has(type)) {
      seenContentTypes.add(type);
      contentTypes.push(type);
    }
  }

  const ticketTypes: TicketType[] = [];
  for (const { pattern, type } of TICKET_TYPE_PATTERNS) {
    if (pattern.test(normalized)) {
      ticketTypes.push(type);
    }
  }

  const tags = extractTags(normalized);
  const initiatives = extractInitiatives(normalized);
  const blockers = extractBlockers(normalized);
  const sprintRefs = extractSprintRefs(normalized);
  const ticketRefs = extractTicketRefs(normalized);

  // Infer calendar vs ticket intents based on content
  const hasContentType = contentTypes.length > 0;
  const hasContentTitle = contentTitles.length > 0;
  if ((hasContentType || hasContentTitle) && !intents.includes("create_calendar_item")) {
    if (
      !intents.includes("schedule_calendar_item") &&
      !intents.includes("update_calendar_item") &&
      (intents.includes("create_ticket") || intents.length === 0)
    ) {
      const idx = intents.indexOf("create_ticket");
      if (idx >= 0) intents.splice(idx, 1);
      intents.unshift("create_calendar_item");
    }
  }

  return {
    intents,
    entities: {
      ticketTitles,
      contentTitles,
      agentNames: agents,
      rawDates,
      resolvedDates,
      priorities,
      statuses,
      contentTypes,
      ticketTypes,
      tags,
      initiatives,
      decisions: [],
      blockers,
      sprintRefs,
      ticketRefs,
      calendarRefs: [],
      rawAssignments: assignments,
    },
    confidence: overallConfidence,
    raw: text,
    normalized,
  };
}

// ─── Entity reference resolution ──────────────────────────────────────────────

export function resolveEntityReferences(
  parsed: ParseResult,
  storage: Storage
): ParseResult {
  const ctx = storage.getRecentContext();
  const resolved = { ...parsed };

  // Resolve fuzzy ticket refs like "that one", "move it", "the ticket"
  const fuzzyRefs = ["that one", "move it", "it", "that ticket", "the ticket", "that item"];
  const hasFuzzyRef = parsed.entities.ticketRefs.some(r =>
    fuzzyRefs.includes(r.toLowerCase())
  );

  if (hasFuzzyRef && ctx.lastTicketId) {
    resolved.entities = {
      ...resolved.entities,
      ticketRefs: [
        ctx.lastTicketId,
        ...resolved.entities.ticketRefs.filter(r => !fuzzyRefs.includes(r.toLowerCase())),
      ],
    };
  }

  // Resolve "the article", "the blog post" etc.
  const calendarFuzzyRefs = ["the article", "the blog post", "the newsletter", "the post"];
  const hasFuzzyCalRef = parsed.entities.ticketRefs.some(r =>
    calendarFuzzyRefs.includes(r.toLowerCase())
  );
  if (hasFuzzyCalRef && ctx.lastCalendarItemId) {
    resolved.entities = {
      ...resolved.entities,
      calendarRefs: [
        ctx.lastCalendarItemId,
        ...resolved.entities.calendarRefs,
      ],
    };
  }

  return resolved;
}
