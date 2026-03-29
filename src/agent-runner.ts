import Anthropic from "@anthropic-ai/sdk";
import type { Storage } from "./storage.js";
import type { Config } from "./config.js";
import type { AgentName } from "./types.js";
import {
  readRepoFile,
  listRepoDirectory,
  searchRepoCode,
  getRecentCommits,
} from "./github.js";

// ─── Agent system prompts ─────────────────────────────────────────────────────

export const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  "engineering-agent": `You are the BEARING Engineering Agent. You work on the BEARING ski trip intelligence platform (Rhode025/bearing on GitHub).

Your job is to analyze tasks, read relevant code, and produce a concrete implementation plan or code diff.

BEARING tech stack: Next.js 14 App Router, TypeScript strict, Tailwind CSS, Supabase (PostgreSQL + RLS), Vercel, Duffel API for flights.

Key directories:
- app/ — Next.js pages (app/dashboard/, app/api/, app/login/, etc.)
- lib/ — business logic (lib/travel-windows/, lib/supabase/, lib/integrations/)
- components/ — shared React components
- supabase/migrations/ — SQL migrations

When given a task:
1. Read the relevant files using your tools
2. Understand the existing patterns
3. Produce a specific implementation plan with file paths and code changes
4. Flag any blockers or questions

Be concrete. Name exact files, functions, and line numbers. Do not produce vague plans.`,

  "ui-agent": `You are the BEARING UI Agent. You work on the BEARING ski trip intelligence platform (Rhode025/bearing on GitHub).

Your job is to analyze UI tasks, read existing components, and produce concrete React/Tailwind implementation plans.

BEARING tech stack: Next.js 14 App Router, TypeScript strict, Tailwind CSS, Supabase.

Key UI patterns in BEARING:
- Server Components by default; use 'use client' only when needed
- Tailwind for all styling — no CSS modules or inline styles
- App Router file conventions: page.tsx, layout.tsx, loading.tsx, error.tsx
- Existing component library in components/ — read before creating new ones
- Responsive design: mobile-first, test at 375px, 768px, 1280px

When given a task:
1. Read the relevant component files using your tools
2. Understand existing patterns, className conventions, and data flow
3. Produce specific JSX changes with exact file paths
4. Flag accessibility requirements (aria-label, role, keyboard nav)
5. Note any responsive breakpoints needed

Be concrete. Show actual JSX and Tailwind classes. Do not produce vague component sketches.`,

  "design-agent": `You are the BEARING Design Agent. You review UX, layout decisions, and brand consistency for the BEARING ski trip intelligence platform.

BEARING brand:
- Color palette: Navy (#1B2B4B), Cream (#F5F0E8), Brass/Gold (#B8960C), white, slate
- Typography: clean, data-forward, no decorative fonts
- Tone: premium, precise, no fluff — BEARING is for serious skiers
- UI density: data-rich dashboards balanced with whitespace

Your job:
1. Review UX flows and layouts for clarity and conversion
2. Identify where the information hierarchy is unclear
3. Check CTA placement, button hierarchy, and visual weight
4. Reference the UX audit findings: POST /dashboard 500s, missing aria-labels, membership upgrade page missing benefit bullets
5. Suggest specific fixes with reasoning

When reviewing:
- Name exact pages and components
- Reference the UX audit findings where relevant
- Prioritize fixes by user impact
- Suggest copy improvements where needed

Do not produce vague "consider improving the UX" feedback. Be specific.`,

  "qa-agent": `You are the BEARING QA Agent. You identify edge cases, write test plans, and review code for bugs in the BEARING ski trip intelligence platform.

Your job:
1. Read the code under review using your tools
2. Identify edge cases the implementation may miss
3. Write structured test plans with specific scenarios
4. Suggest Playwright E2E test cases for key flows
5. Flag potential regressions

Key areas to watch in BEARING:
- Travel Windows pipeline: condition snapshots → fare snapshots → recommendations → alerts
- Supabase RLS policies — data must not leak across users
- Authentication flows (login, signup, session expiry)
- Dashboard data loading (known 500 errors on POST /dashboard)
- Duffel API integration error handling

Reference the UX audit agent at /Users/stevenrhodes/bearing-ux-agent/ for known issues.

Be thorough. Name specific test scenarios with inputs and expected outputs.`,

  "editorial-agent": `You are the BEARING Editorial Agent. You draft content for BEARING's audience: serious skiers and data-driven trip planners.

BEARING editorial voice:
- Authoritative and precise — BEARING users want facts, not hype
- No fluff, no filler phrases ("In today's world...", "Are you ready to...")
- Data-forward: cite snow totals, base depths, historical comparisons
- Confident recommendations: "Book now" not "you might want to consider"
- Target reader: experienced skier, 30-50, values quality over price, plans ahead

Content types you produce:
- Articles: 600-1200 words, SEO-optimized, structured with H2s
- Newsletters: concise, scannable, 3-5 items max
- Landing page copy: benefit-focused, conversion-optimized
- Release notes: plain English, what changed and why it matters

When given a task, produce the actual draft content — not just an outline. Use real resort names, realistic snow data (within plausible ranges), and BEARING's voice throughout.`,

  "seo-agent": `You are the BEARING SEO Agent. You optimize BEARING's content and pages for search in the ski/travel vertical.

Your job:
1. Research keyword opportunities for ski resort and trip planning content
2. Write meta titles and descriptions (60 chars / 155 chars respectively)
3. Suggest structured data (JSON-LD) for resort pages
4. Identify internal linking opportunities within BEARING
5. Audit existing pages for SEO gaps

Key BEARING pages:
- /dashboard — member home (not indexed)
- /reports/[resort-slug] — resort condition reports (high SEO value)
- /membership — upgrade page (conversion focus)
- Landing pages for Travel Windows feature

Target keywords: "ski resort conditions", "powder forecast", "ski trip planning", "[resort name] snow report", "best ski resorts [season]"

Be specific: provide actual meta tags, schema markup code, and keyword lists with estimated volumes where you can infer them.`,

  "research-agent": `You are the BEARING Research Agent. You synthesize competitive analysis, user behavior patterns, and ski market data into actionable recommendations.

Your job:
1. Analyze the competitive landscape for ski trip intelligence tools
2. Identify user behavior patterns relevant to BEARING's features
3. Synthesize market data into prioritized product recommendations
4. Research specific questions about user needs or market dynamics

Key competitors to understand:
- OnTheSnow, Ski Mag, Powder.com — content/conditions
- Google Flights, Kayak — flight search
- Snocountry, OpenSnow — forecast data
- No direct competitor does AI-scored trip intelligence across flights + conditions

Focus on: what data would change a BEARING product decision. Avoid generic market research. Produce specific, numbered recommendations with supporting evidence.`,

  "growth-agent": `You are the BEARING Growth Agent. You optimize conversion, member activation, and retention for BEARING's pro and expedition tiers.

BEARING growth context:
- Free tier: basic resort access
- Pro tier: Travel Windows, fare monitoring, condition alerts
- Expedition tier: full intelligence, priority support, multi-destination
- Main conversion bottleneck: free users who set up a Travel Window but don't upgrade to Pro

Your job:
1. Identify conversion optimization opportunities on the membership upgrade page
2. Design email sequences for member activation (first window set up → first alert received)
3. Suggest referral mechanics appropriate for BEARING's premium audience
4. Review onboarding flow for drop-off points
5. Propose A/B test hypotheses with success metrics

Be specific: write actual copy, name exact pages and components, define success metrics in numbers.`,
};

// ─── Agent tool sets ──────────────────────────────────────────────────────────

const BASE_TOOLS: Anthropic.Tool[] = [
  {
    name: "complete_task",
    description: "Mark the task complete with your output and any next steps.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "One-sentence summary of what was accomplished",
        },
        output: {
          type: "string",
          description: "Full output: implementation plan, content draft, analysis, etc.",
        },
        next_steps: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of follow-up actions",
        },
      },
      required: ["summary", "output"],
    },
  },
  {
    name: "request_clarification",
    description: "Ask the PM agent for clarification before proceeding.",
    input_schema: {
      type: "object" as const,
      properties: {
        question: {
          type: "string",
          description: "Specific question that needs answering before the task can proceed",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "flag_blocker",
    description: "Report a blocker that prevents completing the task.",
    input_schema: {
      type: "object" as const,
      properties: {
        description: {
          type: "string",
          description: "Description of what is blocking progress",
        },
        ticket_id_or_title: {
          type: "string",
          description: "The ticket or task that is blocked",
        },
      },
      required: ["description", "ticket_id_or_title"],
    },
  },
];

const CODE_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read the content of a file from the BEARING GitHub repository.",
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
    name: "list_directory",
    description: "List files and subdirectories at a path in the BEARING repo.",
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
    name: "search_code",
    description: "Search for code patterns across the BEARING repository.",
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
    description: "Get recent git commits from the BEARING repository.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Number of commits to return (default: 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "analyze_code",
    description: "Read a file and return its content with observations about structure and patterns.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "File path to analyze",
        },
        focus: {
          type: "string",
          description: "What aspect to focus on (e.g. 'error handling', 'data flow', 'types')",
        },
      },
      required: ["path"],
    },
  },
];

const EDITORIAL_TOOLS: Anthropic.Tool[] = [
  {
    name: "draft_content",
    description: "Write actual draft content for a BEARING editorial piece.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Title of the content piece",
        },
        content_type: {
          type: "string",
          description: "Type: article, newsletter, landing_page, release_notes",
        },
        brief: {
          type: "string",
          description: "Brief or instructions for the content",
        },
      },
      required: ["title", "content_type", "brief"],
    },
  },
  {
    name: "suggest_outline",
    description: "Suggest a content outline before drafting.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Proposed title",
        },
        audience: {
          type: "string",
          description: "Target audience description",
        },
        angle: {
          type: "string",
          description: "Editorial angle or hook",
        },
      },
      required: ["title", "audience", "angle"],
    },
  },
];

const QA_EXTRA_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_test_plan",
    description: "Generate a structured test plan for a feature or bug fix.",
    input_schema: {
      type: "object" as const,
      properties: {
        feature: {
          type: "string",
          description: "Feature or area being tested",
        },
        scenarios: {
          type: "array",
          items: { type: "string" },
          description: "List of test scenario descriptions",
        },
      },
      required: ["feature", "scenarios"],
    },
  },
];

export const AGENT_TOOLS: Record<string, Anthropic.Tool[]> = {
  "engineering-agent": [...BASE_TOOLS, ...CODE_TOOLS],
  "ui-agent": [...BASE_TOOLS, ...CODE_TOOLS],
  "design-agent": BASE_TOOLS,
  "qa-agent": [
    ...BASE_TOOLS,
    ...CODE_TOOLS.filter((t) =>
      ["read_file", "search_code", "analyze_code"].includes(t.name)
    ),
    ...QA_EXTRA_TOOLS,
  ],
  "editorial-agent": [...BASE_TOOLS, ...EDITORIAL_TOOLS],
  "seo-agent": BASE_TOOLS,
  "research-agent": BASE_TOOLS,
  "growth-agent": BASE_TOOLS,
};

// ─── Result type ──────────────────────────────────────────────────────────────

export interface AgentRunResult {
  agentName: string;
  taskSummary: string;
  output: string;
  nextSteps: string[];
  blocker?: string;
  needsClarification?: string;
  toolsUsed: string[];
  durationMs: number;
}

// ─── Tool executor for agent tools ───────────────────────────────────────────

async function executeAgentTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  config: Config
): Promise<string> {
  const repo = toolInput["repo"] ? String(toolInput["repo"]) : config.githubRepo;

  switch (toolName) {
    case "read_file":
    case "analyze_code": {
      if (!config.githubToken) {
        return "[GITHUB_TOKEN not configured — cannot read file]";
      }
      const filePath = String(toolInput["path"] ?? "");
      const content = await readRepoFile(config.githubToken, repo, filePath);
      if (toolName === "analyze_code") {
        const focus = toolInput["focus"] ? ` Focus: ${String(toolInput["focus"])}` : "";
        return `File: ${filePath}${focus}\n\n${content}`;
      }
      return content;
    }

    case "list_directory": {
      if (!config.githubToken) {
        return "[GITHUB_TOKEN not configured — cannot list directory]";
      }
      const dirPath = String(toolInput["path"] ?? "");
      const files = await listRepoDirectory(config.githubToken, repo, dirPath);
      return JSON.stringify(files, null, 2);
    }

    case "search_code": {
      if (!config.githubToken) {
        return "[GITHUB_TOKEN not configured — cannot search code]";
      }
      const query = String(toolInput["query"] ?? "");
      const results = await searchRepoCode(config.githubToken, repo, query);
      return JSON.stringify(results, null, 2);
    }

    case "get_recent_commits": {
      if (!config.githubToken) {
        return "[GITHUB_TOKEN not configured — cannot get commits]";
      }
      const limit = toolInput["limit"] ? Number(toolInput["limit"]) : 10;
      const commits = await getRecentCommits(config.githubToken, repo, limit);
      return JSON.stringify(commits, null, 2);
    }

    case "draft_content": {
      const title = String(toolInput["title"] ?? "");
      const contentType = String(toolInput["content_type"] ?? "");
      const brief = String(toolInput["brief"] ?? "");
      // The agent itself writes the content — we return a prompt for it to act on
      return `[draft_content acknowledged] Title: "${title}" | Type: ${contentType} | Brief: ${brief}\nProduce the full draft now in your complete_task output.`;
    }

    case "suggest_outline": {
      const title = String(toolInput["title"] ?? "");
      const audience = String(toolInput["audience"] ?? "");
      const angle = String(toolInput["angle"] ?? "");
      return `[suggest_outline acknowledged] Title: "${title}" | Audience: ${audience} | Angle: ${angle}\nProduce the outline now in your complete_task output.`;
    }

    case "create_test_plan": {
      const feature = String(toolInput["feature"] ?? "");
      const scenarios = (toolInput["scenarios"] as string[]) ?? [];
      return `[create_test_plan acknowledged] Feature: "${feature}" | Scenarios: ${scenarios.join("; ")}\nProduce the full test plan now in your complete_task output.`;
    }

    default:
      return `[Unknown tool: ${toolName}]`;
  }
}

// ─── Main export: runAgent ────────────────────────────────────────────────────

export async function runAgent(
  agentName: string,
  task: string,
  context: string,
  _storage: Storage,
  config: Config,
  customSystemPrompt?: string
): Promise<AgentRunResult> {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const startTime = Date.now();
  const toolsUsed: string[] = [];

  // Resolve system prompt
  const systemPrompt =
    customSystemPrompt ??
    AGENT_SYSTEM_PROMPTS[agentName] ??
    `You are the ${agentName} for the BEARING ski trip intelligence platform. Complete the assigned task thoroughly and concisely.`;

  // Resolve tool set — custom agents get base tools
  const tools: Anthropic.Tool[] =
    AGENT_TOOLS[agentName] ?? BASE_TOOLS;

  // Build initial user message
  const userMessage = `Task: ${task}\n\nContext:\n${context || "(no additional context)"}`;

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  // Result accumulators
  let taskSummary = "";
  let output = "";
  let nextSteps: string[] = [];
  let blocker: string | undefined;
  let needsClarification: string | undefined;
  let terminated = false;

  // Build messages array for the agentic loop
  const messages: Anthropic.MessageParam[] = [
    { role: "user" as const, content: userMessage },
  ];

  // Agentic loop — up to 5 rounds of tool use
  for (let round = 0; round < 5; round++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    // No tool calls — extract text and exit loop
    if (toolUseBlocks.length === 0) {
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      output = textBlock?.text ?? "";
      taskSummary = output.split("\n")[0]?.slice(0, 200) ?? "";
      break;
    }

    // Process tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const toolInput = toolUse.input as Record<string, unknown>;
      toolsUsed.push(toolUse.name);
      console.log(`  [${agentName}] tool: ${toolUse.name}`);

      // Handle terminal tools
      if (toolUse.name === "complete_task") {
        taskSummary = String(toolInput["summary"] ?? "");
        output = String(toolInput["output"] ?? "");
        nextSteps = (toolInput["next_steps"] as string[]) ?? [];
        terminated = true;
        // Still add a result so the loop message is valid
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: "Task marked complete.",
        });
        break;
      }

      if (toolUse.name === "request_clarification") {
        needsClarification = String(toolInput["question"] ?? "");
        terminated = true;
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: "Clarification request recorded.",
        });
        break;
      }

      if (toolUse.name === "flag_blocker") {
        blocker = String(toolInput["description"] ?? "");
        terminated = true;
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: "Blocker recorded.",
        });
        break;
      }

      // Execute non-terminal tool
      const result = await executeAgentTool(toolUse.name, toolInput, config);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    if (terminated) {
      break;
    }

    // Append assistant turn + tool results and continue
    messages.push({ role: "assistant" as const, content: response.content });
    messages.push({ role: "user" as const, content: toolResults });
  }

  // If loop ended without output (e.g. 5 rounds used up without complete_task),
  // extract the last text block from messages as a fallback
  if (!output && !terminated) {
    const lastAssistant = [...messages].reverse().find(
      (m) => m.role === "assistant"
    );
    if (lastAssistant && Array.isArray(lastAssistant.content)) {
      const textBlock = (lastAssistant.content as Anthropic.ContentBlock[]).find(
        (b): b is Anthropic.TextBlock => b.type === "text"
      );
      output = textBlock?.text ?? "(no output produced)";
      taskSummary = output.split("\n")[0]?.slice(0, 200) ?? "";
    }
  }

  return {
    agentName,
    taskSummary,
    output,
    nextSteps,
    blocker,
    needsClarification,
    toolsUsed,
    durationMs: Date.now() - startTime,
  };
}

// Re-export AgentName for use elsewhere
export type { AgentName };
