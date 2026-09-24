/**
 * What the authoring reviewer is shown of the round's blind rehearsals, and what it is not.
 *
 * A rehearsal is the one moment in a round where a solver's own reading of the public contract meets
 * the declared checks before measurement, and a failed one is often the first sign that a rule
 * admits two readings. The reviewer receives each rehearsal as the bytes the Built solver submitted
 * and the one verdict they earned: the projection `harness_trial` already returns to the Builder,
 * plus the artifact the Builder never sees. Which check refused it, what the verifier printed and
 * where the artifact failed stay behind, so a change to any of those alone leaves the review's
 * prompt, and every page it reads of a rehearsal, byte for byte the same.
 */
import { afterAll, describe, expect, it } from "bun:test";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import type { RehearsalRow } from "../src/author/experiment-plan.ts";
import { bundleSnapshotIdOf } from "../src/claim/bundle-snapshot.ts";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import { AuthoringReviewClock } from "../src/gate/review-clock.ts";
import { runEpochReview } from "../src/review/epoch-reviewer.ts";
import { AuthoringReviews } from "../src/run/authoring-review.ts";
import { completeBundle } from "./helpers/builder-campaign.ts";
import { double, required } from "./helpers/doubles.ts";
import { call } from "./helpers/review-fixtures.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

/** One rehearsal as `harness_trial` reports it, with whatever extra a producer might attach. */
type Rehearsal = {
  row: Partial<RehearsalRow> & JsonObject;
  submitted: { ordinal: number; artifact: string | null; candidateId?: string | null } & JsonObject;
};

const SLUG = "matching";
const REQUEST = "Bind each part to its slot.";
const RIGHT = JSON.stringify({ assignments: [{ part: "alpha", slot: "s3" }] });
const WRONG = JSON.stringify({ assignments: [{ part: "alpha", slot: "s9" }] });

/**
 * A firmware rehearsal in the shape a recorded one took: a sketch and its build report, submitted
 * as one `files` object, failed. The alarm clears 600 ms after it went high, which is one reading of
 * a hold rule that also admits timing the hold from the drop; the reviewer can only weigh that
 * reading if it can read the sketch.
 */
const KILN_SKETCH = `static const uint8_t ALARM_PIN = 4;
static uint16_t alarmHighAt = 0;
static bool alarmHigh = false;

void loop() {
  uint16_t now16 = (uint16_t)millis();
  bool wasArmed = armed;
  if (faulted || filtered >= 85000L) {
    armed = true;
  } else if (filtered <= 80000L) {
    armed = false;
  }
  if (armed && !wasArmed) {
    digitalWrite(ALARM_PIN, HIGH);
    alarmHighAt = now16;
    alarmHigh = true;
  } else if (!armed && alarmHigh && (uint16_t)(now16 - alarmHighAt) >= 600U) {
    digitalWrite(ALARM_PIN, LOW);
    alarmHigh = false;
  }
}
`;
const KILN_ARTIFACT = JSON.stringify({
  files: {
    "build-report.json": '{\n  "flashBytes": 4328,\n  "ramBytes": 269\n}\n',
    "firmware/firmware.ino": KILN_SKETCH,
  },
});

/** Detail a grading holds and rule 4 keeps from every author, in two versions that disagree on
 *  every field. A field a producer grew would reach the review only by being named on the way. */
const PROTECTED_A = {
  truthOk: false,
  failedCheckIds: ["expected-binding"],
  checkResults: { "expected-binding": false, "parts-assigned": true },
  stdout: "stdout-marker-a: slot s3 expected",
  failureLocation: "$.assignments[0].slot",
  counterexample: { assignments: [{ part: "alpha", slot: "s3" }] },
};
const PROTECTED_B = {
  truthOk: false,
  failedCheckIds: ["parts-assigned"],
  checkResults: { "expected-binding": true, "parts-assigned": false },
  stdout: "stdout-marker-b: part beta missing",
  failureLocation: "$.assignments",
  counterexample: { assignments: [{ part: "beta", slot: "s1" }] },
};
const MARKERS = ["expected-binding", "parts-assigned", "stdout-marker", "failureLocation", "counterexample"];

const review = {
  enabled: true,
  kind: "codex",
  model: "gpt-6-astra",
  reasoningEffort: "low",
  source: "operator",
} as const;

afterAll(cleanupScratch);

function rehearsal(
  ordinal: number,
  verdict: RehearsalRow["verdict"],
  artifact: string | null,
  extra: JsonObject = {},
): Rehearsal {
  return {
    row: {
      taskId: "t1",
      family: "single-part",
      verdict,
      wallMinutes: 120,
      minutes: 1,
      toolCalls: 2,
      ...extra,
    },
    submitted: { ordinal, artifact, ...extra },
  };
}

/** The rehearsals one review is handed, from a round whose rehearsals `AuthoringReviews` recorded
 *  and whose review it then started over a frozen workspace. A rehearsal with no candidate named
 *  solved the bytes that review freezes. */
async function handed(rehearsals: readonly Rehearsal[]) {
  const workspace = scratchDir("ana-review-rehearsals-");
  completeBundle(workspace);
  const fingerprint = fingerprintSlug(workspace, { slug: SLUG });
  if (!fingerprint.ok) throw new Error("the fixture bundle does not fingerprint");
  const frozen = bundleSnapshotIdOf(fingerprint);
  let seen: { root: string; rehearsals: readonly unknown[] } | null = null;
  const reviews = new AuthoringReviews(
    workspace,
    SLUG,
    new AuthoringReviewClock(null, 0),
    async (root, _trigger, _plan, cases?: readonly unknown[]) => {
      seen = { root, rehearsals: cases ?? [] };
      return { text: "", findings: 0 };
    },
  );
  for (const { row, submitted } of rehearsals) {
    reviews.rehearsed(double(row), double({ candidateId: frozen, ...submitted }));
  }
  await reviews.afterTool();
  await reviews.join();
  return required<{ root: string; rehearsals: readonly unknown[] }>(seen, "a started review");
}

/** What the reviewer is shown over `root` with these rehearsals: its whole prompt, and the first
 *  page read_source returns under each rehearsal name the prompt lists. */
async function shown(root: string, rehearsals: readonly unknown[]) {
  let prompt = "";
  const reads = new Map<string, string>();
  const result = await runEpochReview({
    repoRoot: root,
    slug: SLUG,
    runId: "authoring-checkpoint",
    treeRoot: ".",
    analysis: null,
    priorAdvice: null,
    experiment: null,
    review,
    publicRequest: REQUEST,
    ...double<object>({ rehearsals }),
    readerTurn: async (input) => {
      prompt = input.prompt;
      const reader = required(
        input.tools.find((tool) => tool.name === "read_source"),
        "read_source",
      );
      for (const [name] of input.prompt.matchAll(/rehearsal:\d+:[\w-]+/g)) {
        if (!reads.has(name)) reads.set(name, await call(reader, { path: name }));
      }
      return { pin: null, text: "", error: null };
    },
  });
  return { prompt, reads, result, digest: hashJsonValue({ prompt, reads: [...reads] }) };
}

describe("the round's blind rehearsals at an authoring review", () => {
  it("hands a review each rehearsal as the bytes submitted and the one verdict, and names every field it carries", async () => {
    const { rehearsals } = await handed([rehearsal(1, "fail", WRONG, PROTECTED_A)]);
    expect(rehearsals).toHaveLength(1);
    expect(Object.keys(double<object>(rehearsals[0])).sort()).toEqual([
      "artifact",
      "current",
      "family",
      "ordinal",
      "taskId",
      "verdict",
    ]);
    expect(rehearsals[0]).toEqual({
      ordinal: 1,
      taskId: "t1",
      family: "single-part",
      verdict: "fail",
      artifact: WRONG,
      current: true,
    });
  });

  it("leaves the review's prompt digest unchanged when only protected verifier detail of a rehearsal changes", async () => {
    const a = await handed([rehearsal(1, "fail", WRONG, PROTECTED_A)]);
    const b = await handed([rehearsal(1, "fail", WRONG, PROTECTED_B)]);
    const [seenA, seenB] = [await shown(a.root, a.rehearsals), await shown(b.root, b.rehearsals)];
    expect(seenA.reads.get("rehearsal:1:t1")).toBe(WRONG);
    expect(seenA.digest).toBe(seenB.digest);
    for (const marker of MARKERS) {
      expect(seenA.prompt).not.toContain(marker);
      expect([...seenA.reads.values()].join("\n")).not.toContain(marker);
    }
  });

  it("moves the digest when the solver's bytes and their verdict move", async () => {
    const right = await handed([rehearsal(1, "pass", RIGHT)]);
    const wrong = await handed([rehearsal(1, "fail", WRONG)]);
    const [passed, failed] = [
      await shown(right.root, right.rehearsals),
      await shown(wrong.root, wrong.rehearsals),
    ];
    expect(passed.prompt).toContain("- rehearsal:1:t1 (single-part): pass.");
    expect(failed.prompt).toContain("- rehearsal:1:t1 (single-part): fail.");
    expect(passed.digest).not.toBe(failed.digest);
  });

  it("carries a failed firmware rehearsal to the reviewer's sources, outside the coverage its review is held to", async () => {
    const { root } = await handed([]);
    const kiln = {
      ordinal: 4,
      taskId: "uno-kiln-monitor",
      family: "arduino-uno",
      verdict: "fail",
      artifact: KILN_ARTIFACT,
      current: true,
    };
    const [bare, seen] = [await shown(root, []), await shown(root, [kiln])];
    expect(seen.prompt).toContain("Blind rehearsals this round");
    expect(seen.prompt).toContain("no check result, verifier output or failure location");
    expect(seen.prompt).toContain("- rehearsal:4:uno-kiln-monitor (arduino-uno): fail.");
    expect(seen.reads.get("rehearsal:4:uno-kiln-monitor")).toBe(KILN_ARTIFACT);
    expect(seen.reads.get("rehearsal:4:uno-kiln-monitor")).toContain("now16 - alarmHighAt) >= 600U");
    // The read is on the review's record, while its coverage counts the tree it is held to.
    expect(seen.result.reads).toContain("rehearsal:4:uno-kiln-monitor");
    expect(seen.result.coverage.files).toBe(bare.result.coverage.files);
  });

  it("says which rehearsals solved earlier bytes, and offers nothing to read for one that submitted nothing", async () => {
    const { root, rehearsals } = await handed([
      { ...rehearsal(1, "fail", WRONG), submitted: { ordinal: 1, artifact: WRONG, candidateId: "earlier" } },
      rehearsal(2, "not-run", null),
    ]);
    expect(rehearsals).toMatchObject([{ current: false }, { current: true, artifact: null }]);
    const seen = await shown(root, rehearsals);
    expect(seen.prompt).toContain(
      "- rehearsal:1:t1 (single-part): fail, solved against earlier bytes than the tree under review.",
    );
    expect(seen.prompt).toContain("- rehearsal:2:t1 (single-part): not-run, nothing submitted.");
    expect(seen.reads.get("rehearsal:2:t1")).toContain("refused: rehearsal:2:t1 is not in the inventory");
  });

  it("shows a review with no rehearsals nothing about them", async () => {
    const { root, rehearsals } = await handed([]);
    expect(rehearsals).toEqual([]);
    const seen = await shown(root, rehearsals);
    expect(seen.prompt).not.toContain("rehearsal");
    expect(seen.reads.size).toBe(0);
  });
});
