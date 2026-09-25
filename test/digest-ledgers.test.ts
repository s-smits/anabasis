import { expect, test } from "bun:test";
import {
  admissionLedgerLines,
  batteryTallies,
  checkInformativenessLines,
  familyCoverageLines,
  roleSpendLines,
} from "../.claude/skills/whole-run-investigation/scripts/digest-ledgers.mjs";
import { tmpdir } from "../src/meta/os.ts";
import { controllerRunOfBattery } from "../src/run/controller-battery-record-policy.ts";
import { join } from "../src/meta/path.ts";
import type { CaseRecordRow } from "../src/claim/case-record.ts";
import { EPOCH_REVIEW_SCHEMA } from "../src/review/epoch-review-findings.ts";
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

test("a turn retry is an explicit allowance wait on the provider's own clause alone, and censoring reads the typed kind", () => {
  const retry = (turn: number, reason: string, waitMs: number) => ({
    role: "builder",
    turn,
    attempt: 1,
    of: 3,
    status: "failed",
    reason,
    waitMs,
  });
  const file = "epoch-aa/builder-execution-02.json";
  const executions = {
    records: [
      {
        epoch: "epoch-aa",
        file: "builder-execution-02.json",
        record: {
          turnRetries: [
            retry(
              2,
              "Claude Code returned an error result: You've hit your limit · resets 9:10pm (Europe/Amsterdam)",
              300_000,
            ),
            // The controller's clause, not every sentence that mentions a limit or a credit.
            retry(3, "You've hit your limit while allocating task slots", 30_000),
            retry(4, "credit limit field missing from the invoice schema", 0),
          ],
        },
      },
    ],
    unavailable: [],
  };
  // A solver-typed non-result whose message carries the allowance clause, an unaccepted attempt
  // and a verified pass: no row is provider-typed, so the message censors nothing.
  const message = "You've hit your limit · resets 9:10pm (Europe/Amsterdam)";
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
    batteryOf: () => null,
    decisions: [],
    executions,
  };
  const lines = roleSpendLines(options).join("\n");
  expect(lines).toContain(`${file}: turn retries 3 · waited 5.5 min in total`);
  expect(lines).toContain(
    `  EXPLICIT ALLOWANCE WAIT (lane 24): ${file} turn 2 attempt 1/3 failed waited 5 min (explicit allowance)`,
  );
  expect(lines).toContain(
    `  turn retry: ${file} turn 3 attempt 1/3 failed waited 0.5 min (other reason; not proof of exhaustion)`,
  );
  expect(lines).toContain(
    `  turn retry: ${file} turn 4 attempt 1/3 failed waited 0 min (other reason; not proof of exhaustion)`,
  );
  expect(lines.split("EXPLICIT ALLOWANCE WAIT").length).toBe(2);
  expect(tallies[0]).toMatchObject({ verified: 1, unaccepted: 1, nonResults: 1, providerNonResult: 0 });
  expect(lines).toContain(
    "no provider-typed non-results in the case rows; missing rows leave censoring unobservable",
  );
  expect(lines).not.toContain("CENSORED");
  // A provider-typed row censors its battery; without the battery record the instants stay unknown,
  // and a decision that read the battery is named.
  const censored = roleSpendLines({
    ...options,
    tallies: batteryTallies([caseRecordRow("t1", "f", { runId: "run", ...providerNonResult })]),
    decisions: [{ runId: "next", action: "placed", evidenceRunIds: ["run"] }],
  }).join("\n");
  expect(censored).toContain(
    "run: graded 0 · provider non-results 1 · first ? last ? · CENSORED (provider non-results; the typed kind is the evidence, the message is not)",
  );
  expect(censored).toContain("DECISION ON CENSORED BATTERY (lane 24): next placed read run");
});

test("an epoch review counts a finding unrouted only when the author router gives it no owner", async () => {
  const campaign = join(tmpdir(), `digest-ledgers-${crypto.randomUUID()}`);
  const finding = (kind: string, proposedOwner: string | null) => ({ kind, proposedOwner });
  await Bun.write(
    join(campaign, "analysis", "authoring-a-epoch-review.json"),
    JSON.stringify({
      schema: EPOCH_REVIEW_SCHEMA,
      status: "completed",
      findings: [
        finding("curriculum-defect", null),
        finding("harness-defect", null),
        finding("harness-defect", "brief"),
      ],
      reads: [],
    }),
  );
  // A curriculum finding names no owner and still routes, to `tests`, so it is not unrouted.
  expect(admissionLedgerLines({ campaign }).join("\n")).toContain(
    "authoring-a: epoch review completed · findings 3 · unrouted 1 · reads 0",
  );
  // A review of another schema is refused by name rather than read for its findings.
  await Bun.write(
    join(campaign, "analysis", "run-b-epoch-review.json"),
    JSON.stringify({ status: "completed", findings: [finding("harness-defect", null)], reads: [] }),
  );
  const refused = admissionLedgerLines({ campaign }).join("\n");
  expect(refused).toContain(`run-b: epoch review refused, not ${EPOCH_REVIEW_SCHEMA}`);
  expect(refused).not.toContain("run-b: epoch review completed");
});

test("the served-model row opens the controller run a battery belongs to", () => {
  expect(controllerRunOfBattery("run-a-i02")).toBe("run-a");
  expect(controllerRunOfBattery("run-a")).toBe("run-a");
  // Only a suffix an iteration could have written names a round: -i1 is round one's own id, and a
  // selector that merely ends in -i<digits> is not a round.
  expect(controllerRunOfBattery("run-a-i1")).toBe("run-a-i1");
  expect(controllerRunOfBattery("mast-i2x")).toBe("mast-i2x");
});
