import * as dotenv from "dotenv";
import { z } from "zod";
import * as path from "path";
import * as fs from "fs";

dotenv.config();

const TwilioConfigSchema = z.object({
  accountSid: z.string(),
  authToken: z.string(),
  fromNumber: z.string(),
  toNumber: z.string(),
});

const TelegramConfigSchema = z.object({
  botToken: z.string(),
  chatId: z.string(),
});

const ConfigSchema = z.object({
  dbPath: z.string().default("./data/pm-agent.db"),
  queueDir: z.string().default("./data/agent-queue"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  port: z.number().int().min(1).max(65535).default(3000),
  webhookSecret: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  twilio: TwilioConfigSchema.optional(),
  telegram: TelegramConfigSchema.optional(),
  githubToken: z.string().optional(),
  githubRepo: z.string().default("Rhode025/bearing"),
  githubRepos: z.array(z.string()).default(["Rhode025/bearing", "Rhode025/epic-pass-monitor"]),
});

export type Config = z.infer<typeof ConfigSchema>;
export type TwilioConfig = z.infer<typeof TwilioConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type GithubConfig = Pick<Config, "githubToken" | "githubRepo" | "githubRepos">;

function buildRawConfig(): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    dbPath: process.env["PM_AGENT_DB_PATH"] ?? "./data/pm-agent.db",
    queueDir: process.env["PM_AGENT_QUEUE_DIR"] ?? "./data/agent-queue",
    logLevel: process.env["PM_AGENT_LOG_LEVEL"] ?? "info",
    port: parseInt(process.env["PORT"] ?? process.env["PM_AGENT_PORT"] ?? "3000", 10),
    webhookSecret: process.env["PM_AGENT_WEBHOOK_SECRET"] || undefined,
    anthropicApiKey: process.env["ANTHROPIC_API_KEY"] || undefined,
    githubToken: process.env["GITHUB_TOKEN"] || undefined,
    githubRepo: process.env["GITHUB_REPO"] ?? "Rhode025/bearing",
    githubRepos: process.env["GITHUB_REPOS"]
      ? process.env["GITHUB_REPOS"].split(",").map((r) => r.trim())
      : ["Rhode025/bearing", "Rhode025/epic-pass-monitor"],
  };

  const twilioSid = process.env["TWILIO_ACCOUNT_SID"];
  const twilioToken = process.env["TWILIO_AUTH_TOKEN"];
  const twilioFrom = process.env["TWILIO_FROM_NUMBER"];
  const twilioTo = process.env["TWILIO_TO_NUMBER"];
  if (twilioSid && twilioToken && twilioFrom && twilioTo) {
    raw["twilio"] = {
      accountSid: twilioSid,
      authToken: twilioToken,
      fromNumber: twilioFrom,
      toNumber: twilioTo,
    };
  }

  const telegramToken = process.env["TELEGRAM_BOT_TOKEN"];
  const telegramChat = process.env["TELEGRAM_CHAT_ID"];
  if (telegramToken && telegramChat) {
    raw["telegram"] = {
      botToken: telegramToken,
      chatId: telegramChat,
    };
  }

  return raw;
}

function resolveAndEnsurePaths(cfg: Config): Config {
  const dbPath = path.resolve(cfg.dbPath);
  const queueDir = path.resolve(cfg.queueDir);

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(queueDir, { recursive: true });
  }

  return { ...cfg, dbPath, queueDir };
}

function loadConfig(): Config {
  const raw = buildRawConfig();
  const parsed = ConfigSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`PM Agent config validation failed:\n${issues}`);
  }

  return resolveAndEnsurePaths(parsed.data);
}

export const config: Config = loadConfig();
