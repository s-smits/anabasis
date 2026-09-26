/**
 * The gate's refusal codes, read against what the Builder is told. A code that refuses is named
 * under Gates in STARTER.md, so a refusal never reaches the author as a code it was never told
 * about.
 */
import { describe, expect, it } from "bun:test";

import { readFileSync } from "../src/meta/filesystem.ts";
import {
  controlDecisionFindings,
  DISCRIMINATION_CHECK_UNREJECTED,
  DISCRIMINATION_REJECT_PASSED,
  timedOutControls,
} from "../src/truth/control-receipts.ts";
import { EXTERNAL_VERDICT_UNGROUNDED } from "../src/truth/tool-runs.ts";
import { validateBrief } from "../src/truth/brief-validator.ts";
import { MATCHING_BRIEF } from "./helpers/matching-fixture.ts";
import { required } from "./helpers/doubles.ts";
import type { ControlReceipt } from "../src/truth/battery-record.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const STARTER = readFileSync(new URL("../starters/pi-built-harness/STARTER.md", import.meta.url), "utf8");

describe("gate decisions", () => {
  // A code the Builder is told about and no source emits sends it looking for a refusal that no
  // longer exists, which is the told half of the registry drifting from the refusing half.
  it("names under Gates only codes some source file still emits", () => {
    const gates = STARTER.slice(STARTER.indexOf("## Gates"));
    const told = [...gates.matchAll(/^- `([\w-]+)`/gm)].map((match) => required(match[1], "told code"));
    const source = new Bun.Glob("src/**/*.ts");
    const emitted = [...source.scanSync({ cwd: ROOT })]
      .map((path) => readFileSync(`${ROOT}/${path}`, "utf8"))
      .join("\n");
    expect(told.length).toBeGreaterThan(10);
    expect(told.filter((code) => !emitted.includes(`"${code}"`))).toEqual([]);
  });

  it.each([
    EXTERNAL_VERDICT_UNGROUNDED,
    DISCRIMINATION_REJECT_PASSED,
    DISCRIMINATION_CHECK_UNREJECTED,
    "brief-artifact-root-unread",
    "brief-cited-decision-withheld",
  ])("tells the Builder %s under Gates", (code) => {
    const gates = STARTER.slice(STARTER.indexOf("## Gates"));
    expect(gates).toContain(`\`${code}\``);
  });
});

function reject(controlId: string, expectedCheckId: string, blocking: string[]): ControlReceipt {
  return {
    schema: "control-receipt/v2",
    controlId,
    taskId: "t1",
    kind: "reject",
    expectedOutcome: "fail",
    expectedCheckId,
    observedOutcome: blocking.length > 0 ? "fail" : "pass",
    observedBlockingCheckIds: blocking,
    nonResultKind: null,
  };
}

describe("R2, every check can say no", () => {
  it("clears a corpus where every check has a reject that failed on it", () => {
    expect(
      controlDecisionFindings(["a", "b"], [reject("r1", "a", ["a", "b"]), reject("r2", "b", ["b"])]),
    ).toEqual([]);
  });

  it("refuses a reject that passed, or failed only elsewhere, and a check no reject names", () => {
    const findings = controlDecisionFindings(
      ["a", "b", "c", "d"],
      [reject("r1", "a", []), reject("r2", "b", ["a"])],
    );
    expect(findings.map((row) => [row.code, row.message])).toEqual([
      [
        "DISCRIMINATION_REJECT_PASSED",
        '2 invalid examples did not fail the check their expectedCheckId names: "r1", "r2"',
      ],
      [
        "DISCRIMINATION_CHECK_UNREJECTED",
        'no reject that reached a verdict names checks "c", "d" as its expectedCheckId',
      ],
    ]);
  });

  // A count of one reads as one, not as a hedged plural.
  it("names a single missed reject and a single unrejected check in the singular", () => {
    const findings = controlDecisionFindings(
      ["a", "b", "c"],
      [reject("r1", "a", []), reject("r2", "b", ["b"])],
    );
    expect(findings.map((row) => row.message)).toEqual([
      '1 invalid example did not fail the check its expectedCheckId names: "r1"',
      'no reject that reached a verdict names check "c" as its expectedCheckId',
    ]);
  });

  const noVerdict: ControlReceipt = {
    ...reject("r1", "a", []),
    observedOutcome: "non-result",
    nonResultKind: "timeout",
  };

  it("counts a reject that reached no verdict as neither a miss nor a witness", () => {
    expect(controlDecisionFindings(["a"], [noVerdict]).map((row) => row.code)).toEqual([
      "DISCRIMINATION_CHECK_UNREJECTED",
    ]);
  });

  // The environment's refusal holds the claim open on its own row; (b) adds no author row to it.
  it("counts a reject the host refused to run as naming its check", () => {
    const refused: ControlReceipt = { ...noVerdict, nonResultKind: "sandbox" };
    expect(controlDecisionFindings(["a"], [refused])).toEqual([]);
  });

  it("clears a check whose timed-out reject has a sibling that reached a verdict", () => {
    expect(controlDecisionFindings(["a"], [noVerdict, reject("r2", "a", ["a"])])).toEqual([]);
  });
});

describe("CT-3, a timed-out example is read, not refused", () => {
  const row = (subjectId: string, outcome: "timeout" | "executed", durationMs: number, toolId = "cc") => ({
    phase: "discrimination" as const,
    subjectId,
    attempt: 1,
    toolId,
    durationMs,
    outcome,
  });

  it("names each timed-out example beside its tool and how long it ran", () => {
    const settled = new Map([
      ["a1", { attempt: 1, hostNonResult: "timeout" }],
      ["a2", { attempt: 1, hostNonResult: "timeout" }],
      ["a3", { attempt: 1, hostNonResult: null }],
      ["a4", { attempt: 1, hostNonResult: "crash" }],
    ]);
    const evidence = [row("a1", "timeout", 30_060), row("a2", "timeout", 30_100), row("a3", "executed", 900)];
    const readout = timedOutControls(settled, evidence, "correctness-model/evaluator.ts");
    expect(readout.map((finding) => [finding.code, finding.detail])).toEqual([
      [
        "controls-tool-timeout",
        'tool "cc" hit its time limit on 2 examples: "a1" after 30.1 s, "a2" after 30.1 s. Those examples reached no verdict, which refuses nothing here; if the tool needs longer, raise the run\'s timeoutMs or the tool-run wall in agent/config.yaml',
      ],
    ]);
  });

  // A crash, and a timeout row from another phase or attempt, are not this readout's.
  it("reads one example in the singular and ignores rows of another phase", () => {
    const settled = new Map([["a1", { attempt: 2, hostNonResult: "timeout" }]]);
    const evidence = [
      { ...row("a1", "timeout", 5_000, "other"), attempt: 1 },
      { ...row("a1", "timeout", 5_000, "other"), phase: "solvability" as const, attempt: 2 },
      { ...row("a1", "timeout", 12_000), attempt: 2 },
    ];
    expect(timedOutControls(settled, evidence, "p").map((finding) => finding.detail)).toEqual([
      'tool "cc" hit its time limit on 1 example: "a1" after 12.0 s. That example reached no verdict, which refuses nothing here; if the tool needs longer, raise the run\'s timeoutMs or the tool-run wall in agent/config.yaml',
    ]);
  });
});

describe("R3, declared means graded", () => {
  const codes = (change: (brief: typeof MATCHING_BRIEF) => void) => {
    const brief = structuredClone(MATCHING_BRIEF);
    change(brief);
    return validateBrief(brief).findings.map((row) => [row.code, row.path]);
  };

  it("clears a brief whose every root is read and every citation public", () => {
    expect(codes(() => {})).toEqual([]);
  });

  it("refuses a root no check reads, unless a check reads the whole artifact", () => {
    const extraRoot = (brief: typeof MATCHING_BRIEF) =>
      brief.artifactSchema.push({ name: "notes", "shape": "free text" });
    expect(codes(extraRoot)).toEqual([["brief-artifact-root-unread", "artifactSchema[1].name"]]);
    expect(
      codes((brief) => {
        extraRoot(brief);
        required(brief.truthChecks[0], "first check").execution.artifactPaths = ["$"];
      }),
    ).toEqual([]);
  });

  it("refuses a check citing only private rows, or a row no one declared, naming the id and not the statement", () => {
    const privateRow = structuredClone(MATCHING_BRIEF);
    const rule = required(privateRow.ruleDecisions?.[0], "public rule");
    rule.visibility = "private";
    const found = validateBrief(privateRow).findings;
    expect(found.map((row) => row.code)).toContain("brief-cited-decision-withheld");
    expect(found[0]?.detail).toContain("binding-completeness");
    expect(found[0]?.detail).not.toContain(rule.statement);
    expect(codes((brief) => (brief.ruleDecisions = []))).toContainEqual([
      "brief-cited-decision-withheld",
      "truthChecks[0].citedDecisionIds",
    ]);
  });

  it("admits a private construction note cited beside a public rule", () => {
    expect(
      codes((brief) => {
        const rule = required(brief.ruleDecisions?.[0], "public rule");
        brief.ruleDecisions?.push({ ...rule, id: "construction", visibility: "private" });
        required(brief.truthChecks[0], "first check").citedDecisionIds?.push("construction");
      }),
    ).toEqual([]);
  });
});
