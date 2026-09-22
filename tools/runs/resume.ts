/**
 * Continuing a campaign: the same one-line prompt, the same slot pins, the same turn budget, in the
 * same project.
 *
 * A fullrun cannot be suspended and picked up again — `pauseFinding` below states why, with its
 * source. What the operator actually wants after a run stops is the next run in the same project,
 * and the only honest way to produce it is from what the stopped run recorded: the launcher's own
 * receipt holds the prompt verbatim and the preset it came from, and the opening holds the slot
 * pins and the provider-turn cap. Nothing here composes a new prompt, adds a plan or edits a pin;
 * where the evidence is missing this refuses and names the missing file.
 *
 * The command it produces is the existing launcher, which already owns worktree creation,
 * credential capture, the preflight probe, the composed gate and detaching into the service
 * manager. This adds no second launch path.
 */
import {
  CONDITIONS,
  PRESETS,
  SLOTS,
  type Condition,
} from "../../.claude/skills/launch-run/scripts/options.ts";
import type { LaunchRecord } from "./discover.ts";
import type { OpeningFacts, SlotFacts } from "./evidence.ts";

interface ResumePlan {
  /** The launcher invocation, argv[0] first, ready to run from the main checkout. */
  command: string[];
  /** What each part of the plan was read from. */
  provenance: string[];
  /** Why the recorded condition could not be reproduced exactly, when it could not. */
  warnings: string[];
}

type ResumeResult = { ok: true; plan: ResumePlan } | { ok: false; missing: string[] };

const LAUNCHER = ".claude/skills/launch-run/scripts/launch.ts";

/** What a continuation needs, and the missing file when the evidence does not carry it. */
interface ResumeInputs {
  opening: OpeningFacts;
  launch: LaunchRecord;
  /** The one-line request, exactly as the launcher recorded it. */
  prompt: string;
  project: string;
}

function conditionMatches(slots: readonly SlotFacts[], name: Condition): boolean {
  const condition = CONDITIONS[name];
  return SLOTS.every((role, index) => {
    const slot = slots.find((candidate) => candidate.role === role);
    if (slot === undefined) return false;
    return (
      slot.kind === condition.kind &&
      slot.model === condition.model &&
      slot.effort === condition.efforts[index]
    );
  });
}

/** The condition name whose pins the opening actually recorded, or null when none matches. */
export function recordedCondition(slots: readonly SlotFacts[]): Condition | null {
  for (const name of Object.keys(CONDITIONS)) {
    // SAFETY: the names come from CONDITIONS itself, so each one is one of its keys.
    const candidate = name as Condition;
    if (conditionMatches(slots, candidate)) return candidate;
  }
  return null;
}

/** What the recorded fullrun argv carries for one flag, or undefined when it carries none. */
function recordedArg(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

/**
 * The four facts a continuation cannot be reconstructed without. Each refusal names the file that
 * would have carried it, so the operator can tell a missing receipt from a missing opening.
 */
function resumeInputs(
  opening: OpeningFacts | null,
  launch: LaunchRecord | null,
): { ok: true; inputs: ResumeInputs } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (opening === null) {
    missing.push("opening.json: the run recorded no opening to read pins and budget from");
  }
  if (launch === null) {
    missing.push(
      ".scratch/quick-run/launch.json: the launcher receipt holding the prompt verbatim is gone, and no other evidence records the prompt text",
    );
  }
  const prompt = launch === null ? undefined : recordedArg(launch.argv, "--prompt");
  if (launch !== null && prompt === undefined) {
    missing.push(`${launch.dir}/.scratch/quick-run/launch.json: the recorded argv carries no --prompt`);
  }
  if (opening === null || launch === null || prompt === undefined) return { ok: false, missing };
  const project = opening.projectId;
  if (project === null) return { ok: false, missing: ["opening.json: no project.id to continue"] };
  return { ok: true, inputs: { opening, launch, prompt, project } };
}

/**
 * The continuation for one run, reconstructed from its own recorded evidence.
 *
 * `--project` is what "resume with context" means here: a continuation is a new run inside the
 * campaign the stopped run belongs to, so it inherits that campaign's adopted product, its advice
 * packet and its recorded history.
 */
export function resumePlan(opening: OpeningFacts | null, launch: LaunchRecord | null): ResumeResult {
  const read = resumeInputs(opening, launch);
  if (!read.ok) return read;
  const { inputs } = read;
  const { launch: receipt, prompt, project } = inputs;

  const warnings: string[] = [];
  const fromOpening = recordedCondition(inputs.opening.slots);
  const condition = fromOpening ?? receipt.condition;
  if (fromOpening === null) {
    warnings.push(
      `the recorded slots match no named condition (${inputs.opening.slots.map((slot) => `${slot.role}=${slot.kind}/${slot.model}/${slot.effort}`).join(" ")}); the receipt's "${receipt.condition}" is used and the pins must be checked before spending`,
    );
  }
  if (condition === null) {
    return { ok: false, missing: ["opening.json and launch.json agree on no model condition"] };
  }
  // The recorded prompt decides, not the receipt's preset name. A preset whose text has since
  // changed in source no longer matches, and the continuation then passes the prompt verbatim
  // rather than today's wording under the old name.
  const preset = Object.entries(PRESETS).find(([, text]) => text === prompt)?.[0] ?? null;
  const cap = inputs.opening.cap;
  if (cap === null) return { ok: false, missing: ["opening.json: no providerResourceBudget.cap to reuse"] };
  if (receipt.budget !== null && receipt.budget !== String(cap)) {
    warnings.push(
      `the receipt asked for ${receipt.budget} provider turns and the opening recorded ${cap}; the opening's count is used`,
    );
  }

  const command = [
    "bun",
    LAUNCHER,
    preset ?? "custom",
    "--model",
    condition,
    "--budget",
    String(cap),
    "--project",
    project,
  ];
  if (preset === null) command.push("--prompt", prompt);
  // The launcher's own defaults are not the stopped run's condition. `--tasks` falls back to 25
  // and neither boundary has a default at all, so a continuation of a 60-task run stopped at a
  // soft wall silently became an unbounded 25-task one — a changed measurement condition under
  // the word "resume". Each is carried when the recorded argv holds it, under the launcher's
  // spelling of the same flag; `--expected-tasks` is always recorded, the two boundaries only
  // when the launch set them.
  const carried: string[] = [];
  const carry = (flag: string, recorded: string) => {
    const value = recordedArg(receipt.argv, recorded);
    if (value === undefined) return;
    command.push(flag, value);
    carried.push(`${flag} ${value}`);
  };
  carry("--tasks", "--expected-tasks");
  carry("--max-iterations", "--max-iterations");
  carry("--stop-after-ms", "--stop-after-ms");
  return {
    ok: true,
    plan: {
      command,
      provenance: [
        `prompt: ${preset === null ? "launch.json, passed verbatim" : `preset ${preset}, byte-identical to the recorded prompt`}`,
        `slots: opening.json modelSlots${fromOpening === null ? " (unmatched)" : ` = ${condition}`}`,
        `provider turns: opening.json providerResourceBudget.cap = ${cap}`,
        `project: opening.json project.id = ${project}`,
        `battery and boundary: ${carried.length === 0 ? "launch.json argv recorded none, so the launcher's defaults apply" : carried.join(", ")}`,
      ],
      warnings,
    },
  };
}

/**
 * Why there is no `pause`.
 *
 * Suspending the controller process does not suspend the work it has already paid for. A provider
 * turn is reserved and then started before the model call; `ControllerLedger.cancelCall` updates
 * only rows still in `reserved`, and `closeRun` refuses while any call is not `completed`. A
 * process stopped mid-call therefore leaves a started call charged and its run unclosable, and the
 * campaign lock stays held by a process that answers no signal. The supported shape is the soft
 * stop the controller already owns.
 */
export const PAUSE_FINDING = [
  "pause is not offered: a fullrun cannot be suspended and resumed without losing evidence.",
  "  src/run/controller-ledger.ts cancelCall — only a call still in `reserved` may be cancelled; a started call stays charged.",
  "  src/run/controller-ledger.ts closeRun — refuses while any call is not `completed`, so a run stopped mid-call cannot close.",
  "  A stopped process also keeps campaigns/<slug>/.controller.lock held while answering no signal.",
  "  Use instead: --stop-after-ms on the launch (src/run/full-run.ts softBoundaryTerminal, evaluated after a",
  "  completed round) which lets the round in flight finish and record, then `runs resume <runId>`",
  "  for the next run in the same project. A continuation is a new run in the same campaign, not a resumed process.",
].join("\n");
