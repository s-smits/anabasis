/**
 * What an authoring review hands the next authoring review of its round: the probes its findings
 * rested on, as the calls that ran and the checks they moved.
 *
 * A review starts with an empty probe state, and until this carry its orientation named no earlier
 * probe, so a demonstration the previous review executed was found again from scratch or not at
 * all. The carried line is the exact `probe_check` call, so re-checking it costs one probe rather
 * than the search that found it. It is a lead and never evidence of the review it is shown to: it
 * carries no probe number that review could cite, and a finding backed by it has to run it again.
 * Nothing of it reaches the Builder, because the next review is the only reader.
 */
import { join, relative } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { type EpochReviewEvidence, recordFindingTool } from "../src/review/epoch-review-findings.ts";
import { publicEpochReview } from "../src/review/epoch-review-public.ts";
import { runEpochReview } from "../src/review/epoch-reviewer.ts";
import { type Demonstrations, NOTHING_CARRIED, carriedDemonstrations } from "../src/review/review-carry.ts";
import type { ReviewProbeRow } from "../src/review/review-probe.ts";
import type { ReaderTool } from "../src/review/review-reader.ts";
import { keyIfNotNull } from "../src/meta/optional-key.ts";
import { authoringReviewText } from "../src/run/harness-build.ts";
import { required } from "./helpers/doubles.ts";
import { CITATIONS, DEMO, call, reviewState } from "./helpers/review-fixtures.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { uppercaseFixture } from "./helpers/uppercase-fixture.ts";

const SLUG = "matching";
const REQUEST = "Uppercase the public input.";
/** A replacement the uppercase check refuses, distinctive enough to search every text for. */
const MARKER = '"lowercase-probe-marker"';

const review = {
  enabled: true,
  kind: "codex",
  model: "gpt-6-astra",
  reasoningEffort: "low",
  source: "operator",
} as const;

/** The mass finding as that review recorded it, citing the probes the rows below number 5 and 6. */
const MASS_FINDING = {
  defect: true,
  owner: "correctness-model/evaluator.ts",
  severity: "blocking",
  claim: "The mass checker weakens the published strict unrounded mass limit by 0.05 kg.",
  demonstration: DEMO,
  citations: CITATIONS,
  checkId: "catalogue-mass-budget",
  probeIds: [5, 6],
};

/** What one review's reader does with its tools and the prompt it was shown. */
type Step = (tools: ReadonlyMap<string, ReaderTool>, prompt: string) => Promise<void>;

afterAll(cleanupScratch);

/**
 * The seven probes authoring review 01a0c9e0 of fa03b7's truss-sol round 1 ran on one accept
 * control, as recorded: six of them bracket the mass the checker allows past its published limit,
 * and the blocking finding rested on the pair that bounds it, 5 and 6.
 */
function fa03b7Rows(): ReviewProbeRow[] {
  const pass = { outcome: "pass" as const, blockingCheckIds: [] };
  const mass = { outcome: "fail" as const, blockingCheckIds: ["catalogue-mass-budget"] };
  const rows: Array<[string, string, typeof pass | typeof mass]> = [
    ["$.design.joints[8].xMm", "2999.5", pass],
    ["$.design.joints[8].zMm", "3400.02", mass],
    ["$.design.joints[8].zMm", "3400.01", mass],
    ["$.design.joints[8].zMm", "3400.001", pass],
    ["$.design.joints[8].zMm", "3400.002", pass],
    ["$.design.joints[8].zMm", "3400.005", mass],
    ["$.design.joints[8].zMm", "3400.008", mass],
  ];
  return rows.map(([path, value, mutated], index) => ({
    id: index + 1,
    controlId: "accept-offset-corner-1",
    taskId: "offset-corner-1",
    path,
    change: { value },
    baseline: pass,
    mutated,
    applicableCheckIds: ["catalogue-mass-budget"],
    movedCheckIds: mutated === mass ? ["catalogue-mass-budget"] : [],
    refused: null,
  }));
}

/** A review whose state holds the fa03b7 rows and which has recorded the mass finding over them. */
async function massReview() {
  const state = reviewState();
  state.probes.rows.push(...fa03b7Rows());
  const tool = recordFindingTool([], [], "e", state, {
    identities: { schemaRoots: ["design"], checkIds: ["catalogue-mass-budget"] },
  });
  expect(await call(tool, MASS_FINDING)).toStartWith("recorded defect");
  return state;
}

/** The uppercase candidate: one declared check, `answer`, over accept controls it passes. */
function candidateTree(): string {
  // The tree sits one level inside its scratch directory, so the repository its review records
  // under (`${root}-repo`, beside it) is removed with it rather than left in `test/`.
  const dir = join(scratchDir(".ana-scratch-review-demonstrations-", import.meta.dir), "tree");
  uppercaseFixture(dir);
  return dir;
}

/** One authoring review over `root`, handed `demonstrations` when there are any, whose reader
 *  takes `step` and then ends with `error`. */
async function reviewed(
  root: string,
  runId: string,
  demonstrations: Demonstrations | null,
  step: Step,
  error: string | null = null,
) {
  let prompt = "";
  const result = await runEpochReview({
    // The review records itself under its campaign, which sits beside the tree it reads, as a
    // workspace snapshot does in production, so no review finds the last one in its inventory.
    repoRoot: `${root}-repo`,
    slug: SLUG,
    runId,
    treeRoot: relative(`${root}-repo`, root),
    analysis: null,
    priorAdvice: null,
    ...keyIfNotNull("demonstrations", demonstrations),
    review,
    publicRequest: REQUEST,
    readerTurn: async (input) => {
      prompt = input.prompt;
      await step(new Map(input.tools.map((tool) => [tool.name, tool])), input.prompt);
      return { pin: null, text: "", error };
    },
  });
  return { prompt, result };
}

const tool = (tools: ReadonlyMap<string, ReaderTool>, name: string) => required(tools.get(name), name);

/** One authoring review over a fresh candidate whose turn ends in a provider error after `step`. */
const failedReview = (step: Step) => reviewed(candidateTree(), "authoring-f", null, step, "provider stopped");

/** A finding on the uppercase check, citing the evaluator the reader has just read. */
async function answerFinding(tools: ReadonlyMap<string, ReaderTool>, probeIds: JsonValue[]) {
  await call(tool(tools, "read_source"), { path: "correctness-model/evaluator.ts" });
  return call(tool(tools, "record_finding"), {
    defect: true,
    owner: "correctness-model/evaluator.ts",
    severity: "advisory",
    claim: "The answer check refuses a lowercase answer, which the public rule also refuses.",
    citations: [{ path: "correctness-model/evaluator.ts", quote: "publicInput.input.toUpperCase()" }],
    checkId: "answer",
    probeIds,
  });
}

/** What the Builder is handed of a review, which the carried demonstrations must never reach. */
const builderText = (result: EpochReviewEvidence) =>
  authoringReviewText("repair", result.status, REQUEST, publicEpochReview(result, { brief: null }).findings)
    .text;

describe("the probes an authoring review rested its findings on, carried to the next one", () => {
  it("carries the probes a finding rested on, and no other, as the change that ran and the checks it moved", async () => {
    const state = await massReview();
    const carried = required(
      carriedDemonstrations({
        runId: "authoring-0",
        status: "completed",
        probes: state.probes.rows,
        findings: state.findings,
      }),
      "a finished review's demonstrations",
    );
    expect(carried.named).toEqual([{ checkId: "catalogue-mass-budget", severity: "blocking" }]);
    expect(
      carried.probes.map(({ path, change, movedCheckIds }) => ({ path, change, movedCheckIds })),
    ).toEqual([
      { path: "$.design.joints[8].zMm", change: { value: "3400.002" }, movedCheckIds: [] },
      {
        path: "$.design.joints[8].zMm",
        change: { value: "3400.005" },
        movedCheckIds: ["catalogue-mass-budget"],
      },
    ]);
  });

  it("carries nothing from a review that recorded no findings, so the previous review's set stands", async () => {
    const { probes } = await massReview();
    for (const status of ["failed", "skipped"]) {
      expect(
        carriedDemonstrations({ runId: "authoring-0", status, probes: probes.rows, findings: [] }),
      ).toBeNull();
    }
    // A review that finished, rested nothing on a probe and named no check ends the chain.
    expect(
      carriedDemonstrations({
        runId: "authoring-0",
        status: "completed",
        probes: fa03b7Rows(),
        findings: [],
      }),
    ).toEqual(NOTHING_CARRIED);
    expect(carriedDemonstrations({ runId: "authoring-0", status: "incomplete", findings: [] })).toEqual(
      NOTHING_CARRIED,
    );
  });

  it("keeps a failed turn's admitted finding and routes it as an incomplete review's", async () => {
    const { result } = await failedReview(async (tools) => {
      expect(await answerFinding(tools, [])).toBe("recorded defect as advisory");
    });
    expect(result.status).toBe("failed");
    expect(result.findings.map((finding) => finding.checkId)).toEqual(["answer"]);
    const incomplete = { ...result, status: "incomplete" as const };
    expect(carriedDemonstrations(result)?.named).toEqual([{ checkId: "answer", severity: "advisory" }]);
    expect(carriedDemonstrations(result)).toEqual(carriedDemonstrations(incomplete));
    const contract = { brief: null };
    expect(publicEpochReview(result, contract)).toEqual(publicEpochReview(incomplete, contract));
  });

  it("records no finding from a failed turn whose one finding the host refused, so the previous set stands", async () => {
    const { result } = await failedReview(async (tools) => {
      const unowned = { defect: true, claim: "The answer check is wrong.", severity: "advisory" };
      expect(await call(tool(tools, "record_finding"), unowned)).toBe(
        "refused: a defect must name the bundle file at fault as its owner",
      );
    });
    expect(result.status).toBe("failed");
    expect(result.findings).toEqual([]);
    expect(carriedDemonstrations(result)).toBeNull();
  });

  it("shows the next review each carried probe as the call that re-runs it, and no probe number", async () => {
    const root = candidateTree();
    const mass = await massReview();
    const carried = required(
      carriedDemonstrations({
        runId: "authoring-0",
        status: "completed",
        probes: mass.probes.rows,
        findings: mass.findings,
      }),
      "carried rows",
    );
    const edit: ReviewProbeRow = {
      ...fa03b7Rows()[0]!,
      id: 7,
      path: "$.firmware['main.cpp']",
      change: { find: "hold >= 600U", replace: "" },
      movedCheckIds: [],
    };
    const nothing = async () => {};
    const [bare, empty, shown] = [
      await reviewed(root, "authoring-1", null, nothing),
      await reviewed(root, "authoring-1", NOTHING_CARRIED, nothing),
      await reviewed(root, "authoring-1", { ...carried, probes: [...carried.probes, edit] }, nothing),
    ];
    expect(bare.prompt).toBe(empty.prompt);
    expect(bare.prompt).not.toContain("probe_check {");
    expect(shown.prompt).toContain(
      '- probe_check {"controlId":"accept-offset-corner-1","path":"$.design.joints[8].zMm","value":"3400.002"}: no declared check moved.',
    );
    expect(shown.prompt).toContain(
      '- probe_check {"controlId":"accept-offset-corner-1","path":"$.design.joints[8].zMm","value":"3400.005"}: moved catalogue-mass-budget.',
    );
    expect(shown.prompt).toContain(
      `- probe_check {"controlId":"accept-offset-corner-1","path":"$.firmware['main.cpp']","find":"hold >= 600U","replace":""}: no declared check moved.`,
    );
    expect(shown.prompt).toContain("backs no finding");
    // The five probes no finding rested on stay behind, and so does every probe's old number.
    for (const value of ['"2999.5"', '"3400.02"', '"3400.01"', '"3400.001"', '"3400.008"']) {
      expect(shown.prompt).not.toContain(value);
    }
    for (const number of ["probe 5", "probe 6", "probe 7"]) expect(shown.prompt).not.toContain(number);
  });

  it("re-runs a carried call as a probe of the review that ran it, and carries it on only when a finding rests on it again", async () => {
    const root = candidateTree();
    const first = await reviewed(root, "authoring-1", NOTHING_CARRIED, async (tools) => {
      const ran = await call(tool(tools, "probe_check"), {
        controlId: "accept-0",
        path: "$.answer",
        value: MARKER,
      });
      expect(ran).toContain("1 declared check moved: answer");
      expect(await answerFinding(tools, [1])).toStartWith("recorded defect");
    });
    const carried = required(carriedDemonstrations(first.result), "the first review's demonstrations");
    expect(
      carried.probes.map(({ controlId, change, movedCheckIds }) => ({ controlId, change, movedCheckIds })),
    ).toEqual([{ controlId: "accept-0", change: { value: MARKER }, movedCheckIds: ["answer"] }]);

    // The line is the call: the next review sends it back verbatim and it runs.
    const second = await reviewed(root, "authoring-2", carried, async (tools, prompt) => {
      const line = required(/^- probe_check (\{.*\}): /m.exec(prompt)?.[1], "a carried call");
      expect(await call(tool(tools, "probe_check"), parseJsonAs<Record<string, JsonValue>>(line))).toContain(
        "1 declared check moved: answer",
      );
      expect(await answerFinding(tools, [1])).toStartWith("recorded defect");
    });
    expect(second.result.probes?.map(({ change, movedCheckIds }) => ({ change, movedCheckIds }))).toEqual([
      { change: { value: MARKER }, movedCheckIds: ["answer"] },
    ]);
    expect(carriedDemonstrations(second.result)?.probes).toHaveLength(1);
    for (const { result } of [first, second]) {
      expect(builderText(result)).not.toContain("lowercase-probe-marker");
    }
  }, 120_000);

  it("lets a carried line back no finding by the number it ran under before", async () => {
    const root = candidateTree();
    const carried = required(
      carriedDemonstrations({
        runId: "authoring-0",
        status: "completed",
        probes: [
          {
            id: 1,
            controlId: "accept-0",
            taskId: "t0",
            path: "$.answer",
            change: { value: MARKER },
            baseline: { outcome: "pass", blockingCheckIds: [] },
            mutated: { outcome: "fail", blockingCheckIds: ["answer"] },
            applicableCheckIds: ["answer"],
            movedCheckIds: ["answer"],
            refused: null,
            cited: true,
          },
        ],
        findings: [],
      }),
      "carried rows",
    );
    const { prompt, result } = await reviewed(root, "authoring-3", carried, async (tools) => {
      expect(await answerFinding(tools, [1])).toStartWith("recorded defect");
    });
    expect(prompt).toContain(`"value":${JSON.stringify(MARKER)}}: moved answer.`);
    expect(result.probes).toBeUndefined();
    expect(result.findings[0]?.probes).toBeUndefined();
    expect(result.findings[0]?.claim ?? "").not.toContain("Executed probes");
    expect(carriedDemonstrations(result)?.probes).toEqual([]);
    expect(builderText(result)).not.toContain("lowercase-probe-marker");
  }, 120_000);

  // A Builder that deletes the check a blocking finding named leaves the carried probe pointing at a
  // check that moved and a finding with nothing to re-run against, and a reviewer shown the probe
  // alone reads the tree as repaired.
  it("says which check a carried finding or probe named that the brief under review no longer declares", async () => {
    const carried = carriedNaming("geometry", "response");
    expect(carried.named).toEqual([{ checkId: "geometry", severity: "blocking" }]);
    const { prompt } = await reviewed(candidateTree(), "authoring-4", carried, async () => {});
    expect(prompt).toContain(
      "Check geometry, which the previous review's blocking finding named, is no longer declared in this candidate's brief.",
    );
    expect(prompt).toContain(
      "Check response, which a carried probe moved, is no longer declared in this candidate's brief.",
    );
  });

  it("says nothing of a named check the brief under review still declares", async () => {
    const { prompt } = await reviewed(
      candidateTree(),
      "authoring-5",
      carriedNaming("answer", "answer"),
      async () => {},
    );
    expect(prompt).toContain(": moved answer.");
    expect(prompt).not.toContain("no longer declared");
  });
});

/** What a finished review carries when its one blocking finding named `findingCheck` and rested on
 *  a probe that moved `probeCheck`. */
function carriedNaming(findingCheck: string, probeCheck: string) {
  const probe: ReviewProbeRow = {
    ...fa03b7Rows()[0]!,
    controlId: "accept-0",
    path: "$.answer",
    movedCheckIds: [probeCheck],
    cited: true,
  };
  const finding = {
    owner: "correctness-model/evaluator.ts",
    defect: true,
    claim: "The check reads narrower than its published rule.",
    evidence: "e",
    checkId: findingCheck,
  } as const;
  return required(
    carriedDemonstrations({
      runId: "authoring-0",
      status: "completed",
      probes: [probe],
      findings: [finding],
    }),
    "carried",
  );
}
