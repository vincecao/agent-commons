import { existsSync, mkdirSync, readlinkSync, renameSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { safeLstat, shellQuote } from "./fs-utils";

export interface LinkTotals {
  linked: number;
  relinked: number;
  backedUp: number;
  ok: number;
}

export interface LinkContext {
  readonly dryRun: boolean;
  readonly timestamp: string;
  readonly log: (line: string) => void;
  readonly totals: LinkTotals;
}

export function linkPath(src: string, dest: string, context: LinkContext): void {
  if (!existsSync(src)) throw new Error(`Missing source: ${src}`);

  run(context, ["mkdir", "-p", dirname(dest)], () => mkdirSync(dirname(dest), { recursive: true }));

  // Symlink handling is idempotent: correct links are success, stale links are repaired.
  const destStat = safeLstat(dest);
  if (destStat?.isSymbolicLink()) {
    const current = readlinkSync(dest);
    if (current === src) {
      context.totals.ok += 1;
      context.log(`ok     ${dest} -> ${src}`);
      return;
    }

    context.totals.relinked += 1;
    context.log(`relink ${dest} -> ${src} (was ${current})`);
    run(context, ["unlink", dest], () => unlinkSync(dest));
    // Real files may contain user data, so move them aside instead of overwriting.
  } else if (destStat) {
    const backup = nextBackupPath(dest, context.timestamp);
    context.totals.backedUp += 1;
    context.log(`backup ${dest} -> ${backup}`);
    run(context, ["mv", dest, backup], () => renameSync(dest, backup));
  } else {
    context.totals.linked += 1;
    context.log(`link   ${dest} -> ${src}`);
  }

  run(context, ["ln", "-s", src, dest], () => symlinkSync(src, dest));
}

function run(context: LinkContext, command: string[], action: () => void): void {
  if (context.dryRun) {
    context.log(`[dry-run] ${command.map(shellQuote).join(" ")}`);
    return;
  }

  action();
}

// Backup suffixes stay deterministic for tests but collision-safe for repeated runs.
function nextBackupPath(dest: string, timestamp: string): string {
  let backup = `${dest}.backup.${timestamp}`;
  let index = 1;

  while (safeLstat(backup)) {
    backup = `${dest}.backup.${timestamp}.${index}`;
    index += 1;
  }

  return backup;
}
