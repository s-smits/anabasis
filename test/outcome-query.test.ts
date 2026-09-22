/**
 * Pins the searchable operator projections. Case discovery keeps evidence outcomes and verified
 * trace state together; a case report cites the digest-bound evidence; observation search is strict
 * and leaves prompt bodies out unless the operator asks for them.
 */
import type { JsonValue } from "../src/meta/json-shape.ts";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { basename, join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { CASE_TRACE_SCHEMA } from "../src/backends/trace-capture.ts";
import { type CaseRecordRow, tracePointer } from "../src/claim/case-record.ts";
import { campaignTraceRoots, readVerifiedTrace, readVerifiedTraceUnder } from "../src/claim/trace-read.ts";
import { main } from "../tools/outcome/cli.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
const TRACE_JSON = "trace.json";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

import { caseRecordRow } from "./helpers/case-record-row.ts";

function baseRow(taskId: string, variant: string, pass: boolean): CaseRecordRow {
  return caseRecordRow(taskId, taskId.startsWith("hard") ? "hard" : "easy", {
    runId: `run-16-${variant}`,
    buildInputsHash: "build-hash",
    backendPin: "claude/opus",
    truthOk: pass,
    pass,
    condition: { variant, advisorsRemoved: [], toolInterfaceHash: null },
  });
}

function trace(tool: string): string {
  return JSON.stringify({
    schema: CASE_TRACE_SCHEMA,
    backend: "claude",
    turns: [{ turn: 1, inputTokens: 10 }],
    toolCalls: [{ seq: 1, turn: 1, toolName: tool, argsDigest: "a".repeat(64), isError: false }],
    droppedRawEvents: 0,
    truncated: false,
  });
}

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-outcome-query-"));
  scratch.push(dir);
  mkdirSync(join(dir, "traces"));
  writeFileSync(join(dir, "traces", "hard-1.json"), trace("query_catalog"));
  writeFileSync(join(dir, "traces", "easy-1.json"), trace("submit"));
  const hard = {
    ...baseRow("hard-1", "repair-on", false),
    solverStartedAt: "2026-07-29T10:00:00.000Z",
    solverEndedAt: "2026-07-29T10:00:09.500Z",
    traces: [tracePointer(dir, "traces/hard-1.json")],
  };
  const easy = {
    ...baseRow("easy-1", "repair-off", true),
    traces: [tracePointer(dir, "traces/easy-1.json")],
  };
  writeFileSync(
    join(dir, "case-record.jsonl"),
    `${[hard, easy].map((row, index) => JSON.stringify({ seq: index + 1, row })).join("\n")}\n`,
  );
  mkdirSync(join(dir, "observability"));
  const observations = [
    {
      schema: "ana-observation/v2",
      id: "run-16:1",
      seq: 1,
      at: "2026-07-29T10:00:00.000Z",
      runId: "run-16",
      parentId: null,
      kind: "generation",
      level: "default",
      type: "prompt-ingested",
      contract: "built",
      subjectId: "hard-1",
      prompt: "large secret-shaped prompt body",
      promptDigest: "b".repeat(64),
      chars: 31,
    },
    {
      schema: "ana-observation/v2",
      id: "run-16:2",
      seq: 2,
      at: "2026-07-29T10:00:01.000Z",
      runId: "run-16",
      parentId: null,
      kind: "span",
      level: "error",
      type: "phase-transition",
      phase: "measure-on",
      state: "failed",
      subjectId: "hard-1",
      summary: "case failed",
    },
    {
      schema: "ana-observation/v2",
      id: "run-16:3",
      seq: 3,
      at: "2026-07-29T10:00:00.500Z",
      runId: "run-16",
      parentId: "run-16:1",
      kind: "event",
      level: "default",
      type: "steering-ingested",
      claim: "continue",
    },
  ];
  writeFileSync(
    join(dir, "observability", "run-16-repair-on.jsonl"),
    `${observations.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  return dir;
}

describe("outcome case search", () => {
  it("filters by evidence outcome, variant, family and verified trace tool", () => {
    const dir = fixture();
    const report = parseJsonAs<Record<string, JsonValue>>(
      main([
        dir,
        "run-16",
        "--cases",
        "--result",
        "fail",
        "--variant",
        "repair-on",
        "--family",
        "hard",
        "--tool",
        "query_catalog",
      ]),
    );
    expect(report).toMatchObject({
      schema: "outcome-case-search/v1",
      matched: 1,
      returned: 1,
      truncated: false,
      cases: [
        {
          taskId: "hard-1",
          outcome: "fail",
          telemetry: "recorded",
          turns: 1,
          toolCalls: 1,
          solverDurationMs: 9500,
        },
      ],
      facets: {
        all: { byOutcome: { fail: 1, pass: 1 } },
        matched: { byOutcome: { fail: 1 } },
      },
    });
  });

  it("keeps the solver duration null for a row recorded before timestamps were recorded", () => {
    const dir = fixture();
    const report = parseJsonAs<Record<string, JsonValue>>(
      main([dir, "run-16", "--cases", "--variant", "repair-off"]),
    );
    expect(report).toMatchObject({
      matched: 1,
      cases: [{ taskId: "easy-1", solverDurationMs: null }],
    });
  });

  it("builds a bounded case report with evidence identity and the digest-bound evidence path", () => {
    const dir = fixture();
    const report = parseJsonAs<Record<string, JsonValue>>(
      main([dir, "run-16", "--case", "hard-1", "--variant", "repair-on"]),
    );
    expect(report).toMatchObject({
      schema: "outcome-case-dossier/v1",
      observations: { state: "readable", report: { matched: 3, promptsIncluded: false } },
      cases: [
        {
          identity: { builderId: "builder-1", backendPin: "claude/opus" },
          verdict: { acceptedSubmit: true, pass: false },
          trace: { state: "recorded", schema: CASE_TRACE_SCHEMA },
          evidence: { trace: { path: "traces/hard-1.json" } },
        },
      ],
    });
    expect(JSON.stringify(report)).not.toContain('"prompt"');
  });

  it("keeps evidence and trace facts readable when lifecycle telemetry is torn", () => {
    const dir = fixture();
    writeFileSync(join(dir, "observability", "run-16-repair-on.jsonl"), "{torn\n");
    const report = parseJsonAs<Record<string, JsonValue>>(
      main([dir, "run-16", "--case", "hard-1", "--variant", "repair-on"]),
    );
    expect(report).toMatchObject({
      observations: { state: "unreadable", error: expect.stringMatching(/malformed observation line/) },
      cases: [{ taskId: "hard-1", trace: { state: "recorded" } }],
    });
  });

  it("states truncation instead of letting a limit change the matched denominator", () => {
    const report = parseJsonAs<{
      matched: number;
      returned: number;
      truncated: boolean;
    }>(main([fixture(), "run-16", "--cases", "--limit", "1"]));
    expect(report).toMatchObject({ matched: 2, returned: 1, truncated: true });
  });

  it("accepts a tools-spec name when the trace carries an MCP transport prefix", () => {
    const dir = fixture();
    writeFileSync(join(dir, "traces", "hard-1.json"), trace("mcp__harness__query_catalog"));
    const record = join(dir, "case-record.jsonl");
    const rows = readFileSync(record, "utf8")
      .trim()
      .split("\n")
      .map((line) => parseJsonAs<{ seq: number; row: CaseRecordRow }>(line));
    const first = rows[0];
    if (first === undefined) throw new Error("fixture record is empty");
    rows[0] = {
      ...first,
      row: { ...first.row, traces: [tracePointer(dir, "traces/hard-1.json")] },
    };
    writeFileSync(record, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    const report = parseJsonAs<Record<string, JsonValue>>(
      main([dir, "run-16", "--cases", "--tool", "query_catalog"]),
    );
    expect(report).toMatchObject({ matched: 1, cases: [{ taskId: "hard-1" }] });
  });
});

describe("outcome observation search", () => {
  it("filters warning and error events without printing prompt bodies by default", () => {
    const report = parseJsonAs<Record<string, JsonValue>>(
      main([fixture(), "run-16", "--observations", "--level", "error", "--subject", "hard-1"]),
    );
    expect(report).toMatchObject({
      schema: "outcome-observation-search/v1",
      total: 3,
      matched: 1,
      promptsIncluded: false,
      observations: [{ type: "phase-transition", level: "error", subjectId: "hard-1" }],
      facets: {
        all: { byLevel: { default: 2, error: 1 } },
        matched: { byLevel: { error: 1 } },
      },
    });
    expect(JSON.stringify(report)).not.toContain("large secret-shaped prompt body");
  });

  it("includes prompt bodies only after the explicit flag", () => {
    const report = main([
      fixture(),
      "run-16",
      "--observations",
      "--type",
      "prompt-ingested",
      "--include-prompts",
    ]);
    expect(report).toContain("large secret-shaped prompt body");
  });

  it("follows a subject through child observations that do not repeat the subject id", () => {
    const report = parseJsonAs<Record<string, JsonValue>>(
      main([fixture(), "run-16", "--observations", "--subject", "hard-1", "--type", "steering-ingested"]),
    );
    expect(report).toMatchObject({
      matched: 1,
      observations: [{ id: "run-16:3", parentId: "run-16:1", claim: "continue" }],
    });
  });

  it("refuses a torn observation line instead of silently losing it from search", () => {
    const dir = fixture();
    writeFileSync(join(dir, "observability", "run-17.jsonl"), "{torn\n");
    expect(() => main([dir, "run-17", "--observations"])).toThrow(/malformed observation line/);
  });
});

describe("outcome CLI conditions", () => {
  it("refuses filters under the wrong mode and invalid limits", () => {
    const dir = fixture();
    expect(() => main([dir, "run-16", "--level", "error"])).toThrow(
      /observation filters need --observations/,
    );
    expect(() => main([dir, "run-16", "--cases", "--limit", "0"])).toThrow(/positive integer/);
    expect(() => main([dir, "run-16", "--observations", "--level", "urgent"])).toThrow(
      /unknown observation level/,
    );
  });
});

/**
 * Tests for the shared verified trace reader used by the reports above. The former Judge 2
 * reader checked only whether a file existed, despite its comment promising a digest check.
 * That allowed changed files to reach a model under the original recorded identity. These cases
 * require both a matching digest and a readable trace schema before returning data; all other
 * outcomes report the reason the trace is unavailable.
 */
function traceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-trace-read-"));
  scratch.push(dir);
  return dir;
}

/** A trace the recorder would write, in the current schema unless a test names an earlier one. */
function readableTrace(schema: string = CASE_TRACE_SCHEMA): string {
  return JSON.stringify({
    schema,
    backend: "codex",
    turns: [{ turn: 1 }],
    toolCalls: [{ toolName: "submit" }],
    droppedRawEvents: 0,
    truncated: false,
  });
}

function writeTrace(dir: string, rel: string, bytes: string) {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), bytes);
  return tracePointer(dir, rel);
}

describe("readVerifiedTrace", () => {
  it("returns the parsed trace only for an intact pointer whose bytes are a readable trace", () => {
    const dir = traceDir();
    const pointer = writeTrace(dir, "cases/t-1/trace.json", readableTrace());
    const read = readVerifiedTrace({ traces: [pointer] }, dir);
    expect(read.state).toBe("recorded");
    expect(read.trace?.turns).toHaveLength(1);
    expect(read.path).toBe("cases/t-1/trace.json");
  });

  it("refuses an intact trace in an earlier schema, which the recorder no longer writes", () => {
    const dir = traceDir();
    const pointer = writeTrace(dir, TRACE_JSON, readableTrace("case-trace/v3"));
    const read = readVerifiedTrace({ traces: [pointer] }, dir);
    expect(read.state).toBe("no-trace-pointer");
    expect(read.trace).toBeNull();
  });

  it("skips intact non-trace pointers (battery.json) and reads the trace behind them", () => {
    const dir = traceDir();
    const battery = writeTrace(dir, "battery.json", JSON.stringify({ runId: "r" }));
    const recorded = writeTrace(dir, "cases/t-1/trace.json", readableTrace());
    const read = readVerifiedTrace({ traces: [battery, recorded] }, dir);
    expect(read.state).toBe("recorded");
    expect(read.path).toBe("cases/t-1/trace.json");
  });

  it("refuses drifted bytes as a typed absence instead of returning them", () => {
    const dir = traceDir();
    const pointer = writeTrace(dir, TRACE_JSON, readableTrace());
    writeFileSync(join(dir, TRACE_JSON), readableTrace().replace("codex", "other"));
    const read = readVerifiedTrace({ traces: [pointer] }, dir);
    expect(read).toMatchObject({ state: "trace-drifted", trace: null, path: null });
  });

  it("states missing for a pointer whose file is gone, and no-trace-pointer for an empty row", () => {
    const dir = traceDir();
    const pointer = writeTrace(dir, TRACE_JSON, readableTrace());
    rmSync(join(dir, TRACE_JSON));
    expect(readVerifiedTrace({ traces: [pointer] }, dir).state).toBe("trace-missing");
    expect(readVerifiedTrace({ traces: [] }, dir).state).toBe("no-trace-pointer");
  });

  it("refuses an intact pre-schema stub: digest alone does not make bytes a trace", () => {
    const dir = traceDir();
    const pointer = writeTrace(dir, TRACE_JSON, JSON.stringify({ turns: [] }));
    expect(readVerifiedTrace({ traces: [pointer] }, dir).state).toBe("no-trace-pointer");
  });
});

describe("readVerifiedTraceUnder", () => {
  it("refuses linked slug leaves and linked candidate containers, even when supplied as cached roots", () => {
    for (const surface of ["campaign", "domain", "candidates", "contest", "promotions", "versions"]) {
      const root = traceDir();
      const outside = traceDir();
      const campaign = join(root, "campaigns", "slug");
      const target =
        surface === "campaign"
          ? campaign
          : surface === "domain"
            ? join(root, "domains", "slug")
            : join(campaign, surface);
      mkdirSync(join(root, "campaigns"), { recursive: true });
      mkdirSync(join(root, "domains"), { recursive: true });
      if (surface !== "campaign") mkdirSync(campaign);
      symlinkSync(outside, target);
      const tree = ["candidates", "contest", "promotions", "versions"].includes(surface)
        ? join(outside, "r-replaced")
        : outside;
      const cached = ["candidates", "contest", "promotions", "versions"].includes(surface)
        ? join(target, "r-replaced")
        : target;
      const pointer = writeTrace(tree, "runs/r/cases/t/trace.json", readableTrace());
      expect(campaignTraceRoots(campaign)).not.toContain(cached);
      expect(readVerifiedTraceUnder({ traces: [pointer] }, campaign, [cached, outside]).state).toBe(
        "trace-missing",
      );
      expect(readVerifiedTrace({ traces: [pointer] }, tree).state).toBe("recorded");
    }
  });

  it("keeps linked output collections usable but refuses linked candidate roots, including cached roots", () => {
    const root = traceDir();
    const shared = traceDir();
    const campaign = join(root, "campaigns", "slug");
    mkdirSync(join(shared, "campaigns", "slug"), { recursive: true });
    mkdirSync(join(shared, "domains"), { recursive: true });
    symlinkSync(join(shared, "campaigns"), join(root, "campaigns"));
    symlinkSync(join(shared, "domains"), join(root, "domains"));
    const candidate = join(campaign, "candidates", "r");
    const pointer = writeTrace(candidate, "runs/r/cases/t/trace.json", readableTrace());
    const roots = campaignTraceRoots(campaign);
    expect(readVerifiedTraceUnder({ traces: [pointer] }, campaign, roots).state).toBe("recorded");
    const outside = join(traceDir(), "moved");
    renameSync(candidate, outside);
    symlinkSync(outside, candidate);
    expect(campaignTraceRoots(campaign)).not.toContain(candidate);
    expect(readVerifiedTraceUnder({ traces: [pointer] }, campaign, roots).state).toBe("trace-missing");
    expect(readVerifiedTrace({ traces: [pointer] }, outside).state).toBe("recorded");
  });

  it("refuses nested evidence links and traversal even when their bytes match the pointer", () => {
    const root = traceDir();
    const outside = traceDir();
    const pointer = writeTrace(outside, TRACE_JSON, readableTrace());
    symlinkSync(outside, join(root, "linked"));
    expect(readVerifiedTrace({ traces: [{ ...pointer, path: "linked/trace.json" }] }, root).state).toBe(
      "trace-missing",
    );
    expect(
      readVerifiedTrace({ traces: [{ ...pointer, path: join("..", basename(outside), TRACE_JSON) }] }, root)
        .state,
    ).toBe("trace-missing");
    expect(readVerifiedTrace({ traces: [{ ...pointer, path: join(outside, TRACE_JSON) }] }, root).state).toBe(
      "trace-missing",
    );
    expect(readVerifiedTrace({ traces: [pointer] }, outside).state).toBe("recorded");
  });

  it("probes the adopted-tree sibling when the campaign root lacks the file", () => {
    const root = traceDir();
    const campaignDir = join(root, "campaigns", "slug");
    const treeDir = join(root, "domains", "slug");
    mkdirSync(campaignDir, { recursive: true });
    const pointer = writeTrace(treeDir, "runs/r/cases/t-1/trace.json", readableTrace());
    const read = readVerifiedTraceUnder({ traces: [pointer] }, campaignDir);
    expect(read.state).toBe("recorded");
    expect(read.baseDir).toBe(treeDir);
    expect(campaignTraceRoots(campaignDir)).toContain(treeDir);
  });

  it("reads a replaced promotion archive and refuses a later link at that cached root", () => {
    const root = traceDir();
    const campaign = join(root, "campaigns", "slug");
    const archive = join(campaign, "promotions", "r-replaced");
    const pointer = writeTrace(archive, "runs/r/cases/t/trace.json", readableTrace());
    const roots = campaignTraceRoots(campaign);
    expect(readVerifiedTraceUnder({ traces: [pointer] }, campaign, roots).state).toBe("recorded");
    const outside = join(traceDir(), "moved");
    renameSync(archive, outside);
    symlinkSync(outside, archive);
    expect(readVerifiedTraceUnder({ traces: [pointer] }, campaign, roots).state).toBe("trace-missing");
  });

  it("never resolves a same-named file whose digest does not match", () => {
    const root = traceDir();
    const campaignDir = join(root, "campaigns", "slug");
    const pointer = writeTrace(join(root, "domains", "slug"), TRACE_JSON, readableTrace());
    writeTrace(campaignDir, TRACE_JSON, readableTrace().replace("codex", "other"));
    const read = readVerifiedTraceUnder({ traces: [pointer] }, campaignDir);
    expect(read.state).toBe("trace-drifted");
    expect(read.trace).toBeNull();
  });

  it("states missing when no conventional root carries the path", () => {
    const root = traceDir();
    const campaignDir = join(root, "campaigns", "slug");
    mkdirSync(campaignDir, { recursive: true });
    const absent = { traces: [{ path: "runs/r/trace.json", sha256: "0".repeat(64) }] };
    expect(readVerifiedTraceUnder(absent, campaignDir).state).toBe("trace-missing");
  });
});
