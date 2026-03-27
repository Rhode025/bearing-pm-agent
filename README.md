# BEARING PM Agent

A production-ready TypeScript/Node.js project that acts as an AI Project Manager — orchestrating a Kanban board, editorial calendar, sprint planning, initiative tracking, and sub-agent routing through a natural-language message pipeline.

---

## What the PM Agent does

The PM Agent accepts natural-language messages (from CLI, SMS, Telegram, webhooks, or API) and:

1. **Parses intent** — classifies the message into one or more intents (create ticket, schedule content, block a ticket, log a decision, etc.)
2. **Extracts entities** — titles, agent names, dates, priorities, statuses, content types, and blockers
3. **Executes** — creates tickets, calendar items, initiatives, sprint assignments, or decisions in SQLite
4. **Routes** — automatically assigns work to the right sub-agent based on ticket type, tags, and content type
5. **Hands off** — emits structured handoff files to each agent's queue directory

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Incoming Message                     │
│         (CLI / SMS / Telegram / Webhook / API)          │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   message-ingest.ts  │
              │  normalise → parse   │
              │  resolve → execute   │
              └──────────┬───────────┘
                         │
           ┌─────────────┼──────────────┐
           ▼             ▼              ▼
    ┌──────────┐  ┌────────────┐  ┌──────────────┐
    │ kanban   │  │ editorial  │  │  sprints /   │
    │  .ts     │  │-calendar   │  │ initiatives  │
    └──────────┘  └────────────┘  └──────────────┘
           │             │              │
           └─────────────┼──────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │     storage.ts       │
              │   (better-sqlite3)   │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │     router.ts        │
              │  tag + type rules    │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  agent-handoff.ts    │
              │  file / stdout /     │
              │  webhook emit        │
              └──────────┬───────────┘
                         │
              ┌──────────┴────────────────────────────┐
              ▼          ▼           ▼        ▼        ▼
        engineering   ui-agent  design-   qa-agent  editorial
          -agent                 agent              -agent
```

---

## Install and run

```bash
git clone <repo>
cd bearing-pm-agent
npm install

# Copy env template (all fields optional for local use)
cp .env.example .env

# Run the full demo (seeds data + runs 8 sample messages)
npm run demo

# Or run individual commands
npm run board          # Kanban board
npm run sprint         # Sprint overview
npm run editorial      # Editorial calendar
npm run decisions      # Decision log
npm run route          # Agent queue report
npm run summary        # Daily summary

# Ingest a natural-language message
npm run ingest -- "Build a better search results page next sprint"
npm run ingest -- "Article idea: why budget alerts fail frequent flyers"
npm run ingest -- "Move the dashboard to blocked, Stripe webhook is broken"
```

---

## How message ingestion works

Every message flows through a 5-step pipeline in `src/message-ingest.ts`:

```
raw text
   │
   ▼  normalizeText()          — strip smart quotes, collapse whitespace
   │
   ▼  parseMessage()           — rule-based intent classification + entity extraction
   │
   ▼  resolveEntityReferences()— "that one" / "move it" resolved via recent-context DB
   │
   ▼  executeIntents()         — dispatches to kanban / editorial / sprints / decisions
   │
   ▼  handoff emit             — writes JSON to data/agent-queue/<agent>-<id>.json
```

### Intent examples

| Message fragment | Intent(s) |
|---|---|
| "build X" / "create X" / "add X" | `create_ticket` |
| "article about X" / "blog post on X" | `create_calendar_item` |
| "put X on the calendar for May 14" | `schedule_calendar_item` |
| "move X to blocked" | `move_ticket` + `mark_blocked` |
| "mark done" | `mark_done` |
| "have design review X" | `assign` + `route_to_agent` |
| "we're focusing April on X" | `log_decision` + `create_initiative` |
| "what's in flight" | `request_status` |
| "write release notes for X and blog post" | `create_calendar_item` (×2 content types) |

---

## How the Kanban board works

The board (`src/kanban.ts`) manages tickets across 7 statuses:

```
inbox → ready → in_progress → in_review → done
                     │
                  blocked
                  (icebox)
```

Tickets are auto-routed on creation based on tags and title keywords:

- Tags `ui`, `frontend`, `component` → **ui-agent**
- Tags `backend`, `api`, `engineering` → **engineering-agent**
- Tags `bug`, `defect`, `fix` → **qa-agent**
- Tags `design`, `ux`, `figma` → **design-agent**
- Tags `seo`, `keyword` → **seo-agent**
- Tags `research`, `survey` → **research-agent**
- Tags `growth`, `campaign` → **growth-agent**

---

## How the editorial calendar works

Calendar items (`src/editorial-calendar.ts`) track content through:

```
idea → draft → in_review → scheduled → published → archived
```

Content types: `article`, `blog_post`, `newsletter`, `landing_page`, `social_campaign`, `release_notes`, `content_refresh`, `case_study`, `announcement`

Items can be:
- Grouped by **month** for the calendar view
- Filtered by **theme** for thematic clustering
- Linked to **initiatives** and **sprints**
- Scheduled with a `publishDate` and `dueDate` (draft deadline)

---

## How sub-agent routing works

`src/router.ts` applies a priority-ordered rule chain:

1. **Override** — explicit agent assignment in the message ("have engineering do X")
2. **Tag rules** — ticket tags matched against agent capability definitions
3. **Content type rules** — calendar items routed by content type
4. **Title keywords** — "page", "component" → ui-agent; "API", "backend" → engineering-agent
5. **Default** — engineering-agent for unclassified tickets, editorial-agent for content

Handoffs are written to `data/agent-queue/` as JSON files:

```json
{
  "id": "...",
  "targetAgent": "engineering-agent",
  "sourceAgent": "pm-agent",
  "ticketId": "...",
  "priority": "high",
  "instruction": "Begin implementation of: Travel Windows detail page",
  "context": "Ticket ID: ...\nSprint: Sprint Apr 6 – Apr 19, 2026\n...",
  "status": "delivered"
}
```

---

## How to adapt for SMS/Twilio/Telegram

### Twilio SMS

1. Add credentials to `.env`:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxxx
   TWILIO_FROM_NUMBER=+15550001234
   TWILIO_TO_NUMBER=+15559876543
   ```

2. Set up an inbound webhook in Twilio pointing to your server's `/webhook/twilio` endpoint.

3. In your webhook handler, call:
   ```typescript
   import { ingestMessage } from "./src/message-ingest.js";
   const result = await ingestMessage(req.body.Body, "twilio", storage, config);
   ```

4. To send a reply, use the Twilio REST API with `result.messages.join("\n")` as the body.

### Telegram

1. Add credentials to `.env`:
   ```
   TELEGRAM_BOT_TOKEN=xxxxxxxx:xxxxxxxxxxxxxxx
   TELEGRAM_CHAT_ID=123456789
   ```

2. Set up a Telegram webhook via the Bot API:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://yourserver.com/webhook/telegram"
   ```

3. In your webhook handler:
   ```typescript
   const text = req.body.message?.text ?? "";
   const result = await ingestMessage(text, "telegram", storage, config);
   ```

### Express webhook server (minimal example)

```typescript
import express from "express";
import { Storage } from "./src/storage.js";
import { config } from "./src/config.js";
import { ingestMessage, formatIngestResult } from "./src/message-ingest.js";

const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
  const message = req.body.message ?? req.body.Body ?? "";
  const storage = new Storage(config.dbPath);
  const result = await ingestMessage(message, "webhook", storage, config);
  storage.close();
  res.json({ ok: true, summary: result.messages });
});

app.listen(config.port);
```

---

## Example CLI sessions

### 1. Create a ticket and assign to next sprint
```
$ npm run ingest -- "Build a better Travel Windows detail page next sprint"

  ┌─ Ingesting message ──────────────────────────────────
  │  "Build a better Travel Windows detail page next sprint"
  └─────────────────────────────────────────────────────

  [HANDOFF → ui-agent] Pick up and begin work on: better Travel Windows detail page

  ── Ingest Result ──
  ✓ Created ticket: "better Travel Windows detail page" → ui-agent (added to sprint)
  Summary: 1 ticket(s) created, 1 handoff(s) queued
```

### 2. Create an editorial idea
```
$ npm run ingest -- "Article idea: how to know when a fare drop is actually actionable"

  [HANDOFF → editorial-agent] Write a brief and begin draft for: "how to know..."

  ── Ingest Result ──
  ✓ Created article: "how to know when a fare drop is actually actionable" → idea backlog
```

### 3. Schedule an article
```
$ npm run ingest -- "Put the fare drop article on the calendar for May 14"

  ── Ingest Result ──
  ✓ Scheduled "how to know when a fare drop is actually actionable" for 2026-05-14
```

### 4. Block a ticket with a reason
```
$ npm run ingest -- "Move dashboard review to blocked, Duffel API is unstable"

  ── Ingest Result ──
  ✓ Moved "the dashboard" to blocked
  ✓ Added blocker: "Duffel API"
```

### 5. Log an initiative decision
```
$ npm run ingest -- "We are focusing April on Travel Windows and member onboarding"

  ── Ingest Result ──
  ✓ Created initiative: "Travel Windows"
  ✓ Logged decision: "Focus area: Travel Windows, member onboarding"
```

### 6. View the board
```
$ npm run board

  ╔══════════════════════════════════════════╗
  ║        BEARING KANBAN BOARD               ║
  ╚══════════════════════════════════════════╝

  ── INBOX (2) ──
  ...

  ── BLOCKED (1) ──
  ...
```

---

## Limitations and extension points

### Current limitations

- **Rule-based parser only** — the parser in `src/parser.ts` uses regex rules. Complex or ambiguous messages may misfire. The architecture is explicitly designed so `classifyIntents()` can be replaced with an LLM call (Claude, GPT-4o) by swapping that function.

- **No HTTP server included** — webhook integration requires you to wire up Express/Fastify/etc. The ingest pipeline is pure function and easily embeddable.

- **No authentication** — the CLI and webhook handlers have no auth layer. Add middleware before exposing to the internet.

- **SQLite is single-writer** — fine for a single PM Agent process, but not for multi-node deployments. Swap `Storage` for a Postgres-backed implementation if needed.

### Extension points

| What | How |
|---|---|
| Upgrade parser to LLM | Replace `classifyIntents()` in `src/parser.ts` with an Anthropic/OpenAI call that returns `ParsedIntent[]` |
| Add HTTP server | Create `src/server.ts` that mounts `/webhook` and calls `ingestMessage()` |
| Slack integration | Add a Slack Bolt handler that calls `ingestMessage()` with `channel: "api"` |
| Persistent agent handoffs | Replace `emitHandoff("file")` with a Redis queue or NATS publish |
| Notifications | In `agent-handoff.ts`, add Twilio SMS or Telegram send in the `"file"` case after writing the JSON |
| Multi-workspace | Namespace the SQLite DB path by workspace ID |
| LLM-based fuzzy ticket matching | In `resolveEntityReferences()`, embed ticket titles and use cosine similarity |

---

## File structure

```
bearing-pm-agent/
├── src/
│   ├── index.ts              — CLI entry point
│   ├── config.ts             — Zod-validated env config
│   ├── types.ts              — All TypeScript interfaces and enums
│   ├── storage.ts            — SQLite storage layer (better-sqlite3)
│   ├── parser.ts             — Rule-based intent + entity parser
│   ├── router.ts             — Agent routing rules
│   ├── kanban.ts             — Kanban board management
│   ├── sprints.ts            — Sprint planning
│   ├── editorial-calendar.ts — Editorial calendar management
│   ├── initiatives.ts        — Initiative/project tracking
│   ├── decision-log.ts       — Decision logging
│   ├── agent-directory.ts    — Agent registry and capabilities
│   ├── agent-handoff.ts      — Sub-agent handoff system
│   ├── message-ingest.ts     — Full ingest pipeline
│   ├── commands.ts           — CLI command handlers
│   └── reports.ts            — Report generators
├── data/
│   ├── pm-agent.db           — SQLite database (auto-created)
│   └── agent-queue/          — Agent handoff JSON files
├── package.json
├── tsconfig.json
└── .env.example
```
