import {
  buildPrompt,
  chooseLaneCount,
  extractFindings,
  filterDiff,
  LENSES,
  mergeFindings,
  ompArgs,
  planLanes,
  type LaneFinding,
} from "../skills/goldfish-review/scripts/goldfish-review";

function fileDiff(path: string, added: number): string {
  const body = Array.from({ length: added }, (_, index) => `+line ${index}`).join("\n");
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1,${added} @@\n${body}\n`;
}

function finding(overrides: Partial<LaneFinding> = {}): LaneFinding {
  return { severity: "Important", file: "src/a.ts", line: 10, category: "correctness", summary: "bug", evidence: "x.y", ...overrides };
}

describe("chooseLaneCount", () => {
  it("scales with diff size", () => {
    expect(chooseLaneCount(10, ["src/a.ts"])).toBe(1);
    expect(chooseLaneCount(120, ["src/a.ts"])).toBe(2);
    expect(chooseLaneCount(900, ["src/a.ts"])).toBe(3);
  });

  it("adds a lane for risky paths, capped at three", () => {
    expect(chooseLaneCount(10, ["src/auth/session.ts"])).toBe(2);
    expect(chooseLaneCount(900, ["db/migrations/001.sql"])).toBe(3);
  });
});

describe("planLanes", () => {
  it("rotates tools and lenses across lanes", () => {
    expect(planLanes(["claude", "cursor-agent", "omp"], 3)).toEqual([
      { id: "claude-correctness", tool: "claude", lens: "correctness" },
      { id: "cursor-agent-security-data", tool: "cursor-agent", lens: "security-data" },
      { id: "omp-edge-errors", tool: "omp", lens: "edge-errors" },
    ]);
  });

  it("runs every lens with a single installed tool", () => {
    expect(planLanes(["claude"], 3).map(lane => lane.tool)).toEqual(["claude", "claude", "claude"]);
    expect(planLanes(["claude"], 1)).toHaveLength(1);
  });

  it("double mode covers each lens on two different tools", () => {
    const lanes = planLanes(["claude", "cursor-agent", "omp"], 1, true);
    expect(lanes).toHaveLength(LENSES.length * 2);
    for (const lens of LENSES) {
      const tools = lanes.filter(lane => lane.lens === lens).map(lane => lane.tool);
      expect(new Set(tools).size).toBe(2);
    }
    expect(new Set(lanes.map(lane => lane.id)).size).toBe(lanes.length);
  });

  it("fails clearly when no tool is installed", () => {
    expect(() => planLanes([], 2)).toThrow(/No review CLI/);
  });
});

describe("filterDiff", () => {
  it("skips lock and generated files", () => {
    const diff = fileDiff("src/a.ts", 2) + fileDiff("pnpm-lock.yaml", 50) + fileDiff("dist/index.js", 5) + fileDiff("src/__generated__/gql.ts", 5);
    const result = filterDiff(diff);
    expect(result.files).toEqual(["src/a.ts"]);
    expect(result.changedLines).toBe(2);
  });

  it("records files beyond the line cap as not reviewed", () => {
    const result = filterDiff(fileDiff("src/a.ts", 5) + fileDiff("src/b.ts", 5), [], 8);
    expect(result.files).toEqual(["src/a.ts"]);
    expect(result.skippedFiles).toEqual(["src/b.ts"]);
  });
});

describe("ompArgs", () => {
  it("enables the advisor by default and lets GOLDFISH_OMP_ADVISOR=0 turn it off", () => {
    expect(ompArgs("P", undefined)).toEqual(["-p", "--advisor", "P"]);
    expect(ompArgs("P", "1")).toEqual(["-p", "--advisor", "P"]);
    expect(ompArgs("P", "0")).toEqual(["-p", "P"]);
    expect(ompArgs("P", "false")).toEqual(["-p", "P"]);
  });
});

describe("buildPrompt", () => {
  it("gives every lane the shared baseline plus its own emphasis", () => {
    const [first, second] = planLanes(["claude", "omp"], 2);
    const a = buildPrompt(first, "DIFF", "No nits on tests/");
    const b = buildPrompt(second, "DIFF", null);
    expect(a).toContain("Baseline (always check)");
    expect(b).toContain("Baseline (always check)");
    expect(a).not.toEqual(b);
    expect(a).toContain("No nits on tests/");
  });
});

describe("extractFindings", () => {
  it("parses fenced JSON and normalizes fields", () => {
    const out = '```json\n{"findings":[{"severity":"Nit","file":"b/src/a.ts","line":3,"summary":"s","evidence":"e"},{"file":"x"}]}\n```';
    expect(extractFindings(out)).toEqual([
      { severity: "Nit", file: "src/a.ts", line: 3, endLine: undefined, category: "correctness", bugClass: undefined, summary: "s", evidence: "e" },
    ]);
  });

  it("unwraps a JSON envelope with a result string", () => {
    const out = JSON.stringify({ type: "result", result: '{"findings":[{"file":"a.ts","line":1,"summary":"s"}]}' });
    expect(extractFindings(out)).toHaveLength(1);
  });

  it("ignores advisor notes with braces printed around the answer", () => {
    const out = [
      '<advisory severity="nit">prefer {a, b} destructuring</advisory>',
      '{"findings":[{"file":"a.ts","line":1,"summary":"uses } in text","evidence":"if (x) { y }"}]}',
      '<advisory severity="concern">check the {retry} path</advisory>',
    ].join("\n");
    expect(extractFindings(out)).toEqual([expect.objectContaining({ summary: "uses } in text", evidence: "if (x) { y }" })]);
  });

  it("throws on non-JSON output", () => {
    expect(() => extractFindings("looks good to me")).toThrow();
  });
});

describe("mergeFindings", () => {
  const files = ["src/a.ts", "src/b.ts"];

  it("counts nearby findings from different lanes as one confirmed finding", () => {
    const { kept } = mergeFindings(
      [
        { lane: "claude-correctness", findings: [finding({ severity: "Nit", evidence: "" })] },
        { lane: "omp-edge-errors", findings: [finding({ line: 12, severity: "Nit", evidence: "" })] },
      ],
      files,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].votes).toBe(2);
  });

  it("does not fold one lane's separate nearby findings together", () => {
    const { kept, dropped } = mergeFindings(
      [
        { lane: "a", findings: [finding({ line: 2 }), finding({ line: 1, severity: "Nit", evidence: "" })] },
        { lane: "b", findings: [finding({ line: 3 })] },
      ],
      files,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].votes).toBe(2);
    expect(dropped.map(item => item.severity)).toEqual(["Nit"]);
  });

  it("keeps a single-lane Important with evidence but drops single-lane unevidenced nits", () => {
    const { kept, dropped } = mergeFindings(
      [
        { lane: "a", findings: [finding(), finding({ file: "src/b.ts", line: 90, severity: "Nit", evidence: "" })] },
        { lane: "b", findings: [] },
      ],
      files,
    );
    expect(kept.map(item => item.file)).toEqual(["src/a.ts"]);
    expect(dropped.map(item => item.file)).toEqual(["src/b.ts"]);
  });

  it("merges a bug class across files into one finding with every location", () => {
    const { kept } = mergeFindings(
      [
        { lane: "a", findings: [finding({ bugClass: "missing-null-check" })] },
        { lane: "b", findings: [finding({ file: "src/b.ts", line: 40, bugClass: "missing-null-check" })] },
      ],
      files,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].locations).toEqual(["src/a.ts:10", "src/b.ts:40"]);
  });

  it("drops findings outside the diff and pure style findings", () => {
    const { kept, dropped } = mergeFindings(
      [{ lane: "a", findings: [finding({ file: "src/other.ts" }), finding({ category: "style" })] }],
      files,
    );
    expect(kept).toEqual([]);
    expect(dropped).toEqual([]);
  });
});
