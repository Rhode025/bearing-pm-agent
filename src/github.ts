import * as https from "https";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface GitHubFile {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface GitHubSearchResult {
  path: string;
  repo: string;
  url: string;
  snippet: string; // first 300 chars of file content
}

// ─── HTTP helper ───────────────────────────────────────────────────────────────

function httpsGet(
  url: string,
  token: string
): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "bearing-pm-agent/1.0",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    };

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
    req.end();
  });
}

// ─── Read a file from GitHub ───────────────────────────────────────────────────

export async function readRepoFile(
  token: string,
  repo: string,
  path: string,
  ref?: string
): Promise<string> {
  try {
    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const url = `https://api.github.com/repos/${repo}/contents/${path}${refParam}`;
    const { statusCode, data } = await httpsGet(url, token);

    if (statusCode === 404 || statusCode === 403) {
      return `[File not found: ${path} (HTTP ${statusCode})]`;
    }
    if (statusCode !== 200) {
      return `[GitHub API error: HTTP ${statusCode} for ${path}]`;
    }

    const parsed = JSON.parse(data) as {
      content?: string;
      encoding?: string;
      type?: string;
    };

    if (parsed.type === "dir") {
      return `[${path} is a directory, not a file]`;
    }

    if (!parsed.content || parsed.encoding !== "base64") {
      return `[Unexpected response format for ${path}]`;
    }

    // Decode base64 content (GitHub adds newlines in the base64)
    const raw = Buffer.from(
      parsed.content.replace(/\n/g, ""),
      "base64"
    ).toString("utf8");

    if (raw.length > 8000) {
      return raw.slice(0, 8000) + "\n[truncated]";
    }
    return raw;
  } catch (err) {
    return `[Error reading ${path}: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

// ─── List files in a directory ─────────────────────────────────────────────────

export async function listRepoDirectory(
  token: string,
  repo: string,
  path: string,
  ref?: string
): Promise<GitHubFile[]> {
  try {
    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const encodedPath = path ? `/${path}` : "";
    const url = `https://api.github.com/repos/${repo}/contents${encodedPath}${refParam}`;
    const { statusCode, data } = await httpsGet(url, token);

    if (statusCode === 404 || statusCode === 403) {
      return [];
    }
    if (statusCode !== 200) {
      return [];
    }

    const parsed = JSON.parse(data) as Array<{
      name: string;
      path: string;
      type: string;
      size?: number;
    }>;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item) => ({
      name: item.name,
      path: item.path,
      type: item.type === "dir" ? "dir" : "file",
      size: item.size,
    }));
  } catch {
    return [];
  }
}

// ─── Search code in a repo ─────────────────────────────────────────────────────

export async function searchRepoCode(
  token: string,
  repo: string,
  query: string
): Promise<GitHubSearchResult[]> {
  try {
    const q = encodeURIComponent(`${query} repo:${repo}`);
    const url = `https://api.github.com/search/code?q=${q}&per_page=10`;
    const { statusCode, data } = await httpsGet(url, token);

    if (statusCode === 403 || statusCode === 422) {
      // Rate limited or invalid query — return empty
      return [];
    }
    if (statusCode !== 200) {
      return [];
    }

    const parsed = JSON.parse(data) as {
      items?: Array<{
        path: string;
        html_url: string;
        repository?: { full_name?: string };
        url?: string;
      }>;
    };

    if (!parsed.items || !Array.isArray(parsed.items)) {
      return [];
    }

    // Fetch snippet for each result (up to 5 to avoid rate limits)
    const results: GitHubSearchResult[] = [];
    for (const item of parsed.items.slice(0, 5)) {
      const repoName = item.repository?.full_name ?? repo;
      let snippet = "";
      try {
        const content = await readRepoFile(token, repoName, item.path);
        snippet = content.slice(0, 300);
      } catch {
        snippet = "";
      }
      results.push({
        path: item.path,
        repo: repoName,
        url: item.html_url,
        snippet,
      });
    }

    return results;
  } catch {
    return [];
  }
}

// ─── Get recent commits ────────────────────────────────────────────────────────

export async function getRecentCommits(
  token: string,
  repo: string,
  limit: number = 10
): Promise<GitHubCommit[]> {
  try {
    const url = `https://api.github.com/repos/${repo}/commits?per_page=${limit}`;
    const { statusCode, data } = await httpsGet(url, token);

    if (statusCode === 404 || statusCode === 403) {
      return [];
    }
    if (statusCode !== 200) {
      return [];
    }

    const parsed = JSON.parse(data) as Array<{
      sha: string;
      html_url: string;
      commit?: {
        message?: string;
        author?: {
          name?: string;
          date?: string;
        };
      };
    }>;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((c) => ({
      sha: c.sha?.slice(0, 7) ?? "",
      message: (c.commit?.message ?? "").split("\n")[0] ?? "",
      author: c.commit?.author?.name ?? "unknown",
      date: c.commit?.author?.date ?? "",
      url: c.html_url ?? "",
    }));
  } catch {
    return [];
  }
}

// ─── Get repo top-level structure ─────────────────────────────────────────────

export async function getRepoStructure(
  token: string,
  repo: string
): Promise<GitHubFile[]> {
  return listRepoDirectory(token, repo, "");
}
