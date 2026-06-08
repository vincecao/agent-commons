import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { sortedEntries, timestampForBackup } from "./fs-utils";
import { linkPath, type LinkContext, type LinkTotals } from "./linker";
import { defaultSections, isSectionSelection, type AgentSection, type SectionName, type SectionSelection } from "./sections";

export interface SyncOptions {
  readonly root: string;
  readonly home: string;
  readonly only?: SectionSelection;
  readonly dryRun?: boolean;
  readonly logger?: (line: string) => void;
  readonly timestamp?: string;
}

export interface SyncSummary extends LinkTotals {
  readonly root: string;
  readonly sections: readonly SectionName[];
}

export function syncAgentCommons(options: SyncOptions): SyncSummary {
  const root = resolve(options.root);
  const only = options.only ?? "all";
  if (!isSectionSelection(only)) throw new Error(`Unknown section: ${only}`);

  const log = options.logger ?? console.log;
  const context: LinkContext = {
    root,
    dryRun: options.dryRun ?? false,
    timestamp: options.timestamp ?? timestampForBackup(),
    log,
    totals: { linked: 0, relinked: 0, backedUp: 0, ok: 0 },
  };
  const sections = defaultSections(resolve(options.home)).filter(section => only === "all" || section.name === only);

  for (const section of sections) {
    log("");
    log(`== ${section.name} ==`);
    linkSection(root, section, context);
  }

  log("");
  log(`Done. Agent commons linked from ${root}.`);

  return { root, sections: sections.map(section => section.name), ...context.totals };
}

// Build one small dispatch table so new content classes do not add branching.
function linkSection(root: string, section: AgentSection, context: LinkContext): void {
  const sources = [
    { src: join(root, "profiles", section.name), dest: section.profileRoot, kind: "profiles" },
    { src: join(root, "skills"), dest: section.skillsRoot, kind: "skills" },
    { src: join(root, "rules"), dest: section.rulesRoot, kind: "rules" },
  ] as const;

  for (const source of sources) {
    if (source.dest && existsSync(source.src)) {
      LINKERS[source.kind](source.src, source.dest, context);
    }
  }
}

const LINKERS = {
  profiles: linkProfiles,
  skills: linkSkills,
  rules: linkRules,
} as const;

// Profiles preserve nested paths so agent-specific native layouts stay intact.
function linkProfiles(srcRoot: string, destRoot: string, context: LinkContext): void {
  for (const entry of sortedEntries(srcRoot)) {
    const src = join(srcRoot, entry.name);
    const dest = join(destRoot, entry.name);

    if (entry.isDirectory()) {
      linkProfiles(src, dest, context);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      linkPath(src, dest, context);
    }
  }
}

// A skill directory is portable only when it follows the Agent Skills contract.
function linkSkills(srcRoot: string, destRoot: string, context: LinkContext): void {
  for (const entry of sortedEntries(srcRoot)) {
    const src = join(srcRoot, entry.name);
    if (entry.isDirectory() && existsSync(join(src, "SKILL.md"))) {
      linkPath(src, join(destRoot, entry.name), context);
    }
  }
}

// Cursor/OMP-style rules accept Markdown and MDC frontmatter files.
function linkRules(srcRoot: string, destRoot: string, context: LinkContext): void {
  for (const entry of sortedEntries(srcRoot)) {
    const isRuleFile = entry.name.endsWith(".md") || entry.name.endsWith(".mdc");
    if (isRuleFile && (entry.isFile() || entry.isSymbolicLink())) {
      linkPath(join(srcRoot, entry.name), join(destRoot, entry.name), context);
    }
  }
}
