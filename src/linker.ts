import { existsSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { safeLstat, shellQuote } from "./fs-utils";

const OWNER_FILE = ".agent-commons-id";
const OWNER_KEY = "agent-commons/v1";

export interface LinkTotals {
  linked: number;
  relinked: number;
  skipped: number;
  ok: number;
}

export interface LinkContext {
  readonly root: string;
  readonly dryRun: boolean;
  readonly log: (line: string) => void;
  readonly totals: LinkTotals;
}

export function linkPath(src: string, dest: string, context: LinkContext): void {
  if (!existsSync(src)) throw new Error(`Missing source: ${src}`);
  if (!isOwnedRoot(context.root)) throw new Error(`Missing ${OWNER_FILE} marker in ${context.root}`);

  run(context, ["mkdir", "-p", dirname(dest)], () => mkdirSync(dirname(dest), { recursive: true }));

  const destStat = safeLstat(dest);
  if (!destStat) {
    context.totals.linked += 1;
    context.log(`link   ${dest} -> ${src}`);
    run(context, ["ln", "-s", src, dest], () => symlinkSync(src, dest));
    return;
  }

  if (!destStat.isSymbolicLink()) {
    context.totals.skipped += 1;
    context.log(`skip   ${dest} (user file exists)`);
    return;
  }

  // Only links marked as agent-commons-owned may be replaced; user files/links stay intact.
  const current = readlinkSync(dest);
  if (current === src) {
    context.totals.ok += 1;
    context.log(`ok     ${dest} -> ${src}`);
    return;
  }

  if (!isOwnedLink(current, dest)) {
    context.totals.skipped += 1;
    context.log(`skip   ${dest} (user link exists: ${current})`);
    return;
  }

  context.totals.relinked += 1;
  context.log(`relink ${dest} -> ${src} (was ${current})`);
  run(context, ["unlink", dest], () => unlinkSync(dest));
  run(context, ["ln", "-s", src, dest], () => symlinkSync(src, dest));
}

function run(context: LinkContext, command: string[], action: () => void): void {
  if (context.dryRun) {
    context.log(`[dry-run] ${command.map(shellQuote).join(" ")}`);
    return;
  }

  action();
}

function isOwnedLink(target: string, dest: string): boolean {
  const targetPath = resolve(dirname(dest), target);
  const start = safeLstat(targetPath)?.isDirectory() ? targetPath : dirname(targetPath);
  return findOwnerRoot(start) !== null;
}

function isOwnedRoot(root: string): boolean {
  return readOwnerKey(root) === OWNER_KEY;
}

function findOwnerRoot(start: string): string | null {
  let current = resolve(start);

  while (true) {
    if (isOwnedRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readOwnerKey(dir: string): string | null {
  const marker = join(dir, OWNER_FILE);
  if (!safeLstat(marker)?.isFile()) return null;
  return readFileSync(marker, "utf8").trim();
}
