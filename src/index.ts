import { config } from "./config.js";
import { Storage } from "./storage.js";
import {
  commandBoard,
  commandSprint,
  commandEditorial,
  commandSummary,
  commandDecisions,
  commandRoute,
  commandIngest,
  commandDemo,
} from "./commands.js";
import { commandServe } from "./commands/serve.js";
import chalk from "chalk";

// ─── Main entry point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";

  const storage = new Storage(config.dbPath);

  try {
    switch (command) {
      case "board":
        await commandBoard(storage);
        break;

      case "sprint":
        await commandSprint(storage);
        break;

      case "editorial":
        await commandEditorial(storage);
        break;

      case "summary":
        await commandSummary(storage);
        break;

      case "decisions":
        await commandDecisions(storage);
        break;

      case "route":
        await commandRoute(storage);
        break;

      case "ingest": {
        // Support both:
        //   npm run ingest -- "message"        → args[1]
        //   tsx src/index.ts ingest "message"  → args[1]
        const message = args.slice(1).join(" ");
        await commandIngest(message, storage, config);
        break;
      }

      case "demo":
        await commandDemo(storage, config);
        break;

      case "serve":
        await commandServe(storage, config, args.slice(1));
        break;

      case "help":
      default:
        printHelp();
        break;
    }
  } catch (err) {
    console.error(
      chalk.red("\n  Error:"),
      err instanceof Error ? err.message : String(err)
    );
    if (config.logLevel === "debug" && err instanceof Error && err.stack) {
      console.error(chalk.dim(err.stack));
    }
    process.exit(1);
  } finally {
    storage.close();
  }
}

function printHelp(): void {
  console.log(chalk.bold.white("\n  BEARING PM Agent\n"));
  console.log(chalk.dim("  Usage: npm run <command> [args]\n"));
  console.log("  Commands:");
  console.log(`    ${chalk.cyan("board")}       Show the full Kanban board`);
  console.log(`    ${chalk.cyan("sprint")}      Show sprint status and backlog`);
  console.log(`    ${chalk.cyan("editorial")}   Show editorial calendar`);
  console.log(`    ${chalk.cyan("summary")}     Show daily summary`);
  console.log(`    ${chalk.cyan("decisions")}   Show decision log`);
  console.log(`    ${chalk.cyan("route")}       Show agent queue report`);
  console.log(
    `    ${chalk.cyan("ingest")}     Process a natural-language message`
  );
  console.log(`    ${chalk.cyan("demo")}        Run the full demo with sample data`);
  console.log(`    ${chalk.cyan("serve")}       Start HTTP server (Twilio/Telegram/API webhooks)`);
  console.log(`      ${chalk.dim("--polling")}   Use Telegram polling instead of webhook`);
  console.log(`      ${chalk.dim("--webhook")}   Register Telegram webhook on startup`);
  console.log(
    `\n  ${chalk.dim("Example:")} npm run ingest -- "Build a better search page next sprint"`
  );
  console.log("");
}

main().catch(err => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
