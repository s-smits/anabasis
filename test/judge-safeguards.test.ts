/**
 * The three Judge safeguards that replaced the control census on 2026-09-14. Each is a pure
 * predicate over the recorded review plus one emit; the log line proves the emit, the negative
 * cases prove they stay quiet on the ordinary shapes.
 */
import { mkdtempSync, readFileSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import {
  type JudgeAdviceFacts,
  type JudgeReviewFacts,
  atFormerBlockThreshold,
  judgePassedEveryReviewedCase,
  safeguardJudgeAdviceThenEvaluatorRepair,
  safeguardJudgeReview,
} from "../src/analyse/judge-safeguards.ts";
import type { JudgeReviewsResult } from "../src/analyse/judge-reviews.ts";
import { SAFEGUARDS_LOG_FILE, createSafeguardContext } from "../src/meta/safeguard.ts";

const scratch: string[] = [];
type Exit = JudgeReviewsResult["exit"];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function logDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "judge-safeguards-"));
  scratch.push(dir);
  return dir;
}

function readLog(dir: string): string {
  try {
    return readFileSync(join(dir, SAFEGUARDS_LOG_FILE), "utf8");
  } catch {
    return "";
  }
}

function exit(verifierFailJudgePass: number, verifierPassJudgeFail: number, verified: number): Exit {
  const contested = verifierFailJudgePass + verifierPassJudgeFail;
  return {
    kind: contested === 0 ? "none" : "advisory",
    verifierFailJudgePass,
    verifierPassJudgeFail,
    verified,
    reason: "fixture",
  };
}

/** Only the fields the sensors read; the rest of the record is irrelevant to them. */
function review(parts: { exit: Exit; census?: boolean; provisional?: string | null }): JudgeReviewFacts {
  return {
    runId: "run-1",
    exit: parts.exit,
    census: parts.census === false ? null : { runId: "run-1" },
    provisional: parts.provisional ?? null,
  };
}

function packet(exitKind: "none" | "advisory" | null): JudgeAdviceFacts {
  return {
    runId: "run-1",
    judge: exitKind === null ? null : { exit: exitKind, reason: "fixture", contestedFamilies: ["planar"] },
  };
}

describe("48: the former blocking floor", () => {
  it("fires at max(3, 20%) verifier-fail/Judge-pass and stays quiet below it", () => {
    expect(atFormerBlockThreshold(exit(3, 0, 10))).toBe(true);
    expect(atFormerBlockThreshold(exit(5, 0, 25))).toBe(true);
    expect(atFormerBlockThreshold(exit(4, 0, 25))).toBe(false);
    expect(atFormerBlockThreshold(exit(2, 6, 10))).toBe(false);
    expect(atFormerBlockThreshold(exit(0, 0, 25))).toBe(false);
  });

  it("writes one line naming the counts", () => {
    const dir = logDir();
    safeguardJudgeReview(review({ exit: exit(5, 1, 25) }), 8, createSafeguardContext(dir));
    const log = readLog(dir);
    expect(log).toContain("48-judge-disagreement-at-former-block-threshold");
    expect(log).toContain("passed 5 of 25 verified cases the verifier failed");
    expect(log).not.toContain("49-judge-passed-every-reviewed-case");
  });
});

describe("49: a Judge that passes everything", () => {
  it("fires only on a complete review where every verifier fail was passed and no pass disputed", () => {
    expect(judgePassedEveryReviewedCase(review({ exit: exit(4, 0, 25) }), 4)).toBe(true);
    expect(judgePassedEveryReviewedCase(review({ exit: exit(3, 0, 25) }), 4)).toBe(false);
    expect(judgePassedEveryReviewedCase(review({ exit: exit(4, 1, 25) }), 4)).toBe(false);
    expect(judgePassedEveryReviewedCase(review({ exit: exit(0, 0, 25) }), 0)).toBe(false);
    expect(judgePassedEveryReviewedCase(review({ exit: exit(4, 0, 25), provisional: "incomplete" }), 4)).toBe(
      false,
    );
    expect(judgePassedEveryReviewedCase(review({ exit: exit(4, 0, 25), census: false }), 4)).toBe(false);
  });

  it("writes its line beside 48 when both hold", () => {
    const dir = logDir();
    safeguardJudgeReview(review({ exit: exit(4, 0, 20) }), 4, createSafeguardContext(dir));
    const log = readLog(dir);
    expect(log).toContain("48-judge-disagreement-at-former-block-threshold");
    expect(log).toContain("49-judge-passed-every-reviewed-case");
    expect(log).toContain("passed all 4 verifier-failed cases");
  });

  it("stays quiet on agreement", () => {
    const dir = logDir();
    safeguardJudgeReview(review({ exit: exit(0, 0, 25) }), 6, createSafeguardContext(dir));
    expect(readLog(dir)).toBe("");
  });
});

describe("50: evaluation-only repair right after Judge advice", () => {
  /** "evaluation" also covers changed controls and hidden expectations, not the checker alone
   *  (test/experiment-freeze.e2e.test.ts pins that from bytes), so the line must say so. */
  it("fires on a rebuild whose packet carried Judge disagreement and whose accepted bytes were evaluation-only", () => {
    const dir = logDir();
    safeguardJudgeAdviceThenEvaluatorRepair(
      "rebuild",
      packet("advisory"),
      "evaluation",
      createSafeguardContext(dir),
    );
    const log = readLog(dir);
    expect(log).toContain("50-judge-advice-then-evaluator-only-repair");
    expect(log).toContain("families: planar");
    expect(log).toContain("checker, controls or hidden expectations");
    expect(log).not.toContain("only the correctness model");
  });

  it("stays quiet without the Judge, on a full build, on a climb, or on a failed build", () => {
    const dir = logDir();
    const context = createSafeguardContext(dir);
    safeguardJudgeAdviceThenEvaluatorRepair("rebuild", packet("none"), "evaluation", context);
    safeguardJudgeAdviceThenEvaluatorRepair("rebuild", packet(null), "evaluation", context);
    safeguardJudgeAdviceThenEvaluatorRepair("rebuild", null, "evaluation", context);
    safeguardJudgeAdviceThenEvaluatorRepair("rebuild", packet("advisory"), "build", context);
    safeguardJudgeAdviceThenEvaluatorRepair("climb", packet("advisory"), "evaluation", context);
    safeguardJudgeAdviceThenEvaluatorRepair("rebuild", packet("advisory"), null, context);
    expect(readLog(dir)).toBe("");
  });
});
