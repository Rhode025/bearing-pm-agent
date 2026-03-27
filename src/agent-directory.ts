import type { AgentName, AgentConfig } from "./types.js";

export const AGENT_DIRECTORY: Record<AgentName, AgentConfig> = {
  "engineering-agent": {
    name: "engineering-agent",
    displayName: "Engineering Agent",
    description:
      "Handles backend development, API integrations, data pipelines, infrastructure, and system architecture. Primary owner of service-layer code, database migrations, and third-party API integrations like Duffel, Amadeus, and Stripe.",
    handles: [
      "backend",
      "api",
      "database",
      "infrastructure",
      "migration",
      "service",
      "endpoint",
      "integration",
      "engineering",
      "server",
      "performance",
      "caching",
      "queue",
      "worker",
      "job",
      "webhook",
      "auth",
      "authentication",
      "authorization",
    ],
    defaultPriority: 2,
  },

  "ui-agent": {
    name: "ui-agent",
    displayName: "UI Agent",
    description:
      "Handles frontend development, React components, Next.js pages, styling, responsive layouts, and user-facing interactions. Owns the component library, design-system tokens, and client-side logic.",
    handles: [
      "ui",
      "frontend",
      "front-end",
      "react",
      "next.js",
      "nextjs",
      "component",
      "page",
      "screen",
      "layout",
      "responsive",
      "css",
      "tailwind",
      "animation",
      "interaction",
      "form",
      "modal",
      "drawer",
      "landing-page",
      "landing page",
    ],
    defaultPriority: 2,
  },

  "design-agent": {
    name: "design-agent",
    displayName: "Design Agent",
    description:
      "Handles UX/UI design, wireframes, prototypes, design system maintenance, and visual QA. Owns Figma files, design tokens, and brand consistency across all surfaces.",
    handles: [
      "design",
      "ux",
      "ui-design",
      "figma",
      "wireframe",
      "prototype",
      "mockup",
      "visual",
      "brand",
      "design-system",
      "design system",
      "typography",
      "color",
      "icon",
      "illustration",
      "review",
      "dashboard",
    ],
    defaultPriority: 3,
  },

  "qa-agent": {
    name: "qa-agent",
    displayName: "QA Agent",
    description:
      "Handles quality assurance, bug triage, regression testing, end-to-end test authoring, and release validation. Escalates critical bugs and maintains the test coverage matrix.",
    handles: [
      "qa",
      "bug",
      "testing",
      "test",
      "regression",
      "e2e",
      "end-to-end",
      "smoke",
      "validation",
      "verification",
      "quality",
      "fix",
      "defect",
      "issue",
    ],
    defaultPriority: 1,
  },

  "editorial-agent": {
    name: "editorial-agent",
    displayName: "Editorial Agent",
    description:
      "Handles content creation, editing, and publishing. Owns the editorial calendar, blog posts, newsletters, articles, announcements, and release notes copy. Works closely with SEO agent for keyword strategy.",
    handles: [
      "article",
      "blog_post",
      "blog post",
      "newsletter",
      "editorial",
      "content",
      "writing",
      "copy",
      "release_notes",
      "release notes",
      "announcement",
      "case_study",
      "case study",
      "content_refresh",
    ],
    defaultPriority: 3,
  },

  "seo-agent": {
    name: "seo-agent",
    displayName: "SEO Agent",
    description:
      "Handles search engine optimization, keyword research, meta tag optimization, structured data, internal linking strategy, and content briefs. Reports on organic traffic and SERP movements.",
    handles: [
      "seo",
      "search",
      "keyword",
      "meta",
      "structured-data",
      "schema",
      "organic",
      "serp",
      "ranking",
      "backlink",
      "sitemap",
      "robots",
    ],
    defaultPriority: 3,
  },

  "research-agent": {
    name: "research-agent",
    displayName: "Research Agent",
    description:
      "Handles user research, competitive analysis, market research, data analysis, and insight synthesis. Produces research reports, user interview summaries, and data-driven recommendations.",
    handles: [
      "research",
      "user-research",
      "survey",
      "interview",
      "competitive",
      "analysis",
      "data",
      "insight",
      "report",
      "market",
      "persona",
      "journey-map",
    ],
    defaultPriority: 4,
  },

  "growth-agent": {
    name: "growth-agent",
    displayName: "Growth Agent",
    description:
      "Handles growth marketing, acquisition campaigns, A/B tests, referral programs, email marketing funnels, and analytics. Owns the growth roadmap and conversion optimization strategy.",
    handles: [
      "growth",
      "marketing",
      "acquisition",
      "campaign",
      "email",
      "funnel",
      "referral",
      "ab-test",
      "a/b",
      "conversion",
      "retention",
      "activation",
      "analytics",
      "social_campaign",
    ],
    defaultPriority: 3,
  },

  "pm-agent": {
    name: "pm-agent",
    displayName: "PM Agent",
    description:
      "The orchestrator. Manages the Kanban board, editorial calendar, sprint planning, initiative tracking, and sub-agent routing. Logs decisions and synthesizes status reports across all workstreams.",
    handles: [
      "pm",
      "planning",
      "roadmap",
      "initiative",
      "sprint",
      "board",
      "kanban",
      "calendar",
      "coordination",
      "handoff",
      "routing",
    ],
    defaultPriority: 5,
  },
};

export function getAgentConfig(name: AgentName): AgentConfig {
  const cfg = AGENT_DIRECTORY[name];
  if (!cfg) throw new Error(`Unknown agent: ${name}`);
  return cfg;
}

export function listAgents(): AgentConfig[] {
  return Object.values(AGENT_DIRECTORY);
}
