// Keeps Herdr workspace labels aligned with OMP session titles.
// The official Herdr integration owns lifecycle state; this extension owns labels only.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workspaceId = process.env.HERDR_WORKSPACE_ID;
const enabled = process.env.HERDR_ENV === "1" && !!workspaceId;
const reviewPattern = /\breview(?:ing)?\b/i;

interface PiApi {
  getSessionName(): string | undefined;
  setSessionName(name: string): Promise<void>;
  on(event: "session_start", handler: () => void): void;
  on(event: "agent_end", handler: (event: AgentEndEvent) => void): void;
}

interface AgentEndEvent {
  messages?: unknown[];
}

function userText(messages: unknown[]): string {
  const parts: string[] = [];

  for (const message of messages) {
    if (
      typeof message !== "object" ||
      message === null ||
      !("role" in message) ||
      message.role !== "user" ||
      !("content" in message)
    ) {
      continue;
    }

    const content = Array.isArray(message.content) ? message.content : [message.content];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
      } else if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        parts.push(part.text);
      }
    }
  }

  return parts.join("\n");
}

function fallbackTitle(text: string): string | undefined {
  const cleaned = text
    .replace(/\[Image #[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return;
  if (cleaned.length <= 60) return cleaned;

  return `${cleaned.slice(0, 59).trimEnd()}…`;
}

function reviewTarget(text: string): string | undefined {
  const githubUrl = text.match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/i)?.[0];
  if (githubUrl) return githubUrl;

  const graphiteUrl = text.match(
    /https:\/\/app\.graphite\.com\/github\/pr\/([^/\s]+)\/([^/?\s]+)\/(\d+)/i,
  );
  if (graphiteUrl) {
    const [, owner, repo, number] = graphiteUrl;
    return `https://github.com/${owner}/${repo}/pull/${number}`;
  }

  return text.match(/\b(?:PR|pull request)\s*#?(\d+)\b/i)?.[1];
}

async function resolveReviewTitle(messages: unknown[]): Promise<string | undefined> {
  const text = userText(messages);
  if (!reviewPattern.test(text)) return;

  const target = reviewTarget(text);
  const args = ["pr", "view", ...(target ? [target] : []), "--json", "title", "--jq", ".title"];

  try {
    const { stdout } = await execFileAsync("gh", args, {
      cwd: process.cwd(),
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
    return stdout.trim() || undefined;
  } catch {
    return;
  }
}

export default function (pi: PiApi) {
  if (!enabled || !workspaceId) return;

  let lastLabel: string | undefined;

  async function syncTitle(messages: unknown[] = []) {
    const text = userText(messages);
    const reviewTitle = await resolveReviewTitle(messages);
    const sessionTitle = pi.getSessionName()?.trim();
    const label = reviewTitle ? `Review: ${reviewTitle}` : sessionTitle || fallbackTitle(text);
    if (!label) return;

    if (label !== sessionTitle) {
      try {
        await pi.setSessionName(label);
      } catch {
        // A sidebar label is still useful if OMP cannot persist its session title.
      }
    }

    if (label === lastLabel) return;

    try {
      await execFileAsync("herdr", ["workspace", "rename", workspaceId, label], {
        timeout: 5000,
        maxBuffer: 64 * 1024,
      });
      lastLabel = label;
    } catch {
      // Herdr may be shutting down; title sync must not affect the agent turn.
    }
  }

  pi.on("session_start", () => syncTitle());
  pi.on("agent_end", (event) => syncTitle(event.messages ?? []));
}
