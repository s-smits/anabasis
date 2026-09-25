import { PLAN_FIELDS } from "./helpers/experiment-plan.ts";
import { describe, expect, it, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { type CampaignFeedback, type IterationEvidence } from "../src/author/campaign-types.ts";
import { controllerValidatedFindings } from "../src/truth/brief.ts";
import { iterationMemoryFindings, ITERATION_MEMORY_CODE } from "../src/author/iteration-memory.ts";
import {
  resumeCampaignMemory,
  unchangedCandidateSubmissions,
  settleUnresolved,
} from "../src/author/campaign-memory.ts";
import { POLICY } from "../src/critic/policy.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const tmp = () => {
  const root = mkdtempSync(join(tmpdir(), "ana-iteration-memory-"));
  roots.push(root);
  return root;
};

/** A completed iteration record in the directory layout used by the authoring loop. */
function settle(campaignDir: string, evidence: Partial<IterationEvidence> & { ordinal: number }): void {
  const dir = join(campaignDir, `${String(evidence.ordinal).padStart(2, "0")}-slug`);
  mkdirSync(dir, { recursive: true });
  const full: IterationEvidence = {
    dir,
    outcome: "build-failed",
    stage: null,
    focusOwner: null,
    attempts: {},
    findingsHash: null,
    fingerprint: null,
    submissionConditionId: `condition-${evidence.ordinal}`,
    feedback: [],
    ...evidence,
  };
  writeFileSync(join(dir, "iteration.json"), JSON.stringify(full));
}

const briefRefusal = (code: string): CampaignFeedback => ({
  owner: "brief",
  severity: "blocking",
  claim: "build failed at stage brief",
  evidence: "campaigns/slug/01-slug/iteration.json",
  findings: controllerValidatedFindings([
    { code, path: "correctness-model/brief.json", detail: "shape refused" },
  ]),
});

const detailOf = (dir: string): string => iterationMemoryFindings(dir)[0]?.detail ?? "";

describe("cross-iteration Builder memory", () => {
  it("restores captured intent beside its outcome without trusting a changed digest", () => {
    const dir = tmp();
    const proposal = {
      scope: "tasks" as const,
      target: { comparator: "at-least" as const, verifiedPasses: 0 },
      gap: "Untested coupling.",
      change: "Change task coupling.",
      ...PLAN_FIELDS,
      expectedResult: "More failures would support the hypothesis.",
    };
    settle(dir, {
      ordinal: 1,
      outcome: "gates-blocked",
      experimentProposal: { ...proposal, digest: hashJsonValue(proposal) },
      experimentScope: { actual: "climb", freeze: { state: "held", clauses: [] } },
    });
    expect(detailOf(dir)).toContain("Untested coupling");
    expect(detailOf(dir)).toContain("admitted as climb");
    expect(detailOf(dir)).toContain("gates-blocked");
    settle(dir, { ordinal: 2, experimentProposal: { ...proposal, gap: "tampered intent", digest: "wrong" } });
    expect(detailOf(dir)).not.toContain("tampered intent");
  });
  it("bounds a long recorded gap and marks what it left out", () => {
    const dir = tmp();
    const proposal = {
      scope: "tasks" as const,
      target: { comparator: "at-least" as const, verifiedPasses: 0 },
      gap: "x".repeat(300),
      change: "Change task coupling.",
      ...PLAN_FIELDS,
      expectedResult: "More failures would support the hypothesis.",
    };
    settle(dir, { ordinal: 1, experimentProposal: { ...proposal, digest: hashJsonValue(proposal) } });
    expect(detailOf(dir)).toContain(
      `gap "${"x".repeat(240)} […60 bytes omitted]", change "Change task coupling."`,
    );
  });
  it("skips a recorded pass it cannot summarise and keeps the rest of the memory", () => {
    // `parseJsonAs` casts, so every field but the ordinal reached its consumer unread: the
    // attempts `summarise` enumerates and the feedback rows `refusalsOf` walks. A record left
    // short by an interrupted write threw out of the reader and took the whole advisory with it,
    // so one damaged pass cost the session every earlier pass as well.
    const dir = tmp();
    settle(dir, {
      ordinal: 1,
      outcome: "fingerprinted",
      feedback: [briefRefusal("ARTIFACT_TRUTH_COVERAGE")],
    });
    /** A settled pass carrying only the fields `kept` names beside the common ones. */
    const short = (ordinal: number, kept: JsonObject) => {
      const at = join(dir, `${String(ordinal).padStart(2, "0")}-slug`);
      mkdirSync(at, { recursive: true });
      writeFileSync(
        join(at, "iteration.json"),
        JSON.stringify({
          dir: at,
          ordinal,
          outcome: "build-failed",
          stage: null,
          focusOwner: null,
          findingsHash: null,
          fingerprint: null,
          ...kept,
        }),
      );
    };
    short(2, { feedback: [] });
    short(3, { attempts: {} });
    short(4, { attempts: {}, feedback: [{ owner: "brief", severity: "blocking", findings: "refused" }] });
    expect(detailOf(dir)).toBe(
      "Earlier build attempts: 01 fingerprinted.\nEarlier errors: [ARTIFACT_TRUTH_COVERAGE] correctness-model/brief.json in 01. Do not repeat these errors.",
    );
  });

  it("is empty for a campaign with no completed iteration", () => {
    expect(iterationMemoryFindings(tmp())).toEqual([]);
    expect(iterationMemoryFindings(join(tmp(), "absent"))).toEqual([]);
  });

  it("reads the epochs recorded before this one and labels their passes with their epoch", () => {
    // One epoch per experiment leaves one pass per epoch: the A→B→A repeat lives across epochs.
    const root = tmp();
    const epoch = (key: string, supersedes: string | null) => ({
      key,
      supersedes,
      createdAt: "2026-09-13T00:00:00.000Z",
      binding: { domain: "slug", kickoffHash: "k", engines: null, builder: null },
    });
    writeFileSync(
      join(root, "epochs.json"),
      JSON.stringify({
        schema: "campaign-epochs/v1",
        current: "epoch-cccc",
        epochs: [
          epoch("epoch-aaaa", null),
          epoch("epoch-bbbb", "epoch-aaaa"),
          epoch("epoch-cccc", "epoch-bbbb"),
          epoch("epoch-dddd", "epoch-cccc"),
        ],
      }),
    );
    settle(join(root, "epoch-aaaa"), {
      ordinal: 1,
      outcome: "fingerprinted",
      feedback: [briefRefusal("ARTIFACT_TRUTH_COVERAGE")],
    });
    settle(join(root, "epoch-bbbb"), {
      ordinal: 1,
      outcome: "gates-blocked",
      feedback: [briefRefusal("ARTIFACT_TRUTH_COVERAGE")],
    });
    settle(join(root, "epoch-cccc"), { ordinal: 1, outcome: "fingerprinted" });
    settle(join(root, "epoch-dddd"), { ordinal: 1, outcome: "build-failed" });
    const detail = detailOf(join(root, "epoch-cccc"));
    expect(detail).toContain(
      "Earlier build attempts: epoch-aaaa/01 fingerprinted; epoch-bbbb/01 gates-blocked; 01 fingerprinted.",
    );
    expect(detail).toContain(
      "[ARTIFACT_TRUTH_COVERAGE] correctness-model/brief.json in epoch-aaaa/01, epoch-bbbb/01",
    );
    // An epoch recorded after this one is not its past.
    expect(detail).not.toContain("build-failed");
    // The first epoch reads only itself.
    expect(detailOf(join(root, "epoch-aaaa"))).toBe(
      "Earlier build attempts: 01 fingerprinted.\nEarlier errors: [ARTIFACT_TRUTH_COVERAGE] correctness-model/brief.json in 01. Do not repeat these errors.",
    );
    // A damaged record leaves the epoch reading its own passes.
    writeFileSync(join(root, "epochs.json"), "{");
    expect(detailOf(join(root, "epoch-cccc"))).toBe("Earlier build attempts: 01 fingerprinted.");
  });

  it("names the timeline and the refusals this owner already produced, with their iterations", () => {
    const dir = tmp();
    settle(dir, { ordinal: 1, outcome: "build-failed", stage: "brief", focusOwner: "brief" });
    settle(dir, {
      ordinal: 2,
      outcome: "gates-blocked",
      focusOwner: "brief",
      attempts: { brief: 2, controls: 3 },
      feedback: [briefRefusal("ARTIFACT_TRUTH_COVERAGE")],
    });
    settle(dir, {
      ordinal: 3,
      outcome: "fingerprinted",
      feedback: [briefRefusal("ARTIFACT_TRUTH_COVERAGE")],
    });
    const findings = iterationMemoryFindings(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe(ITERATION_MEMORY_CODE);
    const detail = findings[0]?.detail ?? "";
    expect(detail).toContain("01 build-failed at brief, part brief");
    expect(detail).toContain("02 gates-blocked, part brief (retried brief x2, controls x3)");
    expect(detail).toContain("03 fingerprinted");
    // The repeat the controller's stall hash cannot see across a gap is exactly what crosses.
    expect(detail).toContain("[ARTIFACT_TRUTH_COVERAGE] correctness-model/brief.json in 02, 03");
    expect(detail).toContain("Do not repeat these errors");
  });

  it("keeps the refusals several passes repeated when the bound cuts the tail, and says what it cut", () => {
    // The bound cuts at twelve. Walking the passes oldest first and keeping the order the labels
    // were first encountered gave the twelve one-off labels of pass 01 the whole budget, so the
    // label the Builder had committed in three consecutive passes — the one "do not repeat these
    // errors" is actually about — fell off the end, and the rendered line named no omission at all.
    const dir = tmp();
    settle(dir, {
      ordinal: 1,
      outcome: "gates-blocked",
      feedback: Array.from({ length: 12 }, (_, index) =>
        briefRefusal(`ONCE_${String(index).padStart(2, "0")}`),
      ),
    });
    for (const ordinal of [2, 3, 4]) {
      settle(dir, { ordinal, outcome: "gates-blocked", feedback: [briefRefusal("HABIT")] });
    }

    const detail = detailOf(dir);
    // Its own pass list stays chronological, whichever end the entries are gathered from.
    expect(detail).toContain("[HABIT] correctness-model/brief.json in 02, 03, 04");
    expect(detail.indexOf("[HABIT]")).toBeLessThan(detail.indexOf("[ONCE_00]"));
    // The tail is still what is cut; it is now the last one-off rather than the habit, and the
    // reader is told a row was dropped instead of reading a list that looks complete.
    expect(detail).not.toContain("[ONCE_11]");
    expect(detail).toContain("1 further distinct earlier error(s) omitted. Do not repeat these errors.");
  });

  it("includes every owner in the bounded safe refusal memory", () => {
    const dir = tmp();
    settle(dir, {
      ordinal: 1,
      outcome: "gates-blocked",
      feedback: [
        briefRefusal("BRIEF_REFUSED"),
        {
          owner: "tests",
          severity: "blocking",
          claim: "battery census refused",
          evidence: "campaigns/slug/01-slug/census.json",
          findings: controllerValidatedFindings([
            { code: "TASK_COUNT", path: "correctness-model/tasks.json", detail: "wrong count" },
          ]),
        },
      ],
    });
    expect(detailOf(dir)).toContain("[TASK_COUNT] correctness-model/tasks.json in 01");
    expect(detailOf(dir)).toContain("[BRIEF_REFUSED] correctness-model/brief.json in 01");
  });

  it("carries no protected campaign text: not the claim, not the evidence pointer, not raw detail", () => {
    const dir = tmp();
    settle(dir, {
      ordinal: 1,
      outcome: "gates-blocked",
      focusOwner: "controls",
      feedback: [
        {
          owner: "controls",
          severity: "blocking",
          claim: "solvability census refused: disk source bytes differ from the fixed identity",
          evidence: "pre-adoption solvability census (protected host evidence: solvability.json)",
          // Unmarked: no controller validator created it, so its detail must fail closed.
          findings: [{ code: "x", path: "p", detail: "raw engine words that must not cross" }],
        },
      ],
    });
    const detail = detailOf(dir);
    expect(detail).not.toContain("solvability census refused");
    expect(detail).not.toContain("solvability.json");
    expect(detail).not.toContain("raw engine words");
    expect(detail).toContain("generated-execution-unclassified");
  });

  it("reads the newest iterations when a campaign runs long, and skips a partially written iteration record", () => {
    const dir = tmp();
    for (const ordinal of [1, 2, 3, 4, 5]) settle(dir, { ordinal, outcome: "fingerprinted" });
    mkdirSync(join(dir, "06-slug"), { recursive: true });
    writeFileSync(join(dir, "06-slug", "iteration.json"), "{ half written");
    const detail = detailOf(dir);
    expect(detail).not.toContain("01 fingerprinted");
    expect(detail).toContain("05 fingerprinted");
  });

  // truss-run1-sol-0830 recorded `candidate-unchanged` 21 times on workspace commit 52e0d68c across
  // 14 controller invocations. Every invocation replayed the same directory and saw one sighting,
  // because nothing on disk was keyed by the commit. These two cases check counting by commit.
  it("counts unchanged candidate records per workspace commit across invocations", () => {
    const dir = tmp();
    resumeCampaignMemory(dir, "slug", "k");
    const a = "52e0d68c".padEnd(40, "0");
    for (const ordinal of [1, 2, 3]) {
      settle(dir, {
        ordinal,
        outcome: "fingerprinted",
        workspaceChange: { baseCommit: a, commit: a, changedPaths: [], deletedPaths: [] },
      });
    }
    const memory = resumeCampaignMemory(dir, "slug", "k");
    expect(memory.unchangedCandidateCommits[a]).toBe(3);
    expect(unchangedCandidateSubmissions(memory, [])).toBeGreaterThanOrEqual(
      POLICY.loop.unchangedCandidateStrikes,
    );
  });

  it("starts a fresh count when the Builder moves the tree, and keeps the old commit's total", () => {
    const dir = tmp();
    resumeCampaignMemory(dir, "slug", "k");
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    for (const ordinal of [1, 2]) {
      settle(dir, {
        ordinal,
        outcome: "fingerprinted",
        workspaceChange: { baseCommit: a, commit: a, changedPaths: [], deletedPaths: [] },
      });
    }
    settle(dir, {
      ordinal: 3,
      outcome: "fingerprinted",
      workspaceChange: { baseCommit: b, commit: b, changedPaths: [], deletedPaths: [] },
    });
    const memory = resumeCampaignMemory(dir, "slug", "k");
    expect(memory.unchangedCandidateCommits).toEqual({ [a]: 2, [b]: 1 });
    // The campaign continues: the commit it would resubmit is B, sighted once.
    expect(unchangedCandidateSubmissions(memory, [])).toBe(1);
  });

  it("does not count an iteration whose child tree moved, nor an unsettled one", () => {
    const dir = tmp();
    resumeCampaignMemory(dir, "slug", "k");
    const a = "a".repeat(40);
    settle(dir, {
      ordinal: 1,
      outcome: "fingerprinted",
      workspaceChange: { baseCommit: a, commit: "c".repeat(40), changedPaths: ["x"], deletedPaths: [] },
    });
    settle(dir, {
      ordinal: 2,
      outcome: "build-failed",
      workspaceChange: { baseCommit: a, commit: a, changedPaths: [], deletedPaths: [] },
    });
    expect(resumeCampaignMemory(dir, "slug", "k").unchangedCandidateCommits).toEqual({});
  });

  it("clears carried feedback when replaying a fingerprinted iteration", () => {
    const evidence: IterationEvidence = {
      ordinal: 1,
      dir: "01-slug",
      outcome: "fingerprinted",
      stage: null,
      focusOwner: null,
      attempts: {},
      findingsHash: null,
      fingerprint: null,
      feedback: [],
    };
    expect(settleUnresolved([briefRefusal("BRIEF_REFUSED")], evidence)).toEqual([]);
  });
});
