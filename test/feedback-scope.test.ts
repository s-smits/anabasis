import { describe, expect, it } from "bun:test";
import { authorSessionOwner } from "../src/analyse/finding-owner.ts";
import type { AnalysisFinding } from "../src/analyse/iteration-analysis.ts";
import { feedbackOwner, advisory } from "../src/author/feedback-routing.ts";
import { settleGateRun } from "../src/gate/settlement.ts";
import { settleUnresolved } from "../src/author/campaign-memory.ts";
import { decideNextMove } from "../src/run/next-move.ts";
import { controllerValidatedFinding } from "../src/truth/brief.ts";
import type { CampaignFeedback, FeedbackOwner } from "../src/author/campaign-types.ts";
import { double } from "./helpers/doubles.ts";

const row = (owner: FeedbackOwner): CampaignFeedback => ({
  owner,
  severity: "blocking",
  claim: owner,
  evidence: "recorded",
});
const settle = (feedback: CampaignFeedback[]) =>
  settleGateRun({
    feedback,
    fingerprint: double({ agentHash: "a", correctnessModelHash: "c", taskSetHash: "t" }),
    attempts: {},
    ordinal: 1,
    dir: "01-test",
    priorBlockedFindingsHashes: [],
  });

describe("the complete repair agenda", () => {
  it("keeps an unowned Judge disclosure typed while a Builder defect has only its owner", () => {
    const base = { claim: "finding", evidence: "recorded", proposedOwner: null } satisfies Pick<
      AnalysisFinding,
      "claim" | "evidence" | "proposedOwner"
    >;
    expect(authorSessionOwner({ ...base, kind: "judge-disagreement" })).toEqual({
      owner: null,
      reason: "judge-advisory-only",
    });
    expect(authorSessionOwner({ ...base, kind: "harness-defect", proposedOwner: "tests" })).toEqual({
      owner: "tests",
    });
  });

  it("preserves admitted severity and public findings while private-only changes leave author text identical", () => {
    const feedback: CampaignFeedback[] = [
      {
        ...row("brief"),
        findings: [
          controllerValidatedFinding({
            code: "brief-field",
            path: "public.rule",
            detail: "Publish the required rule.",
          }),
        ],
      },
      { ...row("tests"), severity: "advisory" },
      {
        ...row("correctness-model"),
        findings: [{ code: "PRIVATE_CODE", path: "PRIVATE_PATH", detail: "PRIVATE_DETAIL" }],
      },
    ];
    const text = advisory(feedback);
    expect(text).toContain(
      "brief (correctness-model/brief.json): [blocking] brief-field: Publish the required rule.",
    );
    expect(text).toContain("tests (correctness-model/tasks.json): [advisory]");
    expect(text).not.toContain("PRIVATE");
    const privateChanges = feedback.map((entry) => {
      const changed = { ...entry, claim: "DIFFERENT_PRIVATE", evidence: "DIFFERENT_PRIVATE" };
      if (entry.owner === "correctness-model") {
        changed.findings = [{ code: "OTHER", path: "OTHER", detail: "OTHER" }];
      }
      return changed;
    });
    expect(advisory(privateChanges)).toBe(text);
    expect(advisory(feedback.map((entry) => ({ ...entry, severity: "advisory" })))).not.toBe(text);
  });

  it("names the file the owner writes, not the recorded evidence the Builder cannot open", () => {
    // Of the 416 findings in the admission records under campaigns/, 411 cite a file under
    // campaigns/ and 5 under domains/. Both trees are closed to the Builder, so the citation spent
    // about a hundred characters a row on a file the session could not open; the record keeps it.
    const cited = "campaigns/writes-firmware-esp32-raspberry-9c0c68b1-3/analysis/esp32-i02-epoch-review.json";
    const text =
      advisory([
        {
          ...row("tests"),
          severity: "advisory",
          findings: [
            controllerValidatedFinding({
              code: "curriculum-defect",
              path: cited,
              detail: "Let $.peripherals differ between the tasks.",
            }),
          ],
        },
      ]) ?? "";
    expect(text).toBe(
      "- tests (correctness-model/tasks.json): [advisory] curriculum-defect: Let $.peripherals differ between the tasks.",
    );
    expect(text).not.toContain("campaigns/");
  });

  it("keeps every blocker and hashes the complete set independent of arrival order", async () => {
    const feedback = [row("tests"), row("correctness-model"), row("brief"), row("instructions")];
    const first = await settle(feedback);
    expect(first.kind).toBe("continue");
    for (let offset = 0; offset < feedback.length; offset++) {
      const order = [...feedback.slice(offset), ...feedback.slice(0, offset)].toReversed();
      const result = await settle(order);
      expect(result).toMatchObject({ kind: "continue", carried: order });
      expect(result.evidence.findingsHash).toBe(first.evidence.findingsHash);
      expect(result.evidence.focusOwner).toBeNull();
      expect(decideNextMove("adopted", order)).toMatchObject({ move: "rebuild", seed: "adopted" });
      const environmental = await settle([...order, row("environment")]);
      expect(environmental).toMatchObject({ kind: "terminal", clause: "environment-blocked" });
      expect(environmental.evidence.feedback).toHaveLength(5);
      expect(decideNextMove("adopted", [row("environment"), ...order]).move).toBe("stop");
    }
    const changed = await settle(
      feedback.map((entry, index) => (index === 1 ? { ...entry, claim: "new evaluator fact" } : entry)),
    );
    expect(changed.evidence.findingsHash).not.toBe(first.evidence.findingsHash);
    expect(feedbackOwner([row("controls")])).toBe("controls");
    expect(feedbackOwner([])).toBeNull();
  });

  it("requests a rebuild from the adopted product for each blocking set", () => {
    expect(decideNextMove("adopted", [row("tests"), row("controls")])).toMatchObject({
      move: "rebuild",
      seed: "adopted",
    });
    // The owners are named. An open campaign admits a candidate that leaves them alone, so the
    // kickoff states no consequence admission does not impose.
    expect(decideNextMove("adopted", [row("tests"), row("controls")]).reason).toContain(
      "blocking feedback stands against controls, tests",
    );
    expect(decideNextMove("adopted", [row("tests")]).reason).not.toContain("admission");
    expect(decideNextMove("adopted", [row("correctness-model"), row("controls")])).toMatchObject({
      move: "rebuild",
      seed: "adopted",
    });
    for (const feedback of [
      [row("tests"), row("correctness-model")],
      [row("controls"), row("instructions")],
    ]) {
      expect(decideNextMove("adopted", feedback)).toMatchObject({ move: "rebuild", seed: "adopted" });
      expect(decideNextMove("adopted", feedback)).not.toHaveProperty("experiment");
    }
  });

  it("keeps earlier findings after a failed attempt, including its own owner", () => {
    const pending = [row("tests"), row("correctness-model")];
    const failure = double<Parameters<typeof settleUnresolved>[1]>({
      outcome: "build-failed",
      repairOwner: "tests",
      feedback: [row("brief")],
    });
    expect(settleUnresolved(pending, failure)).toEqual([...pending, row("brief")]);
    expect(settleUnresolved(pending, { ...failure, outcome: "gates-blocked" })).toEqual([row("brief")]);
  });
});
