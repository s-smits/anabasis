import { expect, test } from "bun:test";
import {
  admissionLedgerLines,
  batteryTallies,
  checkInformativenessLines,
  exhaustionClass,
  familyCoverageLines,
  roleSpendLines,
} from "../.claude/skills/whole-run-investigation/scripts/digest-ledgers.mjs";
import { tmpdir } from "../src/meta/os.ts";
import { controllerRunOfBattery } from "../src/run/controller-battery-record-policy.ts";
import { join } from "../src/meta/path.ts";
import type { CaseRecordRow } from "../src/claim/case-record.ts";
import { caseRecordRow } from "./helpers/case-record-row.ts";

const unaccepted: Partial<CaseRecordRow> = { acceptedSubmit: false, truthOk: null, pass: false };
const providerNonResult: Partial<CaseRecordRow> = {
  acceptedSubmit: false,
  truthOk: null,
  pass: null,
  runtimeNonResult: "provider stopped",
  runtimeNonResultKind: "provider",
};

test("join targets are declared IDs, not Boolean flags", () => {
  const lines = checkInformativenessLines({
    checks: [{ id: "geometry" }],
    rejectRows: ["join-a", "join-b", "join-c", true, "", null].map((targetsJoin) => ({
      expectedCheckId: "geometry",
      targetsJoin,
    })),
    perCheck: new Map(),
    gradedOracleFiles: 0,
    tallies: [],
    decisions: [],
  }).join("\n");
  expect(lines).toMatch(/geometry\s+reach-only\s+6\s+0\s+3\s+0/);
});

test("family coverage retains partially and entirely unmeasured batteries", () => {
  const tallies = batteryTallies([
    caseRecordRow("t1", "measured", { runId: "partial" }),
    caseRecordRow("t2", "censored", { runId: "partial", ...providerNonResult }),
    caseRecordRow("t3", "unaccepted", { runId: "partial", ...unaccepted }),
    caseRecordRow("t1", "censored", { runId: "empty", ...providerNonResult }),
  ]);
  const lines = familyCoverageLines({ tallies }).join("\n");
  expect(lines).toMatch(/measured\s+1\/1.*all-pass/);
  expect(lines).toMatch(/censored\s+no verified evidence · unaccepted 0 · non-results 1/);
  expect(lines).toMatch(/unaccepted\s+no verified evidence · unaccepted 1 · non-results 0/);
  expect(lines).toContain("empty: 0/0 [-,-]");
  expect(lines).toContain("UNOBSERVED FAMILIES: 3");
  expect(lines).not.toContain("no family hidden");
  expect(familyCoverageLines({ tallies: [] })).toContain("no case rows");
});

test("explicit allowance errors reveal old misclassification without rewriting accepted outcomes", () => {
  const message =
    "Claude Code returned an error result: You've hit your limit · resets 9:10pm (Europe/Amsterdam)";
  expect(exhaustionClass(message)).toBe("explicit-exhaustion");
  expect(exhaustionClass("You've hit your session limit")).toBe("explicit-exhaustion");
  expect(exhaustionClass("429 too many requests")).toBe("generic-limit");
  expect(exhaustionClass("You've hit your limit while allocating task slots")).toBe("other");
  // The controller's clause, not every sentence that mentions money or a budget: a solver writing
  // about a credit field or a quota table has exhausted nothing.
  expect(exhaustionClass("credit limit field missing from the invoice schema")).toBe("other");
  expect(exhaustionClass("quota table exhausted its rows")).toBe("other");
  const cases = [
    {
      runId: "run",
      acceptedSubmit: false,
      truthOk: null,
      runtimeNonResultKind: "solver",
      solver: { errors: [message] },
    },
    {
      runId: "run",
      acceptedSubmit: false,
      truthOk: null,
      runtimeNonResultKind: null,
      solver: { errors: [message] },
    },
    {
      runId: "run",
      acceptedSubmit: true,
      truthOk: true,
      runtimeNonResultKind: null,
      solver: { errors: [message] },
    },
  ];
  // The case rows in the writer's shapes, beside the battery cases whose solver errors carry the
  // limit message: a non-result the solver owns, an unaccepted attempt and a verified pass.
  const tallies = batteryTallies([
    caseRecordRow("t1", "f", {
      runId: "run",
      acceptedSubmit: false,
      truthOk: null,
      pass: null,
      runtimeNonResult: message,
      runtimeNonResultKind: "solver",
    }),
    caseRecordRow("t2", "f", { runId: "run", ...unaccepted }),
    caseRecordRow("t3", "f", { runId: "run" }),
  ]);
  const options = {
    campaign: "/nonexistent-digest-fixture",
    tallies,
    batteryOf: () => ({ cases }),
    decisions: [],
  };
  const lines = roleSpendLines(options).join("\n");
  expect(lines).toContain("provider non-results 0 (explicit-exhaustion 2)");
  expect(lines).toContain(
    "explicit exhaustion outside provider classification: 2 · recorded grades unchanged",
  );
  expect(tallies[0]).toMatchObject({ verified: 1, unaccepted: 1, nonResults: 1, providerNonResult: 0 });
  expect(roleSpendLines({ ...options, batteryOf: () => null }).join("\n")).toContain(
    "missing rows leave censoring unobservable",
  );
});

test("an epoch review counts a finding unrouted only when the author router gives it no owner", async () => {
  const campaign = join(tmpdir(), `digest-ledgers-${crypto.randomUUID()}`);
  const finding = (kind: string, proposedOwner: string | null) => ({ kind, proposedOwner });
  await Bun.write(
    join(campaign, "analysis", "authoring-a-epoch-review.json"),
    JSON.stringify({
      status: "completed",
      findings: [
        finding("curriculum-defect", null),
        finding("harness-defect", null),
        finding("harness-defect", "brief"),
      ],
      reads: [],
    }),
  );
  // Truss run fa03b7 read its one curriculum finding as unowned, though it routes to `tests`.
  expect(admissionLedgerLines({ campaign }).join("\n")).toContain("findings 3 · unrouted 1 · reads 0");
});

test("the served-model row opens the controller run a battery belongs to", () => {
  expect(controllerRunOfBattery("run-a-i02")).toBe("run-a");
  expect(controllerRunOfBattery("run-a")).toBe("run-a");
  // Only a suffix an iteration could have written names a round: -i1 is round one's own id, and a
  // selector that merely ends in -i<digits> is not a round.
  expect(controllerRunOfBattery("run-a-i1")).toBe("run-a-i1");
  expect(controllerRunOfBattery("mast-i2x")).toBe("mast-i2x");
});
