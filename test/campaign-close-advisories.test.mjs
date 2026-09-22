import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import {
  adjudicatePrediction,
  freezePrediction,
  ledgerPath,
} from "../.claude/skills/run-improvement-campaign/scripts/prediction.mjs";
import {
  buildAdvisories,
  claimClauses,
  readCampaign,
} from "../.claude/skills/run-improvement-campaign/scripts/close-advisories.mjs";

const BUDGET_LIMITED_TERMINAL = {
  outcome: "aborted",
  abortClause: "budget-limited",
  denominator: { total: 275, verified: 271, unaccepted: 3, nonResults: 1 },
  providerResourceBudget: { cap: 660, used: 660, byRole: { builder: 9, built: 300, review: 351 } },
};

/** @param {{ terminal?: Record<string, unknown> | null, opening?: Record<string, unknown> | null,
 *            claims?: Record<string, unknown>[], promotions?: Record<string, unknown>[] }} [written] */
function campaign({ terminal = null, opening = null, claims = [], promotions = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "close-"));
  const runDir = join(root, "controller", "fullrun-20260827-child11");
  mkdirSync(runDir, { recursive: true });
  if (opening !== null) writeFileSync(join(runDir, "opening.json"), JSON.stringify(opening));
  if (terminal !== null) writeFileSync(join(runDir, "terminal.json"), JSON.stringify(terminal));
  mkdirSync(join(root, "claims"), { recursive: true });
  claims.forEach((claim, index) =>
    writeFileSync(join(root, "claims", `claim-${index}.json`), JSON.stringify(claim)),
  );
  mkdirSync(join(root, "promotions"), { recursive: true });
  promotions.forEach((row, index) =>
    writeFileSync(join(root, "promotions", `p-${index}.json`), JSON.stringify(row)),
  );
  return root;
}

function codes(advisories) {
  return advisories.map((row) => row.code);
}

describe("terminal reading", () => {
  it("treats a budget-limited abort as a valid closed terminal (the predecessor threw on it)", () => {
    const evidence = readCampaign(campaign({ terminal: BUDGET_LIMITED_TERMINAL }), null);
    const advisories = buildAdvisories(evidence);
    const terminal = advisories.find((row) => row.code === "terminal");
    expect(terminal.level).toBe("info");
    expect(terminal.text).toContain("valid closed terminal");
  });

  it("holds an opening-only run as open, never complete", () => {
    const evidence = readCampaign(campaign({ opening: { source: { commit: "e".repeat(40) } } }), null);
    const advisories = buildAdvisories(evidence);
    expect(advisories).toHaveLength(1);
    expect(advisories[0].level).toBe("hold");
    expect(advisories[0].text).toContain("open or interrupted");
  });

  it("records an unreadable terminal instead of inventing one", () => {
    const root = campaign({});
    writeFileSync(join(root, "controller", "fullrun-20260827-child11", "terminal.json"), "{not json");
    const evidence = readCampaign(root, null);
    expect(evidence.errors.length).toBe(1);
    expect(codes(buildAdvisories(evidence))).toContain("unreadable");
  });
});

describe("claims and denominators", () => {
  it("names an absent or invalid denominator instead of printing undefined counts", () => {
    const absent = { ...BUDGET_LIMITED_TERMINAL, denominator: { state: "absent" } };
    const absentRow = buildAdvisories(readCampaign(campaign({ terminal: absent }), null)).find(
      (row) => row.code === "denominators",
    );
    expect(absentRow.text).toBe("no battery was admitted: no case denominator");
    expect(absentRow.text).not.toContain("undefined");
    const invalid = {
      ...BUDGET_LIMITED_TERMINAL,
      denominator: { state: "invalid", error: "case-record unreadable" },
    };
    const invalidRow = buildAdvisories(readCampaign(campaign({ terminal: invalid }), null)).find(
      (row) => row.code === "denominators",
    );
    expect(invalidRow.level).toBe("hold");
    expect(invalidRow.text).toContain("case-record unreadable");
  });

  it("advises claims-refused with the union of clauses when every claim is refused", () => {
    const claims = [
      { claim: { ok: false, clauses: ["runtime-model-identity-unproven"] } },
      {
        claim: {
          ok: false,
          clauses: [{ clause: "artifact-schema-defect" }, { clause: "runtime-model-identity-unproven" }],
        },
      },
    ];
    const evidence = readCampaign(campaign({ terminal: BUDGET_LIMITED_TERMINAL, claims }), null);
    const advisory = buildAdvisories(evidence).find((row) => row.code === "claims-refused");
    expect(advisory.level).toBe("advice");
    expect(advisory.text).toContain("artifact-schema-defect, runtime-model-identity-unproven");
  });

  it("reports zero verified cases as an evidence gap", () => {
    const terminal = {
      ...BUDGET_LIMITED_TERMINAL,
      denominator: { total: 25, verified: 0, unaccepted: 0, nonResults: 25 },
    };
    const evidence = readCampaign(campaign({ terminal }), null);
    expect(codes(buildAdvisories(evidence))).toContain("zero-verified");
  });

  it("tolerates malformed clause rows", () => {
    expect(claimClauses({ claim: { clauses: ["a", { clause: "b" }, 7, null] } })).toEqual(["a", "b"]);
    expect(claimClauses({ claim: {} })).toEqual([]);
  });
});

describe("held promotions and review economics", () => {
  const HELD = {
    decision: "held",
    experiment: "build",
    clauses: ["candidate-zero-verified: the candidate's battery verified no case"],
  };

  it("names the clauses a held promotion carries", () => {
    const evidence = readCampaign(campaign({ terminal: BUDGET_LIMITED_TERMINAL, promotions: [HELD] }), null);
    const advisory = buildAdvisories(evidence).find((row) => row.code === "promotion-held");
    expect(advisory.level).toBe("advice");
    expect(advisory.text).toContain("candidate-zero-verified");
    expect(advisory.text).toContain("its own admitted battery");
  });

  it("stays quiet when every promotion was settled", () => {
    const promoted = { decision: "promoted", experiment: "build", clauses: [] };
    const evidence = readCampaign(
      campaign({ terminal: BUDGET_LIMITED_TERMINAL, promotions: [promoted] }),
      null,
    );
    expect(codes(buildAdvisories(evidence))).not.toContain("promotion-held");
  });

  it("flags a review share above 40% with the measured yield", () => {
    const evidence = readCampaign(campaign({ terminal: BUDGET_LIMITED_TERMINAL }), null);
    const advisory = buildAdvisories(evidence).find((row) => row.code === "review-share");
    expect(advisory.text).toContain("351/660");
    expect(advisory.text).toContain("2 of 351");
  });

  it("stays quiet about review share at 30%", () => {
    const terminal = {
      ...BUDGET_LIMITED_TERMINAL,
      providerResourceBudget: { cap: 660, used: 660, byRole: { review: 198 } },
    };
    const evidence = readCampaign(campaign({ terminal }), null);
    expect(codes(buildAdvisories(evidence))).not.toContain("review-share");
  });
});

describe("run discovery, safeguards and predictions", () => {
  it("finds a run whose directory name is not fullrun-* and reads its fired safeguards and open predictions", () => {
    const root = campaign({ terminal: BUDGET_LIMITED_TERMINAL });
    const runDir = join(root, "controller", "run53-sol-0903");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "opening.json"), JSON.stringify({ source: { commit: "f".repeat(40) } }));
    writeFileSync(join(runDir, "terminal.json"), JSON.stringify(BUDGET_LIMITED_TERMINAL));
    mkdirSync(join(root, "safeguards", "run53-sol-0903"), { recursive: true });
    writeFileSync(
      join(root, "safeguards", "run53-sol-0903", "SAFEGUARDS_LOG.txt"),
      "t | 25-firing-ledger-external-only | a\nt | 25-firing-ledger-external-only | b\n",
    );
    // Freeze through the documented producer, then close through the real reader: the two must meet
    // on one path. They did not until 2026-09-18, and a run closed clean over unadjudicated rows.
    const predictions = mkdtempSync(join(tmpdir(), "predictions-"));
    const mine = freezePrediction(
      ledgerPath("run53-sol-0903", predictions),
      {
        run: "run53-sol-0903",
        claim: "c",
        movedVariable: "m",
        direction: "up",
        falsifier: "f",
        source: "abcdef1",
      },
      "2026-09-18T00:00:00Z",
    );
    const elsewhere = freezePrediction(
      ledgerPath("other-run", predictions),
      {
        run: "other-run",
        claim: "c",
        movedVariable: "m",
        direction: "up",
        falsifier: "f",
        source: "abcdef1",
      },
      "2026-09-18T00:00:00Z",
    );
    const evidence = readCampaign(root, "run53-sol-0903", predictions);
    expect(evidence.run).toBe("run53-sol-0903");
    const advisories = buildAdvisories(evidence);
    expect(advisories.find((row) => row.code === "safeguards").text).toContain(
      "25-firing-ledger-external-only x2",
    );
    const open = advisories.find((row) => row.code === "predictions-open");
    expect(open.level).toBe("hold");
    expect(open.text).toContain(mine.id);
    expect(open.text).not.toContain(elsewhere.id);
    // Adjudicating that exact row, and only it, releases the hold.
    adjudicatePrediction(
      ledgerPath("run53-sol-0903", predictions),
      mine.id,
      "refuted",
      "case-record.jsonl: 0 verified",
      "2026-09-18T01:00:00Z",
    );
    expect(codes(buildAdvisories(readCampaign(root, "run53-sol-0903", predictions)))).not.toContain(
      "predictions-open",
    );
  });

  it("holds a zero-case terminal on its unadjudicated row, so a battery that scored nothing still owes its answer", () => {
    const root = campaign({
      terminal: {
        outcome: "stopped",
        abortClause: null,
        denominator: { total: 0, verified: 0, unaccepted: 0, nonResults: 0 },
      },
    });
    const predictions = mkdtempSync(join(tmpdir(), "predictions-"));
    freezePrediction(
      ledgerPath("fullrun-20260827-child11", predictions),
      {
        claim: "the harder battery verifies 5 to 12 of 25",
        movedVariable: "task families",
        direction: "down",
        falsifier: "0 verified cases",
        source: "abcdef1",
        run: null,
      },
      "2026-09-18T00:00:00Z",
    );
    const hold = buildAdvisories(readCampaign(root, null, predictions)).find(
      (row) => row.code === "predictions-open",
    );
    expect(hold.level).toBe("hold");
    expect(hold.text).toContain("1 frozen prediction(s) not yet adjudicated");
  });

  it("stays silent on both when nothing fired and every prediction is adjudicated", () => {
    const root = campaign({ terminal: BUDGET_LIMITED_TERMINAL });
    const predictions = mkdtempSync(join(tmpdir(), "predictions-"));
    const row = freezePrediction(
      ledgerPath("fullrun-20260827-child11", predictions),
      { claim: "c", movedVariable: "m", direction: "up", falsifier: "f", source: "abcdef1", run: null },
      "2026-09-18T00:00:00Z",
    );
    adjudicatePrediction(
      ledgerPath("fullrun-20260827-child11", predictions),
      row.id,
      "refuted",
      "e",
      "2026-09-18T01:00:00Z",
    );
    const advisories = buildAdvisories(readCampaign(root, null, predictions));
    expect(codes(advisories)).not.toContain("safeguards");
    expect(codes(advisories)).not.toContain("predictions-open");
  });
});
