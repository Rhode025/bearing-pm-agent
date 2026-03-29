import * as https from "https";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
  };
}

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

// ─── HTTP helper ───────────────────────────────────────────────────────────────

function httpsRequest(
  options: https.RequestOptions,
  body?: string
): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          data: Buffer.concat(chunks).toString("utf8"),
        });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

async function telegramPost<T = unknown>(
  botToken: string,
  method: string,
  payload: Record<string, unknown>
): Promise<TelegramApiResponse<T>> {
  const body = JSON.stringify(payload);
  const options: https.RequestOptions = {
    hostname: "api.telegram.org",
    path: `/bot${botToken}/${method}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const { data } = await httpsRequest(options, body);

  try {
    return JSON.parse(data) as TelegramApiResponse<T>;
  } catch {
    throw new Error(`Telegram API returned non-JSON response: ${data.slice(0, 200)}`);
  }
}

// ─── TelegramAdapter ───────────────────────────────────────────────────────────

export class TelegramAdapter {
  private pollingActive = false;
  private pollingOffset = 0;

  constructor(private botToken: string, private chatId: string) {}

  /**
   * Register a webhook URL with Telegram so Telegram calls your server on new messages.
   */
  async registerWebhook(webhookUrl: string): Promise<void> {
    const response = await telegramPost(this.botToken, "setWebhook", {
      url: webhookUrl,
      allowed_updates: ["message"],
    });

    if (!response.ok) {
      throw new Error(
        `Telegram setWebhook failed (${response.error_code ?? "?"}): ${response.description ?? "unknown error"}`
      );
    }

    console.log(`[telegram] Webhook registered: ${webhookUrl}`);
  }

  /**
   * Send a text message via the Telegram Bot API.
   * If chatId is not provided, the instance chatId is used.
   */
  async sendMessage(text: string, chatId?: string): Promise<void> {
    const targetChat = chatId ?? this.chatId;

    // Telegram messages are capped at 4096 characters
    const safeText = text.length > 4096 ? text.slice(0, 4090) + "…" : text;

    const response = await telegramPost(this.botToken, "sendMessage", {
      chat_id: targetChat,
      text: safeText,
      parse_mode: "Markdown",
    });

    if (!response.ok) {
      // Retry without parse_mode in case of Markdown formatting error
      const retry = await telegramPost(this.botToken, "sendMessage", {
        chat_id: targetChat,
        text: safeText,
      });

      if (!retry.ok) {
        throw new Error(
          `Telegram sendMessage failed (${retry.error_code ?? "?"}): ${retry.description ?? "unknown error"}`
        );
      }
    }
  }

  /**
   * Start long-polling for incoming messages. Suitable for local development
   * where a public HTTPS URL is not available for a webhook.
   *
   * Calls onMessage(text, fromName) and sends the returned string back to
   * the sender's chat.
   */
  async startPolling(
    onMessage: (text: string, from: string, chatId: string) => Promise<string>
  ): Promise<void> {
    this.pollingActive = true;
    console.log("[telegram] Starting long-poll loop (timeout=30s)…");

    while (this.pollingActive) {
      try {
        const response = await telegramPost<TelegramUpdate[]>(
          this.botToken,
          "getUpdates",
          {
            offset: this.pollingOffset,
            timeout: 30,
            allowed_updates: ["message"],
          }
        );

        if (!response.ok || !Array.isArray(response.result)) {
          // Log and back off briefly before retrying
          console.error(
            `[telegram] getUpdates error (${response.error_code ?? "?"}): ${response.description ?? "unknown"}`
          );
          await delay(5000);
          continue;
        }

        for (const update of response.result) {
          // Advance offset so we don't re-process this update
          this.pollingOffset = update.update_id + 1;

          const msg = update.message;
          if (!msg || !msg.text) continue;

          const text = msg.text.trim();
          const from = msg.from?.first_name ?? msg.from?.username ?? "User";
          const chatId = String(msg.chat.id);

          // Process asynchronously so we don't block the poll loop
          onMessage(text, from, chatId)
            .then((reply) => this.sendMessage(reply, chatId))
            .catch((err: unknown) => {
              console.error(
                "[telegram] Error processing message:",
                err instanceof Error ? err.message : String(err)
              );
            });
        }
      } catch (err) {
        if (!this.pollingActive) break;
        console.error(
          "[telegram] Polling error:",
          err instanceof Error ? err.message : String(err)
        );
        // Wait before retrying to avoid hammering the API on persistent errors
        await delay(5000);
      }
    }

    console.log("[telegram] Polling stopped.");
  }

  /**
   * Gracefully stop the polling loop.
   */
  stopPolling(): void {
    this.pollingActive = false;
  }
}

// ─── Utility ───────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
