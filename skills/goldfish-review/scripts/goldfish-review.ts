#!/usr/bin/env -S npx --yes tsx
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Severity = "Important" | "Nit" | "Pre-existing";
export type ToolName = "claude" | "cursor-agent" | "omp";
export type LensName = "correctness" | "security-data" | "edge-errors";

export interface Lane {
  readonly id: string;
  readonly tool: ToolName;
  readonly lens: LensName;
}

export interface LaneFinding {
  readonly severity: Severity;
  readonly file: string;
  readonly line: number;
  readonly endLine?: number;
  readonly category: string;
  readonly bugClass?: string;
  readonly summary: string;
  readonly evidence: string;
}

export interface MergedFinding extends LaneFinding {
  readonly lanes: readonly string[];
  readonly votes: number;
  readonly locations: readonly string[];
}

export interface FilteredDiff {
  readonly text: string;
  readonly files: readonly string[];
  readonly changedLines: number;
  readonly skippedFiles: readonly string[];
}

export const TOOLS: readonly ToolName[] = ["claude", "cursor-agent", "omp"];
export const LENSES: readonly LensName[] = ["correctness", "security-data", "edge-errors"];

const LENS_TEXT: Record<LensName, string> = {
  correctness:
    "logic errors, null/undefined, off-by-one, async ordering and races, wrong types or contracts, broken callers; when you find one bug, sweep the whole diff for the same bug class",
  "security-data":
    "authn/authz gaps, injection, secrets or PII exposure, unsafe migrations, data loss, missing transactions or idempotency",
  "edge-errors":
    "empty/boundary inputs, failure and retry paths, timeouts, partial failure, swallowed errors, missing loading/empty/error UI states",
};

export const DEFAULT_EXCLUDES = [
  "*.lock",
  "*-lock.json",
  "*-lock.yaml",
  "*.min.js",
  "*.map",
  "*.snap",
  "*.generated.*",
  "**/__generated__/**",
  "dist/**",
  "build/**",
];

const RISKY_PATH = /(auth|session|permission|migration|schema|payment|billing|secret|crypto)/i;

/** Lines changed decide how many lanes run; risky paths add one, capped at 3. */
export function chooseLaneCount(changedLines: number, files: readonly string[]): number {
  const base = changedLines < 50 ? 1 : changedLines < 400 ? 2 : 3;
  const risky = files.some(file => RISKY_PATH.test(file));
  return Math.min(3, base + (risky ? 1 : 0));
}

/**
 * Every lane runs the same baseline checklist, so lenses overlap on purpose:
 * the merge keeps findings two lanes agree on, which disjoint lenses could never produce.
 * `double` runs each lens on two different tools when more than one is installed.
 */
export function planLanes(tools: readonly ToolName[], count: number, double = false): Lane[] {
  if (tools.length === 0) throw new Error("No review CLI found (need one of: claude, cursor-agent, omp)");
  if (double) {
    return LENSES.flatMap((lens, index) =>
      [0, 1].map(copy => {
        const tool = tools[(index + copy) % tools.length];
        return { id: `${tool}-${lens}-${copy + 1}`, tool, lens };
      }),
    );
  }
  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    const tool = tools[index % tools.length];
    const lens = LENSES[index % LENSES.length];
    return { id: `${tool}-${lens}`, tool, lens };
  });
}

function matchesGlob(file: string, glob: string): boolean {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`(^|/)${pattern}$`).test(file);
}

/** Drops generated/lock files and stops adding files once `maxLines` changed lines are reached. */
export function filterDiff(diff: string, excludes: readonly string[] = DEFAULT_EXCLUDES, maxLines = 3000): FilteredDiff {
  const chunks = diff.split(/^(?=diff --git )/m).filter(chunk => chunk.startsWith("diff --git "));
  const kept: string[] = [];
  const files: string[] = [];
  const skippedFiles: string[] = [];
  let changedLines = 0;

  for (const chunk of chunks) {
    const file = /^diff --git a\/.+? b\/(.+)$/m.exec(chunk)?.[1] ?? "";
    if (excludes.some(glob => matchesGlob(file, glob))) continue;
    const lines = chunk.split("\n").filter(line => /^[+-](?![+-]{2} )/.test(line)).length;
    if (changedLines > 0 && changedLines + lines > maxLines) {
      skippedFiles.push(file);
      continue;
    }
    kept.push(chunk);
    files.push(file);
    changedLines += lines;
  }
  return { text: kept.join(""), files, changedLines, skippedFiles };
}

export function buildPrompt(lane: Lane, diff: string, reviewMd: string | null): string {
  return [
    "You are one blind reviewer. You see only this diff; no repo, no author notes, no other reviewers.",
    "Baseline (always check): correctness, security, data safety, error handling, edge cases.",
    `Emphasis for this lane: ${LENS_TEXT[lane.lens]}.`,
    "Rules: every finding needs a changed file path and line from the diff plus quoted code as evidence.",
    "Tag severity Important (bug, security, data loss, broken contract), Nit (only if a linter would flag it), or Pre-existing (bug not introduced by this diff).",
    "Skip pure style. If you find a bug, report the same bug class everywhere in the diff with a shared bugClass.",
    reviewMd ? `Team review rules (REVIEW.md):\n${reviewMd}` : "",
    'Reply with JSON only, no prose or fences: {"findings":[{"severity":"Important","file":"path","line":1,"endLine":1,"category":"correctness","bugClass":"optional-short-id","summary":"one line","evidence":"quoted code"}]}',
    "If there is nothing worth reporting, reply {\"findings\":[]}.",
    "--- DIFF ---",
    diff,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Returns the first balanced `{...}` object that parses, ignoring braces inside strings. */
function firstJsonObject(text: string): unknown {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (inString) {
        if (char === "\\") index++;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error("no JSON object in lane output");
}

/**
 * Pulls the findings object out of tool stdout, tolerating fences, claude's JSON envelope,
 * and trailing prose such as omp advisor notes printed after the answer.
 */
export function extractFindings(stdout: string): LaneFinding[] {
  const parseObject = (text: string): unknown => {
    const anchor = text.search(/\{\s*"(findings|result)"/);
    return firstJsonObject(anchor >= 0 ? text.slice(anchor) : text);
  };
  let parsed = parseObject(stdout) as { findings?: unknown; result?: unknown };
  if (!Array.isArray(parsed.findings) && typeof parsed.result === "string") {
    parsed = parseObject(parsed.result) as { findings?: unknown };
  }
  if (!Array.isArray(parsed.findings)) throw new Error("lane output has no findings array");
  return parsed.findings.flatMap(raw => {
    const item = raw as Partial<LaneFinding>;
    if (typeof item.file !== "string" || typeof item.line !== "number" || typeof item.summary !== "string") return [];
    const severity: Severity = item.severity === "Nit" || item.severity === "Pre-existing" ? item.severity : "Important";
    return [
      {
        severity,
        file: item.file.replace(/^[ab]\//, ""),
        line: item.line,
        endLine: typeof item.endLine === "number" ? item.endLine : undefined,
        category: typeof item.category === "string" ? item.category : "correctness",
        bugClass: typeof item.bugClass === "string" && item.bugClass ? item.bugClass : undefined,
        summary: item.summary,
        evidence: typeof item.evidence === "string" ? item.evidence : "",
      },
    ];
  });
}

const SEVERITY_RANK: Record<Severity, number> = { Important: 3, "Pre-existing": 2, Nit: 1 };
const NEAR_LINES = 3;

/**
 * Clusters findings by bug class or nearby file:line, counts distinct lanes as votes,
 * and keeps a cluster only if 2+ lanes agree or it is Important with quoted evidence.
 * Findings on files outside the diff are dropped as unverifiable.
 */
export function mergeFindings(
  laneResults: ReadonlyArray<{ readonly lane: string; readonly findings: readonly LaneFinding[] }>,
  diffFiles: readonly string[],
): { kept: MergedFinding[]; dropped: MergedFinding[] } {
  const totalLanes = laneResults.length;
  const clusters: Array<{ findings: LaneFinding[]; lanes: Set<string> }> = [];

  for (const { lane, findings } of laneResults) {
    for (const finding of findings) {
      if (!diffFiles.includes(finding.file) || finding.category === "style") continue;
      // Proximity only matches across lanes; one lane's separate findings stay separate unless they share a bug class.
      const cluster = clusters.find(candidate =>
        candidate.findings.some(
          other =>
            (finding.bugClass !== undefined && finding.bugClass === other.bugClass) ||
            (!candidate.lanes.has(lane) && other.file === finding.file && Math.abs(other.line - finding.line) <= NEAR_LINES),
        ),
      );
      if (cluster) {
        cluster.findings.push(finding);
        cluster.lanes.add(lane);
      } else {
        clusters.push({ findings: [finding], lanes: new Set([lane]) });
      }
    }
  }

  const merged = clusters.map(({ findings, lanes }): MergedFinding => {
    const primary = [...findings].sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.evidence.length - a.evidence.length,
    )[0];
    const locations = [...new Set(findings.map(f => `${f.file}:${f.line}`))];
    return { ...primary, lanes: [...lanes], votes: lanes.size, locations };
  });

  const keep = (finding: MergedFinding): boolean =>
    totalLanes === 1
      ? finding.evidence.trim().length > 0
      : finding.votes >= 2 || (finding.severity === "Important" && finding.evidence.trim().length > 0);

  return { kept: merged.filter(keep), dropped: merged.filter(finding => !keep(finding)) };
}

export function formatSummary(kept: readonly MergedFinding[], lanes: readonly Lane[], diff: FilteredDiff, sha: string): string {
  const count = (severity: Severity) => kept.filter(finding => finding.severity === severity).length;
  const lines = [
    `Important: ${count("Important")} | Nit: ${count("Nit")} | Pre-existing: ${count("Pre-existing")}`,
    `Goldfish lanes: ${lanes.map(lane => lane.id).join(", ")} | reviewed ${sha.slice(0, 12)} | ${diff.changedLines} changed lines`,
  ];
  if (diff.skippedFiles.length > 0) lines.push(`Not reviewed (diff cap): ${diff.skippedFiles.join(", ")}`);
  lines.push("");
  for (const finding of kept) {
    lines.push(`- [${finding.severity}] ${finding.locations.join(", ")} — ${finding.summary} (votes ${finding.votes}: ${finding.lanes.join(", ")})`);
    if (finding.evidence) lines.push(`  evidence: ${finding.evidence.replace(/\s+/g, " ").slice(0, 240)}`);
  }
  return lines.join("\n");
}

/** omp lanes run with the advisor (`omp -p --advisor`) unless GOLDFISH_OMP_ADVISOR=0. */
export function ompArgs(prompt: string, advisorSetting: string | undefined): string[] {
  const advisor = advisorSetting !== "0" && advisorSetting !== "false";
  return advisor ? ["-p", "--advisor", prompt] : ["-p", prompt];
}

function commandFor(tool: ToolName, prompt: string): { cmd: string; args: string[] } {
  const override = process.env[`GOLDFISH_CMD_${tool.replace("-", "_").toUpperCase()}`];
  if (override) {
    const [cmd, ...args] = override.split(" ").filter(Boolean);
    return { cmd, args: [...args, prompt] };
  }
  switch (tool) {
    case "claude":
      return { cmd: "claude", args: ["-p", prompt] };
    case "cursor-agent":
      return { cmd: "cursor-agent", args: ["-p", "--output-format", "text", prompt] };
    case "omp":
      return { cmd: "omp", args: ompArgs(prompt, process.env.GOLDFISH_OMP_ADVISOR) };
  }
}

function hasCommand(name: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${name}`], { stdio: "ignore" }).status === 0;
}

function git(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function runLane(lane: Lane, prompt: string, timeoutMs: number): Promise<string> {
  const { cmd, args } = commandFor(lane.tool, prompt);
  // An empty cwd keeps the lane blind to the repo, other lanes' files, and local agent memory.
  const cwd = mkdtempSync(join(tmpdir(), `goldfish-${lane.id}-`));
  return new Promise((resolveLane, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => (stdout += chunk));
    child.stderr.on("data", chunk => (stderr += chunk));
    child.on("error", reject);
    child.on("close", code => (code === 0 ? resolveLane(stdout) : reject(new Error(`${lane.id} exited ${code}: ${stderr.slice(-400)}`))));
  });
}

interface CliOptions {
  base: string;
  since?: string;
  lanes: number | "auto";
  tools?: ToolName[];
  double: boolean;
  out: string;
  reviewMd?: string;
  maxLines: number;
  timeoutMs: number;
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { base: "origin/main", lanes: "auto", double: false, out: ".agent-review-state/goldfish", maxLines: 3000, timeoutMs: 900_000, dryRun: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = () => argv[++index] ?? "";
    if (flag === "--base") options.base = value();
    else if (flag === "--since") options.since = value();
    else if (flag === "--lanes") options.lanes = value() === "auto" ? "auto" : Number(argv[index]);
    else if (flag === "--tools") options.tools = value().split(",").filter((tool): tool is ToolName => TOOLS.includes(tool as ToolName));
    else if (flag === "--double") options.double = true;
    else if (flag === "--out") options.out = value();
    else if (flag === "--review-md") options.reviewMd = value();
    else if (flag === "--max-lines") options.maxLines = Number(value());
    else if (flag === "--timeout") options.timeoutMs = Number(value()) * 1000;
    else if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--help" || flag === "-h") {
      console.log("Usage: goldfish-review [--base <ref>] [--since <sha>] [--lanes auto|1-3] [--double] [--tools claude,cursor-agent,omp] [--review-md REVIEW.md] [--max-lines 3000] [--timeout 900] [--out dir] [--dry-run]");
      process.exit(0);
    } else throw new Error(`Unknown flag: ${flag}`);
  }
  return options;
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);
  const sha = git(["rev-parse", "HEAD"]).trim();
  const range = options.since ? `${options.since}..HEAD` : `${options.base}...HEAD`;
  const diff = filterDiff(git(["diff", "--no-color", range]), DEFAULT_EXCLUDES, options.maxLines);
  if (diff.files.length === 0) {
    console.log(`No reviewable changes in ${range}.`);
    return;
  }

  const reviewMdPath = options.reviewMd ?? (existsSync("REVIEW.md") ? "REVIEW.md" : undefined);
  const reviewMd = reviewMdPath ? readFileSync(reviewMdPath, "utf8") : null;
  const tools = (options.tools ?? TOOLS).filter(hasCommand);
  const count = options.lanes === "auto" ? chooseLaneCount(diff.changedLines, diff.files) : options.lanes;
  const lanes = planLanes(tools, count, options.double);

  const outDir = resolve(options.out, sha.slice(0, 12));
  mkdirSync(outDir, { recursive: true });
  console.error(`goldfish: ${range} -> ${diff.files.length} files, ${diff.changedLines} lines, lanes: ${lanes.map(lane => lane.id).join(", ")}`);

  if (options.dryRun) {
    for (const lane of lanes) writeFileSync(join(outDir, `${lane.id}.prompt.txt`), buildPrompt(lane, diff.text, reviewMd));
    console.log(`Dry run: prompts written to ${outDir}`);
    return;
  }

  // Lane outputs are written only after every lane settles, so no lane (or omp's advisor) can read another's findings mid-run.
  const settled = await Promise.allSettled(lanes.map(lane => runLane(lane, buildPrompt(lane, diff.text, reviewMd), options.timeoutMs)));
  const laneResults = settled.flatMap((result, index) => {
    const lane = lanes[index];
    if (result.status === "rejected") {
      console.error(`goldfish: lane ${lane.id} failed: ${String(result.reason)}`);
      return [];
    }
    writeFileSync(join(outDir, `${lane.id}.raw.txt`), result.value);
    try {
      return [{ lane: lane.id, findings: extractFindings(result.value) }];
    } catch (error) {
      console.error(`goldfish: lane ${lane.id} returned unparseable output: ${String(error)}`);
      return [];
    }
  });
  if (laneResults.length === 0) throw new Error("All goldfish lanes failed; see stderr above.");

  const { kept, dropped } = mergeFindings(laneResults, diff.files);
  writeFileSync(join(outDir, "merged.json"), JSON.stringify({ sha, range, lanes, kept, dropped, skippedFiles: diff.skippedFiles }, null, 2));
  console.log(formatSummary(kept, lanes, diff, sha));
  console.error(`goldfish: wrote ${join(outDir, "merged.json")} (${dropped.length} unconfirmed findings dropped)`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
