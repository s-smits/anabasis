import { type Static, Type } from "typebox";
import type { AgentTool } from "../agent/session.ts";
import { epochsOf, starterIn } from "../campaign/climb.ts";
import { budgetLeft, openingOf, type RevisionKind } from "../campaign/opening.ts";
import { comparisonsOf } from "../campaign/state.ts";
import { frozenChecker } from "../kernel/acceptance.ts";
import { hasJudge, type Objective, type RubricItem } from "../kernel/contract.ts";
import { eventsOf, isReferenceChange, type LogEvent, read, TRACE_KINDS } from "../kernel/log.ts";
import { lastReports, promoted } from "../kernel/reports.ts";
import { solvesIn, standsOf, verdictsOf } from "../kernel/solves.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { sameJsonValue } from "../meta/stable-json.ts";
import { ending, text, tool } from "../tools/answer.ts";
import {
  acceptFrom,
  CHECK_ITEM_SCHEMA,
  checksFrom,
  type Draft,
  draftFaults,
  draftOf,
  EVALUATOR_SCHEMA,
  rejectFrom,
  rubricFrom,
  type RubricLane,
  rubricItemSchema,
  TASK_FIELDS,
  tasksFrom,
  TEXT_FILES,
} from "./draft.ts";
import { fromHome } from "./shell.ts";

interface RevisionOutcome {
  readonly accepted: boolean;
  readonly message: string;
}

export type ReviseRunner = (input: {
  readonly session: string;
  readonly kind: RevisionKind;
  readonly why: string;
  readonly check?: string | undefined;
  readonly candidate: Draft;
  readonly home?: string | undefined;
}) => Promise<RevisionOutcome>;

const CONTROL_ADD = {
  task: Type.Integer({
    minimum: 0,
    description: "The example index in the full task list (existing examples followed by add_tasks).",
  }),
  answer: Type.Unknown(),
  files: TEXT_FILES,
};

const reviseParameters = (lane: RubricLane) =>
  Type.Object({
    kind: Type.Union([Type.Literal("tune"), Type.Literal("repair")], {
      description:
        '"tune" refines rubric items/weights, code scores, or adds checks/tools at a settled boundary; "repair" fixes a check with an effective Referee check-defect ruling.',
    }),
    why: Type.String({ minLength: 1, description: "Concise domain reason for the revision." }),
    check: Type.Optional(
      Type.String({
        pattern: "^check-[a-z0-9-]+$",
        description: 'Required when kind is "repair": the check id ruled check-defect.',
      }),
    ),
    checks: Type.Optional(
      Type.Array(CHECK_ITEM_SCHEMA, {
        minItems: 1,
        description:
          "Optional full check list preserving every inherited check's id, rule and assertion, while adding new checks or verifier tools. Omit to keep checks unchanged.",
      }),
    ),
    evaluator: Type.Optional(EVALUATOR_SCHEMA),
    objective_items: Type.Optional(
      Type.Array(rubricItemSchema(lane), {
        minItems: 1,
        description:
          lane === "judged"
            ? "Updated weighted [0, 1] rubric items (reweight, edit, add, or remove code/judge items). Omit to keep current objective items unchanged."
            : "Updated weighted [0, 1] deterministic code rubric items (reweight, edit, add, or remove code items). Omit to keep current objective items unchanged.",
      }),
    ),
    objective_tools: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "Updated verifier tool ids used by objective/scores. Omit to keep unchanged.",
      }),
    ),
    add_tasks: Type.Optional(
      Type.Array(Type.Object(TASK_FIELDS), {
        description: "Optional new example tasks appended after the inherited examples.",
      }),
    ),
    add_accept_controls: Type.Optional(
      Type.Array(Type.Object(CONTROL_ADD), {
        description: "Optional new accept controls appended after the inherited accept controls.",
      }),
    ),
    add_reject_controls: Type.Optional(
      Type.Array(Type.Object({ ...CONTROL_ADD, check: Type.String({ minLength: 1 }) }), {
        description: "Optional new reject controls appended after the inherited reject controls.",
      }),
    ),
  });
const REVISE_PARAMETERS_JUDGED = reviseParameters("judged");
const REVISE_PARAMETERS_CODE = reviseParameters("code-only");

type ReviseArgs = Static<typeof REVISE_PARAMETERS_JUDGED>;

export function candidateDraft(parent: Draft, args: ReviseArgs): Draft {
  const rubric: readonly RubricItem[] | undefined =
    args.objective_items === undefined ? parent.objective?.items : rubricFrom(args.objective_items);
  const objective: Objective | undefined =
    parent.objective === undefined
      ? undefined
      : {
          quantity: parent.objective.quantity,
          direction: parent.objective.direction,
          ...keyIfDefined("scale", rubric === undefined ? parent.objective.scale : ("unit" as const)),
          ...keyIfDefined("items", rubric),
        };
  const objectiveTools =
    args.objective_tools === undefined
      ? parent.objectiveTools
      : args.objective_tools.length > 0
        ? args.objective_tools
        : undefined;
  return {
    domain: parent.domain,
    scope: parent.scope,
    conventions: parent.conventions,
    rules: parent.rules,
    answerFormat: parent.answerFormat,
    checks: args.checks === undefined ? parent.checks : checksFrom(args.checks),
    // SAFETY: `fromHome` resolves any `{ from_file }` object to a string before this runs.
    evaluator: args.evaluator === undefined ? parent.evaluator : (args.evaluator as string),
    ...keyIfDefined("objective", objective),
    ...keyIfDefined("objectiveTools", objective === undefined ? undefined : objectiveTools),
    tasks: [...parent.tasks, ...tasksFrom(args.add_tasks ?? [])],
    accept: [...parent.accept, ...acceptFrom(args.add_accept_controls ?? [])],
    reject: [...parent.reject, ...rejectFrom(args.add_reject_controls ?? [])],
  };
}

const scoredBy = ({ objective, objectiveTools, checks }: Draft) => ({
  objective,
  objectiveTools,
  checks: checks.length,
});

export function revisionFaults(
  parent: Draft,
  candidate: Draft,
  kind: RevisionKind,
  check: string | undefined,
  args?: Pick<ReviseArgs, "objective_items">,
): string[] {
  const faults: string[] = [];
  if (parent.objective === undefined && args?.objective_items !== undefined) {
    faults.push("cannot introduce objective items on an exam frozen without an objective");
  }
  if (kind === "repair") {
    if (check === undefined) {
      faults.push("repair revision must name the check id in `check`");
    } else if (!parent.checks.some(({ id }) => id === check)) {
      faults.push(`check ${check} is not among the parent exam's checks`);
    }
    if (!sameJsonValue(scoredBy(parent), scoredBy(candidate))) {
      faults.push(
        "repair revision cannot change objective items, objective tools or the check list; use tune",
      );
    }
  }
  const byId = new Map(candidate.checks.map((entry) => [entry.id, entry]));
  for (const inherited of parent.checks) {
    const kept = byId.get(inherited.id);
    if (kept === undefined) {
      faults.push(`inherited check ${inherited.id} cannot be removed`);
      continue;
    }
    if (kept.rule !== inherited.rule) {
      faults.push(`inherited check ${inherited.id} must still enforce ${inherited.rule}`);
    }
    if (kept.assertion !== inherited.assertion) {
      faults.push(`inherited check ${inherited.id} cannot alter its public assertion`);
    }
  }
  if (sameJsonValue(parent, candidate)) {
    faults.push("revision makes no change to the parent exam");
  }
  return [...faults, ...draftFaults(candidate)];
}

export function defectSolvesFor(events: readonly LogEvent[], check: string): string[] {
  const stands = standsOf(events);
  const verdicts = verdictsOf(events);
  const reported = new Set(lastReports(events, "all").map(({ session }) => session));
  const solveComp = new Map(
    solvesIn(events).flatMap(({ id, start }) =>
      isString(start.comparison) ? [[id, start.comparison] as const] : [],
    ),
  );
  const matched = new Set<string>();
  for (const {
    event: { data },
  } of eventsOf(events, "referee.finding")) {
    const solve = isString(data.solve) ? data.solve : null;
    if (solve === null || stands.get(solve) !== "check-defect") continue;
    const comp = solveComp.get(solve);
    if (comp !== undefined && !reported.has(comp)) continue;
    const checker = verdicts.get(solve)?.checker;
    const blocking = checker?.kind === "fail" ? checker.blocking : [];
    const matchedCheck =
      data.check === check || (data.check == null && blocking.length === 1 && blocking[0] === check);
    if (matchedCheck) matched.add(solve);
  }
  return [...matched];
}

function hasPendingPromotion(events: readonly LogEvent[]): boolean {
  const reference = promoted(events);
  const starter = starterIn(events);
  const changedAt = events.findLastIndex(({ kind }) => isReferenceChange(kind));
  return comparisonsOf(events).some(
    ({ at, fresh, old, report }) =>
      at > changedAt &&
      report?.reading === "step" &&
      fresh !== reference &&
      fresh !== starter &&
      old === (reference ?? starter),
  );
}

export function revisionRefusal(
  events: readonly LogEvent[],
  input: {
    readonly kind: RevisionKind;
    readonly check?: string | undefined;
    readonly candidate?: Draft | undefined;
    readonly reviewer?: string | null | undefined;
    readonly requireReviewer?: boolean | undefined;
    readonly crossFamily?: ((reviewer: string, solver: string) => boolean) | undefined;
  },
): string | null {
  const opening = openingOf(events);
  if (opening?.revise === false) return "exam revision is disabled for this campaign (--no-revise)";
  const parent = draftOf(events);
  if (parent === null || frozenChecker(events) === null) {
    return "exam revision requires a drafted and frozen parent exam";
  }
  if (eventsOf(events, "exam.revised").length > 0) {
    return "exam has already been revised in this campaign";
  }
  if (comparisonsOf(events).some(({ reported }) => reported === null)) {
    return "cannot revise exam while a comparison is still open";
  }
  if (hasPendingPromotion(events)) {
    return "cannot revise exam while a promotion is pending";
  }
  const epochs = epochsOf(events);
  const current = epochs.at(-1);
  if (current?.starter_tally !== null && current?.confirmed === false) {
    return "cannot revise exam while an unconfirmed revert is pending";
  }
  if (
    input.kind === "tune" &&
    current !== undefined &&
    current.reference !== "starter" &&
    current.starter_tally === null &&
    current.confirmed !== true
  ) {
    return "starter confirmation is owed for the promoted reference before tuning; only a check-defect repair is permitted";
  }
  if (input.kind === "tune" && opening?.parent?.carried.tunedThisEpoch === true && epochs.length === 1) {
    return "this epoch already opened from a rubric tune; earn a promotion before tuning again, or use repair for a check-defect";
  }
  if (input.kind === "repair") {
    if (input.check === undefined || !parent.checks.some(({ id }) => id === input.check)) {
      return `repair requires naming an existing check id (${input.check ?? "none given"})`;
    }
    if (defectSolvesFor(events, input.check).length === 0) {
      return `no effective check-defect ruling on ${input.check} exists in reported reviews`;
    }
  }
  const left = budgetLeft(events, opening);
  if (left !== null && left.dollars < left.reserve) {
    return `remaining campaign budget ($${left.dollars.toFixed(2)}) is below the solve reserve ($${String(left.reserve)})`;
  }
  const reviewer = input.reviewer === undefined ? (opening?.seats.reviewer?.model ?? null) : input.reviewer;
  if (input.requireReviewer === true && reviewer === null) {
    return "exam revision requires a reviewer to audit the candidate before committing";
  }
  if (hasJudge(input.candidate?.objective)) {
    if (reviewer === null) return "judged rubric items require a cross-family reviewer";
    const solver = opening?.solver?.model ?? null;
    if (solver !== null && input.crossFamily !== undefined && !input.crossFamily(reviewer, solver)) {
      return `judged rubric items require a cross-family reviewer (reviewer ${reviewer}, solver ${solver})`;
    }
  }
  return null;
}

interface RevisionDesk {
  readonly request: { readonly id: string; readonly log: string };
  readonly home: string | undefined;
  revised: boolean;
}

export function revisionTools(
  desk: RevisionDesk,
  runRevise: ReviseRunner,
  lane: RubricLane = "judged",
): AgentTool[] {
  const parent = draftOf(read(desk.request.log, TRACE_KINDS));
  return parent === null ? [] : [readExamTool(parent), reviseTool(desk, parent, runRevise, lane)];
}

function readExamTool(draft: Draft): AgentTool {
  return tool({
    name: "read_exam",
    description:
      "Return the current frozen exam draft: checks, objective items/criteria, declared verifier tools, evaluator.ts source, and example/control counts.",
    parameters: Type.Object({}),
    execute: async () =>
      text(
        capturedJsonStringify({
          checks: draft.checks,
          objective: draft.objective ?? null,
          objectiveTools: draft.objectiveTools ?? [],
          examples: draft.tasks.length,
          acceptControls: draft.accept.map(({ task }) => task),
          rejectControls: draft.reject.map(({ task, check }) => ({ task, check })),
          evaluator: draft.evaluator,
        }),
      ),
  });
}

function reviseTool(desk: RevisionDesk, parent: Draft, runRevise: ReviseRunner, lane: RubricLane): AgentTool {
  return tool(
    fromHome(desk.home, {
      name: "revise_exam",
      description: `Propose a mid-campaign revision to the exam (kind "tune" for rubric/score/check refinement at settled boundaries, or "repair" for a check with an effective Referee check-defect ruling). Domain, scope, rules, conventions, answer format, objective quantity/direction/scale, inherited check assertions, and existing examples/controls stay fixed. Validated against readChecker, historical adjudicated witnesses, and an adversarial Referee audit before handing off to a successor campaign.`,
      parameters: lane === "judged" ? REVISE_PARAMETERS_JUDGED : REVISE_PARAMETERS_CODE,
      execute: async (args: ReviseArgs) => {
        const candidate = candidateDraft(parent, args);
        const faults = revisionFaults(parent, candidate, args.kind, args.check, args);
        if (faults.length > 0) {
          return text(
            [
              `The revision does not stand (${String(faults.length)} faults):`,
              ...faults.map((f) => `- ${f}`),
            ].join("\n"),
          );
        }
        const outcome = await runRevise({
          session: desk.request.id,
          kind: args.kind,
          why: args.why,
          check: args.check,
          candidate,
          home: desk.home,
        });
        if (!outcome.accepted) return text(outcome.message);
        desk.revised = true;
        return ending(text(outcome.message));
      },
    }),
  );
}
