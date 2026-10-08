/**
 * One Examiner session over a campaign, the plan's D1b:
 *
 *   bun tools/d1b/examine.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session x-1 \
 *     --examiner claude/claude-opus-5-5 --strong claude/claude-opus-5-5
 *
 * The Examiner writes task instances against the pack's contract and checker. The stronger condition
 * is the campaign's harness under `--strong`; the test condition is the stored cycle's model and
 * effort on the same harness, so the one thing the pair changes is the solver. The pack's own tasks
 * are the examples. `--reviewer` adds the Referee to a feasible task's test-side fails, as an
 * adviser: its check-defect rulings are noted beside the task's word. `--referee-decides` lets one
 * dispute the task.
 *
 * The session stops at `--feasible` tasks past gate 4 (the plan's 24), at `--candidates` instances
 * put to the stronger solver, or at its minutes and turns. The supply reading is printed from the
 * log, over every Examiner session the campaign holds.
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
import { openHarness } from "#src/solve/harness.ts";
import { LIMITS, openCampaign, stayAwake } from "../d2/campaign.ts";
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
    screen: { type: "string", default: "3" },
    fails: { type: "string", default: "2" },
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
  const campaign = await openCampaign({ root, sweep, cycle, bundle, name });
  const harness = { dir: campaign.parent, digest: (await openHarness(campaign.parent)).digest };
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
    examples: campaign.tasks,
    pack: campaign.pack,
    verify: campaign.verify,
    strong: (task, _version, kill) => campaign.solveOnce(task, harness, stronger, kill),
    test: (task, _version, kill) => campaign.solveOnce(task, harness, campaign.test, kill),
    screening: { solves: Number(values.screen), fails: Number(values.fails) },
    ...keyIfDefined("referee", referee),
    refereeDecides: values["referee-decides"],
    model: modelNamed(examiner),
    effort: effort(values["examiner-effort"]),
    limits: {
      wallSeconds: Number(values.minutes) * 60,
      turns: Number(values.turns),
      concurrency: LIMITS.concurrency,
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
