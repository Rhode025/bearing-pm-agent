import * as https from "https";
import * as crypto from "crypto";

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

// ─── Form encoding ─────────────────────────────────────────────────────────────

function encodeFormBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
    )
    .join("&");
}

function decodeFormBody(body: string): Record<string, string> {
  if (!body) return {};
  const result: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = decodeURIComponent(pair.slice(0, eqIdx).replace(/\+/g, " "));
    const val = decodeURIComponent(pair.slice(eqIdx + 1).replace(/\+/g, " "));
    result[key] = val;
  }
  return result;
}

// ─── TwilioAdapter ─────────────────────────────────────────────────────────────

export class TwilioAdapter {
  constructor(
    private accountSid: string,
    private authToken: string,
    private fromNumber: string
  ) {}

  /**
   * Send an outbound SMS via the Twilio Messages API.
   */
  async sendSms(to: string, body: string): Promise<void> {
    const safeBody = TwilioAdapter.truncateForSms(body);

    const formBody = encodeFormBody({
      To: to,
      From: this.fromNumber,
      Body: safeBody,
    });

    const authHeader = Buffer.from(
      `${this.accountSid}:${this.authToken}`
    ).toString("base64");

    const options: https.RequestOptions = {
      hostname: "api.twilio.com",
      path: `/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(formBody),
        Authorization: `Basic ${authHeader}`,
      },
    };

    const { statusCode, data } = await httpsRequest(options, formBody);

    if (statusCode < 200 || statusCode >= 300) {
      let detail = data;
      try {
        const parsed = JSON.parse(data) as { message?: string; code?: number };
        detail = parsed.message ?? data;
      } catch {
        // leave detail as raw body
      }
      throw new Error(
        `Twilio sendSms failed (HTTP ${statusCode}): ${detail.slice(0, 300)}`
      );
    }
  }

  /**
   * Parse an inbound Twilio webhook form-encoded body.
   * Returns { text, from } or null if the required fields are missing.
   */
  static parseInboundWebhook(
    body: string
  ): { text: string; from: string } | null {
    const params = decodeFormBody(body);
    const text = params["Body"];
    const from = params["From"];

    if (!text || !from) return null;
    return { text, from };
  }

  /**
   * Validate a Twilio request signature.
   *
   * Twilio signs each request by:
   *   1. Taking the full URL of the request
   *   2. Sorting POST parameters alphabetically and appending key+value pairs
   *   3. HMAC-SHA1 with your Auth Token as the key
   *   4. Base64-encoding the result
   *
   * @param authToken  Your Twilio Auth Token
   * @param url        The full URL that Twilio sent the request to
   * @param params     The POST parameters (key/value pairs from the form body)
   * @param signature  The value of the X-Twilio-Signature header
   */
  static validateSignature(
    authToken: string,
    url: string,
    params: Record<string, string>,
    signature: string
  ): boolean {
    // Build the validation string: url + sorted key-value pairs
    const sortedKeys = Object.keys(params).sort();
    const paramString = sortedKeys
      .map((k) => `${k}${params[k] ?? ""}`)
      .join("");
    const validationString = url + paramString;

    const expected = crypto
      .createHmac("sha1", authToken)
      .update(validationString)
      .digest("base64");

    // Use timingSafeEqual to prevent timing attacks
    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(signature);

    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  }

  /**
   * Truncate a string to fit within SMS limits.
   * Default maxLen is 1600 (the Twilio concatenated SMS limit).
   * Set maxLen to 160 for a single SMS segment.
   */
  static truncateForSms(text: string, maxLen = 1600): string {
    if (text.length <= maxLen) return text;
    // Reserve 1 char for ellipsis
    return text.slice(0, maxLen - 1) + "…";
  }
}
