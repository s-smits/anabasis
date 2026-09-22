import { expect, test } from "bun:test";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { batteryTallies, checkInformativenessLines, exhaustionClass, familyCoverageLines, roleSpendLines } from "../.claude/skills/whole-run-investigation/scripts/digest-ledgers.mjs";

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
  const row = (
    runId: string,
    family: string,
    acceptedSubmit: boolean,
    truthOk: boolean | null,
    runtimeNonResultKind: string | null = null,
  ) => ({ runId, family, acceptedSubmit, truthOk, runtimeNonResultKind });
  const tallies = batteryTallies([
    row("partial", "measured", true, true),
    row("partial", "censored", false, null, "provider"),
    row("partial", "unaccepted", false, null),
    row("empty", "censored", false, null, "provider"),
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
  const tallies = batteryTallies(cases);
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
  expect(tallies[0]).toMatchObject({ graded: 1, unaccepted: 1, nonResult: 1, providerNonResult: 0 });
  expect(roleSpendLines({ ...options, batteryOf: () => null }).join("\n")).toContain(
    "missing rows leave censoring unobservable",
  );
});
