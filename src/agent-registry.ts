import { v4 as uuidv4 } from "uuid";
import type { Storage } from "./storage.js";
import type { AgentDefinition } from "./types.js";
import { AGENT_SYSTEM_PROMPTS } from "./agent-runner.js";

export type { AgentDefinition };

// ─── Built-in agent metadata ──────────────────────────────────────────────────

const BUILT_IN_METADATA: Record<
  string,
  { displayName: string; description: string; capabilities: string[] }
> = {
  "engineering-agent": {
    displayName: "Engineering Agent",
    description:
      "Analyzes tasks, reads BEARING codebase, and produces concrete implementation plans.",
    capabilities: [
      "read_file",
      "list_directory",
      "search_code",
      "get_recent_commits",
      "analyze_code",
    ],
  },
  "ui-agent": {
    displayName: "UI Agent",
    description:
      "Reviews React components and produces Tailwind/JSX implementation plans.",
    capabilities: [
      "read_file",
      "list_directory",
      "search_code",
      "get_recent_commits",
      "analyze_code",
    ],
  },
  "design-agent": {
    displayName: "Design Agent",
    description:
      "Reviews UX, layout, and brand consistency against BEARING standards.",
    capabilities: [],
  },
  "qa-agent": {
    displayName: "QA Agent",
    description:
      "Writes test plans, identifies edge cases, and reviews code for bugs.",
    capabilities: ["read_file", "search_code", "analyze_code", "create_test_plan"],
  },
  "editorial-agent": {
    displayName: "Editorial Agent",
    description:
      "Drafts articles, newsletters, and landing page copy in BEARING voice.",
    capabilities: ["draft_content", "suggest_outline"],
  },
  "seo-agent": {
    displayName: "SEO Agent",
    description:
      "Researches keywords, writes meta tags, and suggests structured data for BEARING pages.",
    capabilities: [],
  },
  "research-agent": {
    displayName: "Research Agent",
    description:
      "Analyzes competitive landscape and user behavior, delivers actionable recommendations.",
    capabilities: [],
  },
  "growth-agent": {
    displayName: "Growth Agent",
    description:
      "Optimizes conversion, member activation, and referral mechanics for BEARING tiers.",
    capabilities: [],
  },
};

// ─── Exports ──────────────────────────────────────────────────────────────────

export function getAgentDefinition(
  storage: Storage,
  name: string
): AgentDefinition | null {
  // Check built-ins first
  if (AGENT_SYSTEM_PROMPTS[name]) {
    const meta = BUILT_IN_METADATA[name];
    if (meta) {
      return {
        id: name,
        name,
        displayName: meta.displayName,
        description: meta.description,
        systemPrompt: AGENT_SYSTEM_PROMPTS[name] ?? "",
        capabilities: meta.capabilities,
        isBuiltIn: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
    }
  }

  // Check storage for custom agents
  return storage.getAgentDefinition(name);
}

export function createAgentDefinition(
  storage: Storage,
  def: Omit<AgentDefinition, "id" | "createdAt" | "isBuiltIn">
): AgentDefinition {
  const full: AgentDefinition = {
    id: uuidv4(),
    name: def.name,
    displayName: def.displayName,
    description: def.description,
    systemPrompt: def.systemPrompt,
    capabilities: def.capabilities,
    isBuiltIn: false,
    createdAt: new Date().toISOString(),
  };
  storage.saveAgentDefinition(full);
  return full;
}

export function listAgentDefinitions(storage: Storage): AgentDefinition[] {
  const builtIns: AgentDefinition[] = Object.keys(AGENT_SYSTEM_PROMPTS).map(
    (name) => {
      const meta = BUILT_IN_METADATA[name];
      return {
        id: name,
        name,
        displayName: meta?.displayName ?? name,
        description: meta?.description ?? "",
        systemPrompt: AGENT_SYSTEM_PROMPTS[name] ?? "",
        capabilities: meta?.capabilities ?? [],
        isBuiltIn: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
    }
  );

  const custom = storage.listAgentDefinitions();
  return [...builtIns, ...custom];
}

export function deleteAgentDefinition(storage: Storage, name: string): void {
  // Cannot delete built-ins
  if (AGENT_SYSTEM_PROMPTS[name]) {
    throw new Error(`Cannot delete built-in agent: ${name}`);
  }
  storage.deleteAgentDefinition(name);
}
