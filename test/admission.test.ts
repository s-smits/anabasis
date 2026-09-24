// How one iteration's analysed evidence reaches the next build, and when it must not.
//
// `admission.ts` is the whole channel between iteration N and iteration N+1: there is no
// scheduler, so whatever this reader returns is what the next Builder session is told. Four
// separate rules can stop a packet, and each stops it for a different reason that the recorded
// lineage has to name — a review that cannot tell "no packet" from "a packet that routed nothing"
// reads the run wrongly.
//
// The rules, in the order the reader applies them: a feedback policy other than the current one,
// an evaluation identity that moved, a packet with no feedback at all, and a reuse allowance
// already spent. A corrupt packet is the fifth case and is the only one that throws, because
// silently seeding or skipping a build is worse than stopping.

import { afterAll, describe, expect, it } from "bun:test";
import { FEEDBACK_POLICY } from "../src/analyse/iteration-analysis.ts";
import type { CampaignFeedback } from "../src/author/campaign-types.ts";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { campaignDir } from "../src/meta/campaign-root.ts";
import { join } from "../src/meta/path.ts";
import { movedIdentity, type PersistedAdmission } from "../src/run/admission-packet.ts";
import {
  prepareAdmissionPointer,
  publishAdmissionPointer,
  readAdmission,
  settleRebuildAdvice,
} from "../src/run/admission.ts";
import { ControllerLedger } from "../src/run/controller-ledger.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const SLUG = "admission-fixture";
const DIGEST = "packet-1";
/** An evaluation identity neither half of which was recorded, so it proves no mismatch. */
const UNRECORDED = { scoringHash: null, taskSetHash: null };

const FEEDBACK: CampaignFeedback = {
  owner: "tests",
  severity: "blocking",
  claim: "two families share one check",
  evidence: "cases 3 and 7",
};

afterAll(cleanupScratch);

function repo(): string {
  const root = scratchDir("ana-admission-");
  mkdirSync(campaignDir(root, SLUG), { recursive: true });
  return root;
}

/** A packet as the writers leave it. Overrides replace whole fields, so a case can state exactly
 *  the one fact it is about. */
function packet(overrides: Partial<PersistedAdmission> = {}): string {
  return JSON.stringify({
    runId: "run-1",
    policy: FEEDBACK_POLICY,
    schema: "repair-agenda/v1",
    attempts: [],
    digest: DIGEST,
    admitted: [],
    refused: [],
    feedback: [FEEDBACK],
    findingRoutes: [],
    observedEvaluation: UNRECORDED,
    ...overrides,
  });
}

/** Give the adopted tree a battery, so its evaluation identity is a recorded value a packet's
 *  own identity can be compared against rather than an absent one. */
function adoptBattery(root: string): void {
  const model = join(root, "domains", SLUG, "correctness-model");
  mkdirSync(model, { recursive: true });
  writeFileSync(join(model, "tasks.json"), JSON.stringify({ tasks: [{ id: "t1" }] }));
}

function store(root: string, payload: string): void {
  using ledger = ControllerLedger.open(campaignDir(root, SLUG));
  ledger.writeAdmission(payload);
}

function read(root: string) {
  return readAdmission(root, SLUG);
}

describe("what the next build is told", () => {
  it("hands over the feedback a current packet carries", () => {
    const root = repo();
    store(root, packet());
    const seen = read(root);
    expect(seen.priorEvidence).toEqual({ digest: DIGEST, feedback: [FEEDBACK], kind: "admitted-packet" });
    expect(seen.lineage).toBeNull();
  });

  it("says nothing at all when no packet was ever written", () => {
    expect(read(repo())).toEqual({ priorEvidence: null, lineage: null });
  });

  it("separates a packet that routed nothing from no packet, by naming the digest it read", () => {
    // Recording null for both would leave a review unable to tell an empty agenda from an absent one.
    const root = repo();
    store(root, packet({ feedback: [] }));
    expect(read(root)).toEqual({ priorEvidence: null, lineage: { digest: DIGEST, reason: "no-feedback" } });
  });
});

describe("the rules that stop a packet", () => {
  it("reads a packet from a retired feedback policy as no packet, rather than trusting its owners", () => {
    // The owners and severities in it were assigned by a rule that no longer holds, so applying
    // them would seed a repair the present rule would not ask for.
    const root = repo();
    for (const policy of ["severity-route/1-whatever", "severity-route/8-single-battery-judge-exit"]) {
      store(root, packet({ policy }));
      expect(read(root)).toEqual({ priorEvidence: null, lineage: null });
    }
  });

  it("throws on a corrupt packet rather than seeding or skipping a build with it", () => {
    const root = repo();
    store(root, "{not json");
    expect(() => read(root)).toThrow(/unreadable/);
  });
});

describe("whether the evaluation that labelled the findings is the adopted one", () => {
  it.each([
    ["keeps a half only one side recorded, which proves no mismatch", ["a", null], [null, "b"], null],
    ["names the scoring program when it moved", ["a", "t"], ["b", "t"], "scoringHash"],
    ["names the task set when it moved", ["a", "t"], ["a", "u"], "taskSetHash"],
    ["reports the scoring program first when both moved", ["a", "t"], ["b", "u"], "scoringHash"],
  ] as const)("%s", (_title, [scoringHash, taskSetHash], [otherScoring, otherTasks], moved) => {
    expect(
      movedIdentity({ scoringHash, taskSetHash }, { scoringHash: otherScoring, taskSetHash: otherTasks }),
    ).toBe(moved);
  });

  it("holds a packet measured under an evaluation this tree never adopted", () => {
    // A held candidate publishes a packet from a tree that was never installed. Which cases
    // failed and whether a failure is agent-owned are that evaluator's decisions, so none of its
    // rows states anything here — the packet stays recorded as lineage.
    const root = repo();
    adoptBattery(root);
    store(root, packet({ observedEvaluation: { scoringHash: null, taskSetHash: "another-battery" } }));
    expect(read(root)).toEqual({
      priorEvidence: null,
      lineage: { digest: DIGEST, reason: "evaluation-identity-unadopted" },
    });
  });

  it("keeps a packet whose observed identity this tree simply never recorded", () => {
    // The adopted tree has no battery to compare against, so nothing was proved to have moved.
    // Excluding a packet needs a recorded mismatch, not an absent record on either side.
    const root = repo();
    store(root, packet({ observedEvaluation: { scoringHash: "observed", taskSetHash: "observed" } }));
    expect(read(root).priorEvidence?.feedback).toEqual([FEEDBACK]);
  });
});

describe("how many times one packet may be reused", () => {
  const settle = (root: string, runId: string, heldInLoop: boolean) =>
    settleRebuildAdvice(root, SLUG, { admissionDigest: DIGEST, runId, heldInLoop });

  it("lets one in-loop hold retry, and spends the allowance on the second", () => {
    const root = repo();
    store(root, packet());
    expect(settle(root, "run-a", true)).toBe(false);
    expect(read(root).priorEvidence?.feedback).toEqual([FEEDBACK]);
    expect(settle(root, "run-b", true)).toBe(true);
    expect(read(root)).toEqual({
      priorEvidence: null,
      lineage: { digest: DIGEST, reason: "agenda-consumed" },
    });
  });

  it("spends the allowance at once on an attempt that was not held", () => {
    const root = repo();
    store(root, packet());
    expect(settle(root, "run-a", false)).toBe(true);
    expect(read(root).lineage?.reason).toBe("agenda-consumed");
  });

  it("records one attempt per run id, so a repeated settlement is not a second attempt", () => {
    const root = repo();
    store(root, packet());
    expect(settle(root, "run-a", true)).toBe(false);
    expect(settle(root, "run-a", true)).toBe(false);
    expect(read(root).priorEvidence?.feedback).toEqual([FEEDBACK]);
  });

  it("settles nothing against a digest the stored packet does not carry", () => {
    const root = repo();
    store(root, packet());
    expect(
      settleRebuildAdvice(root, SLUG, { admissionDigest: "other", runId: "run-a", heldInLoop: true }),
    ).toBe(false);
    expect(read(root).priorEvidence?.feedback).toEqual([FEEDBACK]);
  });

  it("settles nothing when there is no packet to settle against", () => {
    expect(settle(repo(), "run-a", true)).toBe(false);
  });
});

describe("a prepared packet is bound to the campaign that prepared it", () => {
  it("publishes a packet the reader then finds", () => {
    const root = repo();
    const pointer = prepareAdmissionPointer(
      root,
      SLUG,
      "run-1",
      {
        digest: DIGEST,
        admitted: [],
        refused: [],
        feedback: [FEEDBACK],
        findingRoutes: [],
      },
      UNRECORDED,
    );
    publishAdmissionPointer(pointer, campaignDir(root, SLUG));
    expect(read(root).priorEvidence?.digest).toBe(DIGEST);
  });

  it("refuses to publish a packet whose payload no longer matches its prepared digest", () => {
    const root = repo();
    const pointer = prepareAdmissionPointer(
      root,
      SLUG,
      "run-1",
      {
        digest: DIGEST,
        admitted: [],
        refused: [],
        feedback: [FEEDBACK],
        findingRoutes: [],
      },
      UNRECORDED,
    );
    expect(() =>
      publishAdmissionPointer({ ...pointer, digest: "tampered" }, campaignDir(root, SLUG)),
    ).toThrow(/not bound/);
  });

  it("refuses to publish one campaign's packet into another campaign's tree", () => {
    const root = repo();
    const pointer = prepareAdmissionPointer(
      root,
      SLUG,
      "run-1",
      {
        digest: DIGEST,
        admitted: [],
        refused: [],
        feedback: [FEEDBACK],
        findingRoutes: [],
      },
      UNRECORDED,
    );
    // The pointer names this campaign's file; the publish names another campaign's tree. The
    // binding has to read two independent facts to see that, which is the whole point of it.
    const elsewhere = campaignDir(root, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    expect(() => publishAdmissionPointer(pointer, elsewhere)).toThrow(/not bound/);
  });

  it("refuses to replace a stored packet it cannot read", () => {
    const root = repo();
    store(root, "{not json");
    expect(() =>
      prepareAdmissionPointer(
        root,
        SLUG,
        "run-2",
        {
          digest: "packet-2",
          admitted: [],
          refused: [],
          feedback: [],
          findingRoutes: [],
        },
        UNRECORDED,
      ),
    ).toThrow(/unreadable/);
  });
});
