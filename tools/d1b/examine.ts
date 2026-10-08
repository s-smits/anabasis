/**
 * One Examiner session over a campaign, the plan's D1b:
 *
 *   bun tools/d1b/examine.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session x-1 \
 *     --examiner claude/claude-opus-5-5 --strong claude/claude-opus-5-5
 *
 * The Examiner writes task instances against the pack's contract and checker. Both conditions run
 * the harness the campaign stands on, its last step's or the stored cycle's while none has stepped
 * (`src/kernel/ladder.ts`): the stronger one under `--strong`, the test one under the stored
 * cycle's model and effort, so the one thing the pair changes is the solver. The examples are the
 * pack's own tasks and the ones earlier sessions wrote, and the opening message says how each of
 * those stands against the solver now. `--reviewer` adds the Referee to a feasible task's test-side
 * fails, as an adviser: its check-defect rulings are noted beside the task's word.
 * `--referee-decides` lets one dispute the task. With a reviewer the Referee also reads the refusal
 * of a stronger solve that did not pass, one reading a task, and there it only ever notes.
 *
 * A task the stronger solve did not pass waits as a reach task. A session whose harness is another
 * than that solve ran under puts each such task to the stronger solver again before its Examiner
 * starts, each at the cost of one of the session's `--candidates`, and one that passes now is
 * handed to the Examiner for its controls. `--reach` is the most it tries again, by default half
 * the candidates, oldest first; the rest wait for the next session. `--reach 0` tries none.
 *
 * Every solve of the session, the stronger solver's and the measured one's, is held to the
 * campaign's limits: name the `--solve-minutes` and `--solve-turns` its rounds run under
 * (`tools/d2/limits.ts`), or the session's words are of another solver than the one a round
 * measures. `--minutes` and `--turns` are the Examiner's own.
 *
 * The session stops at `--feasible` tasks past gate 4 (the plan's 24), at `--candidates` instances
 * put to the stronger solver, or at its minutes and turns. The supply reading is printed from the
 * log, over every Examiner session the campaign holds.
 *
 * A task an earlier session of the campaign left past gate 3, with no controls written, is handed
 * to this one with the answer it was accepted on: its stronger solve is paid, and a new id for the
 * session is all a second try at its controls costs.
 *
 * Not run here: see `campaign.ts`.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { examine } from "#src/examiner/session.ts";
import { supply } from "#src/examiner/supply.ts";
import { read } from "#src/kernel/log.ts";
import { readBrief } from "#src/kernel/verify.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { parseArgs } from "#src/meta/process.ts";
import {
  carriable,
  frontier,
  openCampaign,
  reachOf,
  SCREENING_OPTIONS,
  screeningRule,
  stayAwake,
  writtenTasks,
} from "../d2/campaign.ts";
import { LIMITS_OPTIONS, limitsNamed } from "../d2/limits.ts";
import { modelNamed } from "../m0/stored-sweep.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string" },
    cycle: { type: "string" },
    bundle: { type: "string" },
    name: { type: "string" },
    session: { type: "string" },
    examiner: { type: "string" },
    "examiner-effort": { type: "string", default: "high" },
    strong: { type: "string" },
    "strong-effort": { type: "string" },
    reviewer: { type: "string" },
    "referee-decides": { type: "boolean", default: false },
    "reviewer-effort": { type: "string", default: "high" },
    feasible: { type: "string", default: "24" },
    candidates: { type: "string", default: "72" },
    minutes: { type: "string", default: "1440" },
    turns: { type: "string", default: "200" },
    ...SCREENING_OPTIONS,
    ...LIMITS_OPTIONS,
    reach: { type: "string" },
  },
});

async function main(): Promise<void> {
  const { root, sweep, cycle, bundle, name, session, examiner, strong } = values;
  if (
    root === undefined ||
    sweep === undefined ||
    cycle === undefined ||
    bundle === undefined ||
    name === undefined ||
    session === undefined ||
    examiner === undefined ||
    strong === undefined
  ) {
    throw new Error("name --root, --sweep, --cycle, --bundle, --name, --session, --examiner and --strong");
  }
  const campaign = await openCampaign({ root, sweep, cycle, bundle, name, limits: limitsNamed(values) });
  // The harness the campaign stands on: what is feasible and what is too easy are read against
  // where it is, and a reach task is tried again under it (`src/kernel/ladder.ts`).
  const harness = await frontier(campaign);
  const before = read(campaign.log);
  // Each reach task tried again costs a candidate's solve, so by default they take at most half of
  // the session's candidates and the Examiner is left room to write.
  const reach = Number(values.reach ?? Math.floor(Number(values.candidates) / 2));
  // SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
  const effort = (flag: string | undefined) => (flag ?? campaign.test.effort) as ThinkingLevel;
  const stronger = {
    model: modelNamed(strong),
    effort: effort(values["strong-effort"]),
    side: "strong",
  } as const;
  const reviewer = values.reviewer;
  const { referee } =
    reviewer === undefined
      ? { referee: undefined }
      : campaign.reviewers(campaign.reader(modelNamed(reviewer), effort(values["reviewer-effort"])));
  // The brief's rows in the verifier's reading and in the pack's are the same rows in the same order.
  const declared = readBrief(campaign.checks).truthChecks;
  stayAwake();
  const examined = await examine({
    id: session,
    contract: campaign.contract,
    checks: declared.map((check, index) => ({
      id: check.id,
      assertion: campaign.brief.truthChecks[index]?.assertion ?? "",
      families: check.execution.families,
    })),
    // The pack's tasks, and the ones earlier sessions wrote, which the opening message says the
    // standing of.
    examples: [...campaign.tasks, ...writtenTasks(before)],
    waiting: carriable(before).waiting,
    reach: reachOf(before, { harness: harness.digest, setting: campaign.setting(stronger) }).slice(0, reach),
    standsOn: { harness: harness.digest, setting: campaign.setting(campaign.test) },
    pack: campaign.pack,
    verify: campaign.verify,
    strong: (task, _version, kill) => campaign.solveOnce(task, harness, stronger, kill),
    test: (task, _version, kill) => campaign.solveOnce(task, harness, campaign.test, kill),
    screening: screeningRule(values),
    ...keyIfDefined("referee", referee),
    refereeDecides: values["referee-decides"],
    model: modelNamed(examiner),
    effort: effort(values["examiner-effort"]),
    limits: {
      wallSeconds: Number(values.minutes) * 60,
      turns: Number(values.turns),
      concurrency: campaign.limits.concurrency,
      candidates: Number(values.candidates),
      feasible: Number(values.feasible),
    },
    models: campaign.examiner,
    log: campaign.log,
  });
  console.log(JSON.stringify({ ended: examined.ended, feasible: examined.feasible.length }, null, 2));
  console.log(JSON.stringify(supply(read(campaign.log)), null, 2));
}

await main();
