import type { SeatTool } from "../agent/session.ts";
import { Type } from "typebox";
import { affords, openingOf } from "../campaign/opening.ts";
import { type AnswerFile, keepAnswerFiles, textFiles } from "../kernel/answer-files.ts";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import { acceptedAnswers, contentOf, proposalsOf, writtenTasks } from "../kernel/history.ts";
import { poolOf } from "../kernel/reports.ts";
import { append, CALL_KINDS, eventsOf, type LogEvent, read, TRACE_KINDS } from "../kernel/log.ts";
import type { Ending } from "../kernel/solve.ts";
import { solvesIn } from "../kernel/solves.ts";
import { packageGate as checkPackage, type TaskPackage, taskSets, taskVersion } from "../kernel/task.ts";
import { objectiveOf, scoresOf, type Task, type Verdict, type Verifier } from "../kernel/verify.ts";
import { capturedJsonStringify, decodedJsonText } from "../meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined, keysIf } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";
import { ending, text, tool } from "../tools/answer.ts";
import { TEXT_FILES } from "./draft.ts";
import { type CheckRow, firstMessage, type SolveBudget, systemPrompt, wakeMessage } from "./prompt.ts";
import { heard, measured } from "./record.ts";
import { FROM_FILE, fromHome, type Walls } from "./shell.ts";

interface Terms {
  readonly id: string;
  readonly log: string;
  readonly limits: { readonly wallSeconds: number; readonly turns: number; readonly puts: number };
  readonly contract: Contract;
  readonly checks: readonly CheckRow[];
  readonly tasks: readonly Task[];
  readonly wanted: number;
  readonly pack: (task: Task) => TaskPackage;
  readonly budget: SolveBudget | null;
  readonly verify: Verifier | null;
  readonly probe: {
    readonly tries: number;
    readonly solve: (task: Task, stop: AbortSignal) => Promise<Probed>;
  } | null;
}

interface Probed {
  readonly solve: string | null;
  readonly ending: Ending;
}

interface Desk {
  request: Terms;
  readonly stop: AbortSignal;
  proposed: number;
  tried: number;
  readonly seen: Map<string, "now" | "earlier">;
  readonly answered: Map<string, { readonly answer: JsonValue; readonly files?: readonly AnswerFile[] }>;
  readonly checked: Map<string, Task>;
  readonly planted: Set<string>;
  held: string[];
  refused: string[];
  readonly rest: (ended: "supplied") => Promise<string | null>;
  readonly home: string | undefined;
}

interface Lent {
  readonly stop?: AbortSignal;
  readonly within?: Within;
  readonly rest?: Desk["rest"];
  readonly home?: string | undefined;
}

const TASK_ADMISSION = "task.gate";
export const TRIES = 14;
const SPELLED = {
  family: Type.String({ minLength: 1 }),
  public_input: Type.Unknown(),
  hidden: Type.Unknown({ description: "Null when the task has none." }),
};
const NAMED = Type.String({ description: "The instance reference returned by try_answer in this session." });
const GIVEN = Type.Union([Type.Object(SPELLED), Type.Object({ reference: NAMED })], {
  description: "An instance in the shape of the existing tasks, or its checked reference.",
});
const FAILED = new Map([
  ["rejected", "not valid: the checks refused its answer"],
  ["turns-ended", "not valid: ended at its turns limit"],
  ["wall-ended", "not valid: ended at its deadline"],
  ["context-ended", "not valid: ended when its context ran out"],
  ["no-answer", "not valid: it gave no answer"],
  ["broken-harness", "not valid: the harness could not be opened"],
  ["flagged", "not valid: it called the task malformed"],
]);
type Within = <T>(action: () => Promise<T>) => Promise<T>;
const PLANTED =
  "it carries, whole, an answer that passed try_answer in this session: a planted answer is for try_answer alone, and no task holds one, in its public input or its hidden values";
const SUPPLIED = "The host has the tasks it needs. The session ends here.";
const MORE =
  "Noted. The host would take more tasks from this session. A second finish with nothing proposed since ends it.";

function carries(value: JsonValue, planted: ReadonlySet<string>): boolean {
  if (planted.has(hashJsonValue(value))) return true;
  const inner = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
  return inner.some((each) => carries(each, planted));
}

function instanceOf(
  taskId: string,
  given: { readonly family: string; readonly public_input: unknown; readonly hidden: unknown },
): Task {
  return {
    taskId,
    family: given.family,
    // SAFETY: a tool's arguments are JSON the provider parsed.
    publicInput: given.public_input as JsonValue,
    // SAFETY: as above.
    hidden: decodedJsonText((given.hidden ?? null) as JsonValue),
  };
}

function heldAs(request: Terms, events: readonly LogEvent[], candidate: Task): Task | undefined {
  const content = contentOf(candidate);
  return [...writtenTasks(events), ...request.tasks].find((task) => contentOf(task) === content);
}

function measureOf(contract: Contract, verdict: Verdict): JsonObject {
  const declared = contract.objective;
  const measure = objectiveOf(verdict);
  if (declared === undefined || measure === null) return {};
  const { quantity, direction, scale } = declared;
  const scores = scoresOf(verdict);
  return {
    objective: {
      quantity,
      direction,
      ...keyIfDefined("scale", scale),
      measure,
      ...keyIfDefined("scores", scores === null ? undefined : { ...scores }),
    },
  };
}

export const feasibleOf = (
  log: string,
  contract: Contract,
  verdict: Verdict,
  answer: JsonValue,
  files: readonly AnswerFile[] = [],
): JsonObject => ({
  answer,
  ...keysIf(files.length > 0, () => ({ files: keepAnswerFiles(log, files).map((file) => ({ ...file })) })),
  ...measureOf(contract, verdict),
});

function tried(verdict: Verdict): string {
  if (verdict.kind === "pass") {
    return "Every applicable check passed this answer.";
  }
  if (verdict.kind === "fail") {
    return `Refused by ${verdict.blocking.join(", ") || "no check: the answer was missing"}.`;
  }
  if (verdict.kind === "faulty") return `Check ${verdict.check} could not decide: ${verdict.reason}`;
  return `The checks could not run: ${verdict.reason}`;
}

function refusalOf(contract: Contract, task: TaskPackage, planted: ReadonlySet<string>): string | null {
  if (carries([task.publicInput, task.hidden], planted)) return PLANTED;
  const packaged = checkPackage(contract, task);
  return packaged.outcome === "refused" ? packaged.reason : null;
}

async function admitDraft(desk: Desk, instance: Task): Promise<string> {
  const { request } = desk;
  const { log, id: session, verify } = request;
  const task = request.pack(instance);
  const version = taskVersion(task);
  const { taskId, family, publicInput, hidden } = instance;
  append(log, "task.proposed", {
    version,
    taskId,
    session,
    task: { taskId, family, publicInput, hidden },
  });
  const reason = refusalOf(request.contract, task, desk.planted);
  const { answer, files } = desk.answered.get(contentOf(instance)) ?? {};
  const outcome = reason === null ? { outcome: "passed" } : { outcome: "refused", reason };
  append(log, TASK_ADMISSION, { version, gate: 1, ...outcome });
  if (reason !== null) {
    append(log, "task.state", { version, state: "refused", session });
    desk.refused.push(version);
    return `${taskId}: refused: ${reason}`;
  }
  desk.held.push(version);
  const held = `${taskId}: held out.`;
  if (verify === null || answer === undefined) return held;
  const verdict = await Promise.try(() => verify(instance, answer, undefined, files)).catch(
    (error: unknown): Verdict => ({ kind: "non-result", reason: errorMessage(error) }),
  );
  if (verdict.kind !== "pass") {
    return `${held} Author proof was not retained under this task id: ${tried(verdict)}`;
  }
  append(log, "task.feasible", {
    version,
    session,
    ...feasibleOf(log, request.contract, verdict, answer, files),
  });
  return held;
}

const supplied = (desk: Desk): boolean => desk.held.length >= desk.request.wanted;

function spent(desk: Desk): boolean {
  return desk.proposed >= desk.request.limits.puts;
}

function proposeTool(desk: Desk): SeatTool {
  const taken = (instance: Omit<Task, "taskId">, stop: AbortSignal): string | Task => {
    const content = contentOf(instance);
    const before = desk.seen.get(content);
    if (before === "now") return "An instance proposed before was not taken again.";
    if (before === "earlier") return "An instance an earlier session wrote was not taken again.";
    if (spent(desk)) return "An instance was not taken: this session can propose no further task.";
    if (stop.aborted) return "An instance was not taken: the session has ended.";
    desk.seen.set(content, "now");
    desk.proposed += 1;
    return { ...instance, taskId: `${desk.request.id}-${String(desk.proposed).padStart(3, "0")}` };
  };
  return tool(
    fromHome(desk.home, {
      name: "propose_tasks",
      description: `Put task instances to the host's gate. The gate reads the shape of each package: its family, its inputs, and that the checks have what they need to run on it. No solver is put to it there. Of each it says held out, or refused with its reason. A task held out is in the exam from then on, and a comparison scores no other.${filed(desk)}`,
      parameters: Type.Object({
        tasks: Type.Array(GIVEN, { minItems: 1 }),
      }),
      execute: async (args, _api, context) => {
        context.abortSignal?.throwIfAborted();
        const signal = desk.stop;
        if (supplied(desk)) throw new Error(SUPPLIED);
        if (spent(desk)) throw new Error("This session can propose no further task. Call finish.");
        const instances = args.tasks.map((given) => {
          if (!("reference" in given)) return taken(instanceOf("", given), signal);
          const checked = desk.checked.get(given.reference);
          return checked === undefined
            ? `Unknown instance reference ${given.reference}. Known references: ${desk.checked.size === 0 ? "none" : [...desk.checked.keys()].join(", ")}.`
            : taken(checked, signal);
        });
        const used = `${String(desk.proposed)} of ${plural(desk.request.limits.puts, "draft")} put to the gate in this session.`;
        const lines = await Promise.all(
          instances.map(async (instance) => (isString(instance) ? instance : admitDraft(desk, instance))),
        );
        const said = `${lines.join("\n")}\n${used}`;
        if (!supplied(desk)) return text(said);
        const woken = await desk.rest("supplied");
        return woken === null ? ending(text(`${said}\n\n${SUPPLIED}`)) : text(`${said}\n\n${woken}`);
      },
    }),
  );
}

function exampleTool(tasks: () => readonly Task[]): SeatTool {
  return tool({
    name: "read_example",
    description:
      "Return one task whole: its family, its public input and its hidden values. It serves the exam's tasks and every instance proposed in this campaign, this session's and those a gate refused among them.",
    parameters: Type.Object({
      task: Type.String({ description: "A task's or a draft's id." }),
    }),
    execute: async (args) => {
      const examples = new Map(tasks().map((task) => [task.taskId, task]));
      const example = examples.get(args.task);
      if (example === undefined) {
        throw new Error(`${args.task} is not one of the tasks: ${[...examples.keys()].join(", ")}`);
      }
      const { taskId, family, publicInput, hidden } = example;
      return text(capturedJsonStringify({ taskId, family, publicInput, hidden }));
    },
  });
}

function tryTool(desk: Desk, verify: Verifier): SeatTool {
  const { log, contract } = desk.request;
  const recordValidAnswer = (
    events: readonly LogEvent[],
    version: string,
    verdict: Verdict,
    answer: JsonValue,
    files: readonly AnswerFile[] | undefined,
  ) => {
    const sets = taskSets(events);
    const inExam =
      sets.held.includes(version) ||
      sets.released.includes(version) ||
      sets.states.get(version) === "disputed";
    if (
      inExam &&
      (!poolOf(events).feasible.has(version) ||
        acceptedAnswers(events, version).length === 0 ||
        "objective" in measureOf(contract, verdict))
    ) {
      append(log, "task.feasible", {
        version,
        session: desk.request.id,
        ...feasibleOf(log, contract, verdict, answer, files),
      });
    }
  };
  return tool(
    fromHome(desk.home, {
      name: "try_answer",
      description: `Run the checks on an instance with an answer of yours, and say which checks refuse it, or that none does. Return an instance reference for proposing this checked content without resending it. A try enters no task in the exam. Where the checks pass, the host keeps the answer on the exam side for the Referee, for a task held with that content before or after the try. A refused task stays refused. The gate's reading of the instance's package comes first, where it would refuse it.${filed(desk)}`,
      parameters: Type.Object({
        ...SPELLED,
        answer: Type.Unknown({ description: "An answer in the domain's answer format." }),
        files: TEXT_FILES,
      }),
      execute: async (args, _api, context) => {
        const candidate = instanceOf("try", args);
        // SAFETY: a tool's arguments are JSON the provider parsed.
        const answer = args.answer as JsonValue;
        const events = read(log, CALL_KINDS);
        const content = contentOf(candidate);
        const instance = heldAs(desk.request, events, candidate) ?? candidate;
        const packaged = checkPackage(contract, desk.request.pack(instance));
        const admission =
          packaged.outcome === "passed" ? "" : `The gate would refuse this instance: ${packaged.reason}\n`;
        if (context.abortSignal?.aborted === true) throw new Error("The session has ended.");
        const unformed = answerFormatFault(contract.answerFormat, answer);
        if (unformed !== null) {
          return text(
            `${admission}This answer does not follow the answer format, so a solver's answer like it is refused before any check reads it, and no check was run: ${unformed}`,
          );
        }
        const files = args.files === undefined ? undefined : textFiles(args.files);
        const verdict = await verify(instance, answer, undefined, files);
        desk.checked.set(content, instance);
        if (verdict.kind === "pass") {
          desk.answered.set(content, {
            answer,
            ...keyIfDefined("files", files),
          });
          desk.planted.add(hashJsonValue(answer));
          recordValidAnswer(events, taskVersion(desk.request.pack(instance)), verdict, answer, files);
        }
        const { objective } = measureOf(contract, verdict);
        const measure =
          isRecord(objective) && isNumber(objective.measure)
            ? ` By the objective it measures ${measured(objective.measure)}.`
            : "";
        return text(`${admission}${tried(verdict)}${measure}\nInstance reference: ${content}.`);
      },
    }),
  );
}

function formatSolveOutcome(ended: Ending, turns: number | null): string {
  if (ended.outcome === "non-result") return `could not run: ${ended.kind}`;
  if (ended.outcome === "flagged") return FAILED.get("flagged") ?? "not valid";
  if (ended.outcome === "fail") return FAILED.get(ended.kind) ?? "not valid";
  return `valid in ${turns === null ? "an unrecorded number of turns" : plural(turns, "turn")}`;
}

const capped = (probe: Terms["probe"]): number => Math.min(probe?.tries ?? 0, TRIES);

const filed = (desk: Desk): string => (desk.home === undefined ? "" : ` ${FROM_FILE}`);

function tryReferenceTool(desk: Desk, within: Within): SeatTool {
  return tool(
    fromHome(desk.home, {
      name: "try_reference",
      description: `Put an instance, or its checked reference, to fresh solves by the reference harness, as the system prompt's section on trying the reference says. A try enters no task in the exam.${filed(desk)}`,
      parameters: Type.Object({
        task: GIVEN,
        solves: Type.Integer({ minimum: 1, maximum: 2, description: "How many solves to run side by side." }),
      }),
      execute: async (args, _api, context) => {
        context.abortSignal?.throwIfAborted();
        const { request } = desk;
        const { probe } = request;
        const left = capped(probe) - desk.tried;
        if (probe === null || left <= 0) {
          throw new Error("This session has no try of the reference harness left.");
        }
        const given =
          "reference" in args.task ? desk.checked.get(args.task.reference) : instanceOf("", args.task);
        if (given === undefined) throw new Error("Unknown instance reference. try_answer returns one.");
        const instance = heldAs(request, read(request.log, TRACE_KINDS), given) ?? {
          ...given,
          taskId: `try-${contentOf(given).slice(0, 12)}`,
        };
        const solves = Math.min(args.solves, left);
        if (!affords(request.log, solves)) {
          throw new Error("The campaign's budget holds no reserve for these solves.");
        }
        const ran = await within(async () =>
          Promise.all(Array.from({ length: solves }, async () => probe.solve(instance, desk.stop))),
        );
        const ends = new Map(solvesIn(read(request.log, TRACE_KINDS)).map(({ id, end }) => [id, end]));
        const lines = ran.map((one, nth) => {
          const turns = one.solve === null ? undefined : ends.get(one.solve)?.turns;
          return `Solve ${String(nth + 1)}: ${formatSolveOutcome(one.ending, isNumber(turns) ? turns : null)}.`;
        });
        desk.tried += ran.filter((one) => one.ending.outcome !== "non-result").length;
        const used = `Solves of the reference harness used in this session: ${String(desk.tried)} of ${String(capped(probe))}; one that could not run uses none.`;
        return text([...lines, used].join("\n"));
      },
    }),
  );
}

function admittedDrafts(events: readonly LogEvent[]): Task[] {
  const admissions = new Set(eventsOf(events, TASK_ADMISSION).map(({ event }) => event.data.version));
  return proposalsOf(events).flatMap(({ version, task }) =>
    task !== null && admissions.has(version) ? [task] : [],
  );
}

export function writing(
  request: Terms,
  walls: Pick<Walls, "pinned"> | undefined,
  {
    stop = new AbortController().signal,
    within = async (action) => action(),
    rest = async () => null,
    home,
  }: Lent = {},
) {
  const { verify, probe } = request;
  const before = read(request.log, CALL_KINDS);
  const openedOn = (asked: Terms, events: readonly LogEvent[]) =>
    firstMessage(
      asked.contract,
      asked.checks,
      heard(events, asked.tasks),
      { ...asked.limits, tries: capped(asked.probe) },
      {
        brief: openingOf(events)?.prompt ?? null,
        budget: asked.budget,
      },
    );
  let told = openedOn(request, before);
  const desk: Desk = {
    request,
    stop,
    rest,
    home,
    proposed: 0,
    tried: 0,
    seen: new Map(admittedDrafts(before).map((task) => [contentOf(task), "earlier"] as const)),
    answered: new Map(),
    checked: new Map(),
    planted: new Set(),
    held: [],
    refused: [],
  };
  return {
    kind: "exam" as const,
    system: systemPrompt(probe === null ? "none" : "given"),
    get opening() {
      return told;
    },
    get started() {
      const asked = desk.request;
      return {
        limits: {
          wallSeconds: asked.limits.wallSeconds,
          turns: asked.limits.turns,
          proposals: asked.limits.puts,
          tasks: asked.wanted,
          tries: capped(asked.probe),
        },
        checks: asked.checks.map(({ id }) => id),
        examples: asked.tasks.map(({ taskId }) => taskId),
        engines: (walls?.pinned ?? []).map(({ name, sha256 }) => ({ name, sha256 })),
      };
    },
    tools: [
      proposeTool(desk),
      exampleTool(() => [...writtenTasks(read(desk.request.log, TRACE_KINDS)), ...desk.request.tasks]),
      ...(verify === null ? [] : [tryTool(desk, verify)]),
      ...(probe === null ? [] : [tryReferenceTool(desk, within)]),
    ],
    enters: "Nothing in your home enters the exam: a task enters it through propose_tasks alone",
    nudge: "Propose further tasks",
    finish: "End the session, with a sentence or two for the log on what you wrote.",
    get declined() {
      return spent(desk) ? null : MORE;
    },
    done: (): "supplied" | null => (supplied(desk) ? "supplied" : null),
    counted: () => ({ proposed: desk.proposed, held: desk.held, refused: desk.refused }),
    result: () => ({ puts: desk.proposed, held: desk.held, refused: desk.refused }),
    ask: (next: Terms) => {
      Object.assign(desk, { request: next, proposed: 0, tried: 0, held: [], refused: [] });
      const events = read(next.log, CALL_KINDS);
      told = openedOn(next, events);
      return wakeOn(events, next.tasks, { ...next.limits, tries: capped(next.probe) });
    },
  };
}

export function wakeOn(
  events: readonly LogEvent[],
  tasks: readonly Pick<Task, "taskId" | "family">[],
  told: Parameters<typeof wakeMessage>[1],
): string {
  const since = events.findLastIndex(({ kind }) => kind === "exam.started");
  return wakeMessage(heard(events, tasks, since), told);
}
