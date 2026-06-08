import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeLstat, shellQuote, sortedEntries, timestampForBackup } from "../src/fs-utils";

const TEMP_PREFIX = join(tmpdir(), "agent-commons-fs-test-");

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(TEMP_PREFIX);
});

afterEach(() => {
  if (!tempDir.startsWith(TEMP_PREFIX)) throw new Error(`Refusing to remove non-test path: ${tempDir}`);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("safeLstat", () => {
  it("returns null for missing paths", () => {
    expect(safeLstat(join(tempDir, "missing"))).toBeNull();
  });

  it("returns stats for existing paths", () => {
    const path = join(tempDir, "file.txt");
    writeFileSync(path, "content\n");

    expect(safeLstat(path)?.isFile()).toBe(true);
  });
});

describe("sortedEntries", () => {
  it("returns entries in stable name order", () => {
    writeFileSync(join(tempDir, "b.txt"), "b\n");
    writeFileSync(join(tempDir, "a.txt"), "a\n");

    expect(sortedEntries(tempDir).map(entry => entry.name)).toEqual(["a.txt", "b.txt"]);
  });
});

describe("shellQuote", () => {
  it("leaves safe shell tokens unquoted", () => {
    expect(shellQuote("/tmp/agent-commons:file")).toBe("/tmp/agent-commons:file");
  });

  it("quotes spaces and embedded single quotes", () => {
    expect(shellQuote("a user's file")).toBe("'a user'\\''s file'");
  });
});

describe("timestampForBackup", () => {
  it("formats timestamps as compact local datetimes", () => {
    expect(timestampForBackup(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102030405");
  });
});
