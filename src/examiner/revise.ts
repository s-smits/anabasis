import { type Static, Type } from "typebox";
import type { AgentTool } from "../agent/session.ts";
import { read, TRACE_KINDS } from "../kernel/log.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { sameJsonValue } from "../meta/stable-json.ts";
import { ending, text, tool } from "../tools/answer.ts";
import {
  type Draft,
  DRAFT_PARAMETERS,
  type DraftArgs,
  draftedFrom,
  draftFaults,
  draftOf,
  type RubricLane,
} from "./draft.ts";
import { FROM_FILE, fromHome } from "./shell.ts";

export type ReviseRunner = (input: {
  readonly session: string;
  readonly why: string;
  readonly repair: string | undefined;
  readonly candidate: Draft;
  readonly home: string | undefined;
}) => Promise<{ readonly accepted: boolean; readonly message: string }>;

const reviseParameters = (lane: RubricLane) => {
  const { checks, evaluator, objective, tasks, accept_controls, reject_controls } =
    DRAFT_PARAMETERS[lane].properties;
  return Type.Object({
    why: Type.String({ minLength: 1, description: "The domain reason for the revision." }),
    repair: Type.Optional(
      Type.String({
        pattern: "^check-[a-z0-9-]+$",
        description: "The check a Referee ruled check-defect, when this revision repairs it; omit to tune.",
      }),
    ),
    checks: Type.Optional(checks),
    evaluator: Type.Optional(evaluator),
    objective: Type.Optional(objective),
    tasks: Type.Optional(tasks),
    accept_controls: Type.Optional(accept_controls),
    reject_controls: Type.Optional(reject_controls),
  });
};
const PARAMETERS = { judged: reviseParameters("judged"), "code-only": reviseParameters("code-only") };
type ReviseArgs = Static<typeof PARAMETERS.judged>;

export function candidateDraft(parent: Draft, args: ReviseArgs): Draft {
  const objective = { ...parent.objective, tools: parent.objectiveTools };
  const given = {
    domain: parent.domain,
    scope: parent.scope,
    conventions: parent.conventions,
    rules: parent.rules,
    answer_format: parent.answerFormat,
    checks: args.checks ?? parent.checks,
    evaluator: args.evaluator ?? parent.evaluator,
    objective: args.objective ?? objective,
    tasks: args.tasks ?? [],
    accept_controls: [...parent.accept, ...(args.accept_controls ?? [])],
    reject_controls: [...parent.reject, ...(args.reject_controls ?? [])],
  };
  // SAFETY: `draftedFrom` only reads its argument, so the parent's readonly fields may stand in for parsed ones.
  const drafted = draftedFrom(given as DraftArgs);
  return { ...drafted, tasks: [...parent.tasks, ...drafted.tasks] };
}

export function revisionFaults(parent: Draft, next: Draft, repair: string | undefined, lane: RubricLane) {
  const kept = new Map(next.checks.map((check) => [check.id, check]));
  const retuned =
    !sameJsonValue(parent.objective ?? null, next.objective ?? null) ||
    !sameJsonValue(parent.objectiveTools ?? null, next.objectiveTools ?? null) ||
    next.checks.length !== parent.checks.length;
  return [
    ...(repair !== undefined && retuned
      ? ["a repair touches only the check program; a rubric, objective tool or new check is a tune"]
      : []),
    ...parent.checks.flatMap(({ id, rule, assertion }) =>
      kept.get(id)?.rule === rule && kept.get(id)?.assertion === assertion
        ? []
        : [`inherited check ${id} must stay, enforcing ${rule} with its published assertion`],
    ),
    ...(sameJsonValue(parent, next) ? ["the revision makes no change to the exam"] : []),
    ...draftFaults(next, lane),
  ];
}

export const readExamTool = (log: string): AgentTool =>
  tool({
    name: "read_exam",
    description:
      "Return the frozen exam: checks, objective, verifier tools, evaluator source, and example and control counts.",
    parameters: Type.Object({}),
    execute: async () => {
      const draft = draftOf(read(log, TRACE_KINDS));
      if (draft === null) throw new Error("campaign holds no drafted exam");
      const { checks, objective = null, objectiveTools = [], evaluator } = draft;
      const acceptControls = draft.accept.map(({ task }) => task);
      const rejectControls = draft.reject.map(({ task, check }) => ({ task, check }));
      const shown = { checks, objective, objectiveTools, examples: draft.tasks.length, evaluator };
      return text(capturedJsonStringify({ ...shown, acceptControls, rejectControls }));
    },
  });

export function reviseTool(
  desk: {
    readonly request: { readonly id: string; readonly log: string };
    readonly home: string | undefined;
    revised: boolean;
  },
  runRevise: ReviseRunner,
  lane: RubricLane,
): AgentTool {
  return tool(
    fromHome(desk.home, {
      name: "revise_exam",
      description: `Revise the frozen exam mid-campaign: tune the rubric, scores or checks at a settled boundary, or repair a check a Referee ruled check-defect. Domain, scope, rules, conventions, answer format, inherited check assertions, examples and controls stay; \`checks\`, \`evaluator\` and \`objective\` replace the exam's own when given, and \`tasks\` and controls add to its own, numbered after the inherited examples. The candidate is read by the checker, replayed on past adjudicated answers and audited adversarially; once it stands, a successor campaign continues under it.${desk.home === undefined ? "" : ` ${FROM_FILE}`}`,
      parameters: PARAMETERS[lane],
      execute: async (args: ReviseArgs) => {
        const parent = draftOf(read(desk.request.log, TRACE_KINDS));
        if (parent === null) return text("Refused: campaign holds no drafted exam.");
        const candidate = candidateDraft(parent, args);
        const faults = revisionFaults(parent, candidate, args.repair, lane);
        if (faults.length > 0) {
          return text([`The revision does not stand:`, ...faults.map((fault) => `- ${fault}`)].join("\n"));
        }
        const { why, repair } = args;
        const outcome = await runRevise({
          session: desk.request.id,
          why,
          repair,
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
