import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import {
  adjudicatePrediction,
  freezePrediction,
  ledgerView,
  predictionId,
} from "../.claude/skills/run-improvement-campaign/scripts/prediction.mjs";

const CORE = {
  claim: "the rebuilt correctness model raises verified passes",
  movedVariable: "instructions owner guide",
  direction: "up",
  falsifier: "verified passes do not rise on the next battery",
  source: "e11b85195",
  run: null,
};

function ledger() {
  return join(mkdtempSync(join(tmpdir(), "prediction-")), "predictions.jsonl");
}

describe("freeze", () => {
  it("freezes once and lists the row as open", () => {
    const path = ledger();
    const row = freezePrediction(path, CORE, "2026-08-27T10:00:00Z");
    expect(row.id).toBe(predictionId(CORE));
    const view = ledgerView(path);
    expect(view).toHaveLength(1);
    expect(view[0].outcome).toBe("open");
  });

  it("makes the ledger's directory, which a clean clone does not have", () => {
    const path = join(mkdtempSync(join(tmpdir(), "prediction-")), "notes", "predictions", "run.jsonl");
    freezePrediction(path, CORE, "2026-08-27T10:00:00Z");
    expect(ledgerView(path)).toHaveLength(1);
  });

  it("refuses freezing the identical claim twice", () => {
    const path = ledger();
    freezePrediction(path, CORE, "2026-08-27T10:00:00Z");
    expect(() => freezePrediction(path, CORE, "2026-08-27T10:01:00Z")).toThrow("already frozen");
  });

  it("refuses a bad direction and a non-hex source", () => {
    const path = ledger();
    expect(() => freezePrediction(path, { ...CORE, direction: "sideways" }, "t")).toThrow("direction");
    expect(() => freezePrediction(path, { ...CORE, source: "main" }, "t")).toThrow("commit hex");
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
    expect(ledgerView(path)[0].outcome).toBe("refuted");
    expect(() => adjudicatePrediction(path, id, "sufficed", "second thoughts", "t")).toThrow("append-only");
  });

  it("refuses an unknown id and an unknown outcome", () => {
    const path = ledger();
    const { id } = freezePrediction(path, CORE, "2026-08-27T10:00:00Z");
    expect(() => adjudicatePrediction(path, "feedfeedfeedfeed", "refuted", "e", "t")).toThrow(
      "no frozen prediction",
    );
    expect(() => adjudicatePrediction(path, id, "maybe", "e", "t")).toThrow("outcome");
  });
});
