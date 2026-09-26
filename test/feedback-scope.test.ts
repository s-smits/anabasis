import { describe, expect, it } from "bun:test";
import { TASKS_FILE } from "../src/meta/bundle-layout.ts";
import { authorSessionOwner } from "../src/analyse/finding-owner.ts";
import {
  BUNDLE_FILES,
  advisory,
  feedbackOwner,
  isBundleFile,
  ownerSide,
} from "../src/author/feedback-routing.ts";
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
  });

describe("the complete repair agenda", () => {
  it("names a bundle file or the environment, and reads the side from the path", () => {
    expect(BUNDLE_FILES.filter((file) => ownerSide(file) === "agent")).toEqual([
      "agent/tools-spec.json",
      "agent/tools.ts",
      "agent/BUILT_AGENTS.md",
      "agent/config.yaml",
    ]);
    // The reference solve sits beside the evaluator, so repairing it reopens the correctness model.
    expect(ownerSide("correctness-model/reference/index.ts")).toBe("correctness-model");
    expect(isBundleFile("environment")).toBe(false);
    expect(isBundleFile(null)).toBe(false);
    expect(isBundleFile("correctness-model/controls.json")).toBe(true);
  });

  it("routes an aggregate finding to the bundle file it names, and nothing else anywhere", () => {
    const base = { claim: "finding", evidence: "recorded" };
    expect(authorSessionOwner({ ...base, defect: false, owner: null })).toBeNull();
    expect(authorSessionOwner({ ...base, defect: false, owner: "environment" })).toBeNull();
    expect(authorSessionOwner({ ...base, defect: false, owner: TASKS_FILE })).toBe(TASKS_FILE);
    expect(authorSessionOwner({ ...base, defect: true, owner: TASKS_FILE })).toBe(TASKS_FILE);
    const subject = { taskId: "t1", family: "beams" };
    expect(authorSessionOwner({ ...base, defect: true, owner: TASKS_FILE, subject })).toBeNull();
  });

  it("preserves admitted severity and public findings while private-only changes leave author text identical", () => {
    const feedback: CampaignFeedback[] = [
      {
        ...row("correctness-model/brief.json"),
        findings: [
          controllerValidatedFinding({
            code: "brief-field",
            path: "public.rule",
            detail: "Publish the required rule.",
          }),
        ],
      },
      { ...row(TASKS_FILE), severity: "advisory" },
      {
        ...row("correctness-model/evaluator.ts"),
        findings: [{ code: "PRIVATE_CODE", path: "PRIVATE_PATH", detail: "PRIVATE_DETAIL" }],
      },
    ];
    const text = advisory(feedback);
    expect(text).toContain(
      "correctness-model/brief.json: [blocking] brief-field: Publish the required rule.",
    );
    expect(text).toContain("correctness-model/tasks.json: [advisory]");
    expect(text).not.toContain("PRIVATE");
    const privateChanges = feedback.map((entry) => {
      const changed = { ...entry, claim: "DIFFERENT_PRIVATE", evidence: "DIFFERENT_PRIVATE" };
      if (entry.owner === "correctness-model/evaluator.ts") {
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
    const cited = "campaigns/design-steel-trusses-3fd52f9e-3/analysis/truss-i02-epoch-review.json";
    const text =
      advisory([
        {
          ...row(TASKS_FILE),
          severity: "advisory",
          findings: [
            controllerValidatedFinding({
              code: "defect",
              path: cited,
              detail: "Let $.peripherals differ between the tasks.",
            }),
          ],
        },
      ]) ?? "";
    expect(text).toBe(
      "- correctness-model/tasks.json: [advisory] defect: Let $.peripherals differ between the tasks.",
    );
    expect(text).not.toContain("campaigns/");
  });

  it("keeps every blocker and hashes the complete set independent of arrival order", async () => {
    const feedback = [
      row(TASKS_FILE),
      row("correctness-model/evaluator.ts"),
      row("correctness-model/brief.json"),
      row("agent/BUILT_AGENTS.md"),
    ];
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
    expect(feedbackOwner([row("correctness-model/controls.json")])).toBe("correctness-model/controls.json");
    expect(feedbackOwner([])).toBeNull();
  });

  it("requests a rebuild from the adopted product for each blocking set", () => {
    expect(
      decideNextMove("adopted", [row(TASKS_FILE), row("correctness-model/controls.json")]),
    ).toMatchObject({
      move: "rebuild",
      seed: "adopted",
    });
    // The owners are named. An open campaign admits a candidate that leaves them alone, so the
    // kickoff states no consequence admission does not impose.
    expect(
      decideNextMove("adopted", [row(TASKS_FILE), row("correctness-model/controls.json")]).reason,
    ).toContain(
      "blocking feedback stands against correctness-model/controls.json, correctness-model/tasks.json",
    );
    expect(decideNextMove("adopted", [row(TASKS_FILE)]).reason).not.toContain("admission");
    expect(
      decideNextMove("adopted", [
        row("correctness-model/evaluator.ts"),
        row("correctness-model/controls.json"),
      ]),
    ).toMatchObject({
      move: "rebuild",
      seed: "adopted",
    });
    for (const feedback of [
      [row(TASKS_FILE), row("correctness-model/evaluator.ts")],
      [row("correctness-model/controls.json"), row("agent/BUILT_AGENTS.md")],
    ]) {
      expect(decideNextMove("adopted", feedback)).toMatchObject({ move: "rebuild", seed: "adopted" });
      expect(decideNextMove("adopted", feedback)).not.toHaveProperty("experiment");
    }
  });

  it("settles an iteration to its own blocking rows", () => {
    const blocked = double<Parameters<typeof settleUnresolved>[0]>({
      outcome: "gates-blocked",
      feedback: [
        row("correctness-model/brief.json"),
        row("correctness-model/brief.json"),
        { ...row(TASKS_FILE), severity: "advisory" },
      ],
    });
    expect(settleUnresolved(blocked)).toEqual([row("correctness-model/brief.json")]);
  });
});
