import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linkPath, type LinkContext } from "../src/linker";
import { isSectionSelection } from "../src/sections";
import { syncAgentCommons } from "../src/sync";

const TEMP_PREFIX = join(tmpdir(), "agent-commons-test-");

let tempDir: string;
let root: string;
let home: string;

beforeEach(() => {
  tempDir = mkdtempSync(TEMP_PREFIX);
  root = join(tempDir, "repo");
  home = join(tempDir, "home");
  writeFile(join(root, ".agent-commons-id"), "agent-commons/v1\n");

  writeFile(join(root, "profiles", "claude", "CLAUDE.md"), "# Claude\n");
  writeFile(join(root, "profiles", "claude", "nested", "settings.md"), "# Nested\n");
  writeFile(join(root, "profiles", "omp", "RULES.md"), "# OMP\n");
  writeFile(join(root, "profiles", "cursor", "rules", "agent-commons.mdc"), "---\nalwaysApply: true\n---\n# Cursor\n");
  writeFile(join(root, "profiles", "gemini", "GEMINI.md"), "# Gemini\n");
  writeFile(join(root, "profiles", "opencode", "AGENTS.md"), "# OpenCode\n");
  writeFile(join(root, "skills", "example", "SKILL.md"), "---\nname: example\ndescription: Example\n---\n");
  writeFile(join(root, "skills", "not-a-skill", "README.md"), "ignored\n");
  writeFile(join(root, "rules", "defaults.md"), "# Defaults\n");
  writeFile(join(root, "rules", "cursor-only.mdc"), "---\nalwaysApply: true\n---\n# Cursor Rule\n");
  writeFile(join(root, "rules", "ignored.txt"), "ignored\n");
});

afterEach(() => {
  removeTempDir(tempDir);
});

describe("isSectionSelection", () => {
  it("accepts supported sections and rejects unknown names", () => {
    expect(isSectionSelection("all")).toBe(true);
    expect(isSectionSelection("omp")).toBe(true);
    expect(isSectionSelection("hermes")).toBe(true);
    expect(isSectionSelection("windsurf")).toBe(false);
  });
});

describe("syncAgentCommons", () => {
  it("prints planned operations without writing files during dry-run", () => {
    const logs: string[] = [];

    const summary = syncAgentCommons({ root, home, only: "omp", dryRun: true, logger: line => logs.push(line) });

    expect(summary.sections).toEqual(["omp"]);
    expect(summary.linked).toBe(4);
    expect(existsSync(join(home, ".omp"))).toBe(false);
    expect(logs.some(line => line.includes("[dry-run] ln -s"))).toBe(true);
  });

  it("links only the selected section", () => {
    syncAgentCommons({ root, home, only: "cursor", logger: () => undefined });

    expect(readlinkSync(join(home, ".cursor", "rules", "agent-commons.mdc"))).toBe(
      join(root, "profiles", "cursor", "rules", "agent-commons.mdc"),
    );
    expect(readlinkSync(join(home, ".cursor", "rules", "defaults.md"))).toBe(join(root, "rules", "defaults.md"));
    expect(readlinkSync(join(home, ".cursor", "rules", "cursor-only.mdc"))).toBe(join(root, "rules", "cursor-only.mdc"));
    expect(existsSync(join(home, ".cursor", "rules", "ignored.txt"))).toBe(false);
    expect(existsSync(join(home, ".cursor", "skills", "example"))).toBe(false);
    expect(existsSync(join(home, ".omp"))).toBe(false);
  });

  it("links skills only for sections with skill roots", () => {
    syncAgentCommons({ root, home, only: "all", logger: () => undefined });

    expect(readlinkSync(join(home, ".config", "opencode", "skills", "example"))).toBe(join(root, "skills", "example"));
    expect(readlinkSync(join(home, ".omp", "agent", "skills", "example"))).toBe(join(root, "skills", "example"));
    expect(existsSync(join(home, ".config", "opencode", "skills", "not-a-skill"))).toBe(false);
    expect(readlinkSync(join(home, ".gemini", "GEMINI.md"))).toBe(join(root, "profiles", "gemini", "GEMINI.md"));
    expect(existsSync(join(home, ".gemini", "skills"))).toBe(false);
  });

  it("links flat skills for hermes without touching its SOUL.md or creating rules", () => {
    const userSoul = join(home, ".hermes", "SOUL.md");
    writeFile(userSoul, "# User Soul\n");

    const summary = syncAgentCommons({ root, home, only: "hermes", logger: () => undefined });

    expect(summary.sections).toEqual(["hermes"]);
    expect(summary.backedUp).toBe(0);
    expect(readFileSync(userSoul, "utf8")).toBe("# User Soul\n");
    expect(readlinkSync(join(home, ".hermes", "skills", "example"))).toBe(join(root, "skills", "example"));
    expect(existsSync(join(home, ".hermes", "skills", "not-a-skill"))).toBe(false);
    expect(existsSync(join(home, ".hermes", "rules"))).toBe(false);
  });

  it("preserves nested profile paths", () => {
    syncAgentCommons({ root, home, only: "claude", logger: () => undefined });

    expect(readlinkSync(join(home, ".claude", "CLAUDE.md"))).toBe(join(root, "profiles", "claude", "CLAUDE.md"));
    expect(readlinkSync(join(home, ".claude", "nested", "settings.md"))).toBe(
      join(root, "profiles", "claude", "nested", "settings.md"),
    );
  });

  it("leaves correct symlinks untouched", () => {
    syncAgentCommons({ root, home, only: "omp", logger: () => undefined });
    const logs: string[] = [];

    const summary = syncAgentCommons({ root, home, only: "omp", logger: line => logs.push(line) });

    expect(summary.ok).toBe(4);
    expect(summary.linked).toBe(0);
    expect(logs.filter(line => line.startsWith("ok     "))).toHaveLength(4);
  });

  it("backs up user symlinks before installing the commons symlink", () => {
    const userTarget = join(tempDir, "user-target");
    const dest = join(home, ".omp", "agent", "RULES.md");
    const backup = `${dest}.backup.20260102030405`;
    writeFile(userTarget, "user\n");
    mkdirSync(dirname(dest), { recursive: true });
    symlinkSync(userTarget, dest);

    const summary = syncAgentCommons({
      root,
      home,
      only: "omp",
      logger: () => undefined,
      timestamp: "20260102030405",
    });

    expect(summary.backedUp).toBe(1);
    expect(summary.linked).toBe(4);
    expect(existsSync(userTarget)).toBe(true);
    expect(readlinkSync(backup)).toBe(userTarget);
    expect(readlinkSync(dest)).toBe(join(root, "profiles", "omp", "RULES.md"));
  });

  it("does not move user symlinks during dry-run", () => {
    const userTarget = join(tempDir, "user-target");
    const dest = join(home, ".omp", "agent", "RULES.md");
    writeFile(userTarget, "user\n");
    mkdirSync(dirname(dest), { recursive: true });
    symlinkSync(userTarget, dest);

    const summary = syncAgentCommons({
      root,
      home,
      only: "omp",
      dryRun: true,
      logger: () => undefined,
      timestamp: "20260102030405",
    });

    expect(summary.backedUp).toBe(1);
    expect(summary.linked).toBe(4);
    expect(readlinkSync(dest)).toBe(userTarget);
    expect(existsSync(`${dest}.backup.20260102030405`)).toBe(false);
  });

  it("relinks symlinks owned by another agent-commons checkout", () => {
    const oldRoot = join(tempDir, "old-commons");
    const oldTarget = join(oldRoot, "profiles", "omp", "RULES.md");
    writeFile(join(oldRoot, ".agent-commons-id"), "agent-commons/v1\n");
    writeFile(oldTarget, "# Old OMP\n");
    mkdirSync(join(home, ".omp", "agent"), { recursive: true });
    symlinkSync(oldTarget, join(home, ".omp", "agent", "RULES.md"));

    const summary = syncAgentCommons({ root, home, only: "omp", logger: () => undefined });

    expect(summary.relinked).toBe(1);
    expect(summary.backedUp).toBe(0);
    expect(readlinkSync(join(home, ".omp", "agent", "RULES.md"))).toBe(join(root, "profiles", "omp", "RULES.md"));
  });

  it("backs up blocking real files before installing the commons symlink", () => {
    const dest = join(home, ".omp", "agent", "RULES.md");
    writeFile(dest, "local file\n");

    const summary = syncAgentCommons({
      root,
      home,
      only: "omp",
      logger: () => undefined,
      timestamp: "20260102030405",
    });

    expect(summary.backedUp).toBe(1);
    expect(readFileSync(`${dest}.backup.20260102030405`, "utf8")).toBe("local file\n");
    expect(readlinkSync(dest)).toBe(join(root, "profiles", "omp", "RULES.md"));
  });

  it("keeps backup names collision-safe", () => {
    const dest = join(home, ".omp", "agent", "RULES.md");
    writeFile(dest, "local file\n");
    writeFile(`${dest}.backup.20260102030405`, "existing backup\n");

    syncAgentCommons({ root, home, only: "omp", logger: () => undefined, timestamp: "20260102030405" });

    expect(readFileSync(`${dest}.backup.20260102030405`, "utf8")).toBe("existing backup\n");
    expect(readFileSync(`${dest}.backup.20260102030405.1`, "utf8")).toBe("local file\n");
  });

  it("throws for unknown sections", () => {
    expect(() =>
      syncAgentCommons({ root, home, only: "bad-section" as never, logger: () => undefined }),
    ).toThrow("Unknown section: bad-section");
  });
});

describe("linkPath", () => {
  it("throws before writing when source is missing", () => {
    const context: LinkContext = {
      root,
      dryRun: false,
      timestamp: "20260102030405",
      log: () => undefined,
      totals: { linked: 0, relinked: 0, backedUp: 0, ok: 0 },
    };

    expect(() => linkPath(join(root, "missing"), join(home, "dest"), context)).toThrow("Missing source");
    expect(existsSync(home)).toBe(false);
  });
});

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function removeTempDir(path: string): void {
  if (!path.startsWith(TEMP_PREFIX)) throw new Error(`Refusing to remove non-test path: ${path}`);
  rmSync(path, { recursive: true, force: true });
}
