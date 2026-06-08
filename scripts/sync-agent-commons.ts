#!/usr/bin/env -S tsx
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import { SECTION_NAMES, isSectionSelection, type SectionSelection } from "../src/sections";
import { syncAgentCommons } from "../src/sync";

interface CliOptions {
  dryRun?: boolean;
  home: string;
  only: SectionSelection;
  root?: string;
}

const program = new Command();

program
  .name("sync-agent-commons")
  .description("Symlink shared agent commons into local agent config directories.")
  .option("--dry-run", "print actions without changing files")
  .option("--home <path>", "target home directory", process.env.HOME ?? "")
  .option("--root <path>", "agent-commons repo root; defaults to this checkout")
  .option("--only <section>", `link one section: ${[...SECTION_NAMES, "all"].join(", ")}`, parseSection, "all")
  .action((options: CliOptions) => {
    const root = resolve(options.root ?? findRepoRoot(dirname(fileURLToPath(import.meta.url))));
    const home = resolve(options.home);

    syncAgentCommons({
      root,
      home,
      only: options.only,
      dryRun: options.dryRun ?? false,
    });
  });

program.parse();

function parseSection(value: string): SectionSelection {
  if (isSectionSelection(value)) return value;
  throw new InvalidArgumentError(`unknown section: ${value}`);
}

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);

  while (true) {
    if (existsSync(resolve(current, "package.json")) && existsSync(resolve(current, "rules"))) return current;

    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not find agent-commons root from ${startDir}`);
    current = parent;
  }
}
