import { describe, expect, it } from "bun:test";
import {
  adjudicatePrediction,
  freezePrediction,
  ledgerView,
  type PredictionCore,
  predictionId,
} from "../.claude/skills/run-improvement-campaign/scripts/prediction.ts";
import { appendFileSync, mkdtempSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const CORE: PredictionCore = {
  claim: "the rebuilt correctness model raises verified passes",
  movedVariable: "instructions owner guide",
  direction: "up",
  falsifier: "verified passes do not rise on the next battery",
  source: "e11b85195",
  run: null,
};

const ledger = (): string =>
  join(mkdtempSync(join(tmpdir(), "prediction-")), "notes", "predictions", "run.jsonl");

describe("freeze", () => {
  it("freezes once, making the ledger's directory, and lists the row as open", () => {
    const path = ledger();
    expect(freezePrediction(path, CORE, "2026-08-27T10:00:00Z").id).toBe(predictionId(CORE));
    expect(ledgerView(path).map((row) => row.outcome)).toEqual(["open"]);
    expect(() => freezePrediction(path, CORE, "2026-08-27T10:01:00Z")).toThrow("already frozen");
  });

  it("refuses a bad direction and a non-hex source", () => {
    const path = ledger();
    expect(() => freezePrediction(path, { ...CORE, direction: "sideways" }, "t")).toThrow("direction");
    expect(() => freezePrediction(path, { ...CORE, source: "main" }, "t")).toThrow("commit hex");
  });

  it("refuses a ledger row it cannot read, rather than dropping an open prediction", () => {
    const path = ledger();
    freezePrediction(path, CORE, "t");
    appendFileSync(path, `${JSON.stringify({ type: "frozen" })}\n`);
    expect(() => ledgerView(path)).toThrow(":2: ledger row lacks");
  });
});

describe("adjudicate", () => {
  it("adjudicates a frozen prediction exactly once", () => {
    const path = ledger();
    const { id } = freezePrediction(path, CORE, "2026-08-27T10:00:00Z");
    adjudicatePrediction(
      path,
      id,
      "refuted",
      "next battery 24/25 against the prior 24/25",
      "2026-08-27T12:00:00Z",
    );
    expect(ledgerView(path)[0]).toMatchObject({ outcome: "refuted", adjudicatedAt: "2026-08-27T12:00:00Z" });
    expect(() => adjudicatePrediction(path, id, "sufficed", "second thoughts", "t")).toThrow("append-only");
  });

  it("refuses an unknown id and an outcome outside the four AGENTS.md names", () => {
    const path = ledger();
    const { id } = freezePrediction(path, CORE, "2026-08-27T10:00:00Z");
    expect(() => adjudicatePrediction(path, "feedfeedfeedfeed", "refuted", "e", "t")).toThrow(
      "no frozen prediction",
    );
    expect(() => adjudicatePrediction(path, id, "inconclusive", "e", "t")).toThrow("outcome");
  });
});
