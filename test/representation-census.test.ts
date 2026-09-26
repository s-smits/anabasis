/**
 * The F2 witnesses the solvability gate reads besides its counts: constant reference output across
 * distinct public inputs, and how the gate projects a census with neither tool nor task ids.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { double } from "./helpers/doubles.ts";
import type { BuiltHarness } from "../src/author/campaign-types.ts";
import { type Witness, inputInsensitivity } from "../src/run/representation-census.ts";
import { makeSolvabilityCensusGate } from "../src/run/solvability-gate.ts";
import { probeReturning } from "./helpers/solvability-probe.ts";
import { keysIf } from "../src/meta/optional-key.ts";

const SCRATCH = mkdtempSync(join(tmpdir(), "ana-representation-"));
const CATALOG = [
  { recordId: "DOC-ALPHA", medium: "digital", accessionCodeOptions: ["A-104", "A-105"] },
  { recordId: "MAP-BETA", medium: "external", accessionCodeOptions: ["n/a", "none"] },
];

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** A root that transcribes the catalogue, beside an answer that spells "n/a". */
function absentAndCopied(taskId: string): Witness {
  return {
    taskId,
    publicInput: { catalogue: CATALOG, shelfCapacity: 100 },
    artifact: {
      catalogueFacts: CATALOG,
      selection: {
        records: [
          { recordId: "DOC-ALPHA", accessionCode: "A-104" },
          { recordId: "MAP-BETA", accessionCode: "n/a" },
        ],
      },
    },
  };
}

/** The solve reads fields nobody authored, so its derived root is the same (empty) value on every
 *  task while the authored inputs all differ. */
const constantPlan = (taskId: string, requests: string[]): Witness => ({
  taskId,
  publicInput: { requestedItems: requests.map((requestId) => ({ requestId })) },
  artifact: { allocationPlan: [], requestFacts: requests },
});

describe("the input-insensitivity observation", () => {
  it("names the constant root with both denominators, and only that root", () => {
    const findings = inputInsensitivity([constantPlan("t1", ["U01"]), constantPlan("t2", ["U01", "U02"])]);
    expect(findings.map((f) => f.code)).toEqual(["REFERENCE_SOLVE_IGNORES_PUBLIC_INPUT"]);
    expect(findings[0]?.path).toBe("correctness-model/reference/index.ts#solve");
    expect(findings[0]?.detail).toContain('"allocationPlan"');
    expect(findings[0]?.detail).toContain("all 2 failed reference solves");
    expect(findings[0]?.detail).toContain("2 distinct public inputs");
    // The varying root (requestFacts) is the solve responding to input — never reported.
    expect(findings.some((f) => f.detail.includes("requestFacts"))).toBe(false);
  });

  it("stays quiet when the inputs themselves are constant: constant output proves nothing", () => {
    expect(inputInsensitivity([constantPlan("t1", ["U01"]), constantPlan("t2", ["U01"])])).toEqual([]);
  });

  it("declines below two witnesses, and skips a root missing from any artifact", () => {
    expect(inputInsensitivity([constantPlan("t1", ["U01"])])).toEqual([]);
    const partial: Witness = {
      taskId: "t2",
      publicInput: { requestedItems: [{ requestId: "REQ-09" }] },
      artifact: { requestFacts: [] },
    };
    expect(inputInsensitivity([constantPlan("t1", ["U01"]), partial])).toEqual([]);
  });
});

const HARNESS = double<BuiltHarness>({ fingerprint: { taskSetHash: "tsh-1" } });

/** F2 as one row per witness, carrying its artifact; the status is the scenario's to choose. */
const probeOver = (witnesses: Witness[], status: "passed" | "failed" = "passed") =>
  probeReturning(
    witnesses.map((w) => ({
      taskId: w.taskId,
      status,
      artifact: w.artifact,
      ...keysIf(status === "failed", () => ({ error: "[engine] rejected on hidden-check" })),
    })),
  );

/** A slug tree carrying only what the census reads: the recorded bare task array. */
function slugWith(name: string, witnesses: Witness[]): string {
  const slugDir = join(SCRATCH, name, "slug");
  mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
  writeFileSync(
    join(slugDir, "correctness-model", "tasks.json"),
    JSON.stringify(
      witnesses.map((w) => ({
        taskId: w.taskId,
        family: "archive-allocation",
        publicInput: w.publicInput,
        hidden: [{ expect: "protected" }],
      })),
    ),
  );
  return slugDir;
}

async function runGate(name: string, witnesses: Witness[], status: "passed" | "failed" = "passed") {
  const dir = join(SCRATCH, name);
  const gate = makeSolvabilityCensusGate({}, probeOver(witnesses, status));
  const feedback = await gate(HARNESS, dir, slugWith(name, witnesses));
  return { feedback, evidence: JSON.parse(readFileSync(join(dir, "solvability.json"), "utf8")) };
}

describe("the input-insensitivity observation in the solvability gate", () => {
  it("returns no findings for derived answer roots", async () => {
    const honest = (taskId: string, shelf: number): Witness => ({
      taskId,
      publicInput: { catalogue: CATALOG },
      artifact: { selection: [{ recordId: "DOC-ALPHA", shelf }] },
    });
    const { feedback } = await runGate("clean", [honest("t1", 4), honest("t2", 7)]);
    expect(feedback).toEqual([]);
  });

  it("counts reference solves the per-task wall stopped, apart from rejected ones, without task ids", async () => {
    const honest = (taskId: string, shelf: number): Witness => ({
      taskId,
      publicInput: { catalogue: CATALOG, shelf },
      artifact: { selection: [{ recordId: "DOC-ALPHA", shelf }] },
    });
    const witnesses = [honest("t1", 4), honest("t2", 7)];
    const dir = join(SCRATCH, "timeouts");
    const probe = probeReturning([
      { taskId: "t1", status: "failed", artifact: null, error: "reference solve child exceeded 120000ms" },
      {
        taskId: "t2",
        status: "failed",
        artifact: null,
        error: "reference solve child exceeded the stdout cap; stderr=",
      },
    ]);
    const feedback = await makeSolvabilityCensusGate({}, probe)(
      HARNESS,
      dir,
      slugWith("timeouts", witnesses),
    );
    const detail = feedback[0]?.findings?.find((f) => f.code === "SOLVABILITY_CENSUS_BLOCKED")?.detail ?? "";
    expect(detail).toContain("2 of 2 reference solves failed");
    expect(detail).toContain("1 of those stopped at the per-task reference solve wall");
    expect(detail).not.toMatch(/\d+-second/);
    expect(detail).not.toContain("t1");
  });

  it("declines instead of throwing when the recorded task file is unreadable", async () => {
    const dir = join(SCRATCH, "notasks");
    mkdirSync(dir, { recursive: true });
    const gate = makeSolvabilityCensusGate({}, probeOver([absentAndCopied("t1")]));
    expect(await gate(HARNESS, dir, join(dir, "slug"))).toEqual([]);
  });

  /**
   * A reference solve that reads absent publicInput fields produces the same root for every task.
   * A failure count alone would not say which root; the refusal names it while withholding task ids
   * and verifier text.
   */
  it("reports constant reference output to the correctness-model author without task ids or verifier text", async () => {
    const witnesses = [constantPlan("t1", ["U01"]), constantPlan("t2", ["U01", "U02"])];
    const { feedback, evidence } = await runGate("insensitive", witnesses, "failed");
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({
      owner: "correctness-model/reference/index.ts",
      severity: "blocking",
    });
    expect(feedback[0]?.findings?.map((f) => f.code)).toEqual([
      "SOLVABILITY_CENSUS_BLOCKED",
      "REFERENCE_SOLVE_IGNORES_PUBLIC_INPUT",
    ]);
    const visible = JSON.stringify(feedback);
    expect(visible).toContain("allocationPlan");
    expect(visible).toContain("2 distinct public inputs");
    expect(visible).not.toContain("t1"); // no per-task localisation
    expect(visible).not.toContain("[engine]"); // no engine words
    expect(visible).not.toContain("hidden-check");
    // The full record persists host-side, protected, as before.
    expect(JSON.stringify(evidence)).toContain("hidden-check");
  });
});
