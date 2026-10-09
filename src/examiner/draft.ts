/**
 * Move 2 of a campaign that opens from a prompt: the Examiner drafts the exam.
 *
 * Until 2026-10-09 a campaign could open only over a pack a v1 Builder had written, which four
 * flags named, and three such packs existed (`docs/plan.md`, row F53). Here the operator's prompt
 * names a domain, and one session drafts what a campaign needs before its first task is solved:
 * the public rules, each with the source that states it, the answer format, one check for each
 * rule, a few example tasks, and controls, which are answers to those examples with a known label.
 *
 * The session puts a whole draft to the host, and the host reads it without a model
 * (`DraftRequest.reading`): its shape, then every control through the checks, twice, and the
 * smallest answer the format allows on every example. It tells the Examiner the faults, and the
 * Examiner puts the draft again. A draft with no fault stands: it goes into the log whole, as
 * `exam.drafted`, and the session ends. The campaign reads its exam from that event.
 *
 * What the reading cannot say is whether a rule is the field's and its source real. The source
 * is on record beside the rule for a person to look up, and the host holds a draft only to
 * naming one (row F33).
 *
 * Every check a draft holds is its author's own computation, since nothing installs an engine of
 * the field for a campaign yet. The acceptance reading lists each such check as a fault until the
 * operator admits it by name (`tools/c/accept.ts --admit`), so a drafted exam is frozen on the
 * operator's word and never by this session (`AGENTS.md`, rule 10).
 *
 * The Examiner is told the prompt, its limits and what the host found in each draft. It is told
 * nothing of a harness, a solver, a budget or a count of tasks: none exists yet, and an author
 * told a target writes towards it.
 */
import {
  type AgentMessage,
  type AgentTool,
  runAgentLoop,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  type Api,
  type AssistantMessage,
  createInitialSystemMessage,
  type Model,
  type Models,
  type ThinkingLevel,
  toToolDeclaration,
  type Usage,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { REPORTED_COST } from "../backends/claude.ts";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../kernel/meter.ts";
import { mkdtempSync, rmSync } from "../meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../meta/json-runtime.ts";
import { asRecord, isNumber, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { tmpdir } from "../meta/os.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { plural } from "../meta/text.ts";
import { text, tool } from "../solve/answer.ts";
import { failedTurn, loopCompaction, traceSink } from "../solve/run.ts";

/** A rule of the contract as its author states it: the requirement, and where the field states it. */
interface DraftedRule {
  readonly id: string;
  readonly statement: string;
  readonly source: string;
}

/** An exam as an Examiner drafts it and `exam.drafted` holds it. */
export interface Draft {
  readonly domain: string;
  /** What a task in this domain may ask. */
  readonly scope: string;
  /** What a practitioner takes as given: units, rounding, notation. */
  readonly conventions: string;
  readonly rules: readonly DraftedRule[];
  /** The JSON Schema every answer follows. */
  readonly answerFormat: JsonValue;
  /** One check a rule: its id, the rule it enforces, and the property it verifies, in words. */
  readonly checks: readonly { readonly id: string; readonly rule: string; readonly assertion: string }[];
  /** The check program's source: a module that exports `checks`, a function for each check id. */
  readonly evaluator: string;
  /** The example tasks, which are the exam's first. */
  readonly tasks: readonly {
    readonly family: string;
    readonly publicInput: JsonValue;
    readonly hidden: JsonValue;
  }[];
  /** Controls, by the example each answers: answers every check passes, and answers the named
   *  check refuses. */
  readonly accept: readonly { readonly task: number; readonly answer: JsonValue }[];
  readonly reject: readonly { readonly task: number; readonly answer: JsonValue; readonly check: string }[];
}

interface DraftLimits {
  readonly wallSeconds: number;
  readonly turns: number;
  /** Drafts the session may put to the host's reading. */
  readonly tries: number;
}

interface DraftRequest {
  /** Names the session in the log. */
  readonly id: string;
  /** The operator's prompt, as the campaign's opening holds it. */
  readonly prompt: string;
  /** What the host reads of a draft without a model: its shape (`draftFaults`), and then its
   *  controls through its checks. One sentence a fault, none where the draft stands. */
  readonly reading: (draft: Draft) => Promise<readonly string[]>;
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly limits: DraftLimits;
  /** The backends, built on the home the Examiner's model process keeps its state in. */
  readonly models: (home: string) => Models;
  readonly log: string;
  /** Aborts when the run is killed. */
  readonly kill?: AbortSignal;
}

export interface Drafted {
  /** Whether a draft of this session stands as the campaign's exam. */
  readonly stands: boolean;
  /** The drafts it put to the host. */
  readonly tries: number;
  readonly ended: "stands" | "finished" | "wall" | "turns" | "killed" | "crashed" | "stopped";
}

/** What a session's tools share. */
interface Desk {
  readonly request: DraftRequest;
  tries: number;
  stands: boolean;
  note: string | null;
}

/** The fewest example tasks a draft holds: the reading needs each check seen to pass and to
 *  refuse, and the campaign's first practice tasks are drawn from them. */
const EXAMPLES = 3;
const ENDINGS = ["stands", "finished", "killed", "wall", "crashed", "turns"] as const;
/** What a check program may not spell: a way out of its argument, or a value that differs from
 *  one run to the next. A check that read its host's files or its clock would give one answer two
 *  verdicts on two hosts. The verifier's wall is what confines a check, and it is not the same on
 *  every host; this is what the host can say of the source before it runs. */
const OUTSIDE = [
  [/^\s*import\s|\bimport\s*\(|\brequire\s*\(/m, "an import"],
  [/\b(?:Bun|process)\s*\./, "the runtime's own objects"],
  [/\bfetch\s*\(/, "the network"],
  [/\bMath\s*\.\s*random\b|\bDate\s*\.\s*now\b/, "a random number or the clock"],
] as const;
const NUDGE = "You have not called finish. Put a draft with draft_exam, or call finish.";

const SYSTEM_PROMPT = [
  "You are the Examiner. An operator has named a technical domain in a prompt, and you draft the exam on which a solving model will be measured in that domain: its public rules, its answer format, one check for each rule, a few example tasks, and controls. You do this once, at the opening of a campaign. Later sessions write further tasks against what you draft here, and a draft that stands is not changed afterwards.",
  "A task is a family, a public input, which with the public rules is all a solver reads, and hidden values, which only the checks receive. A solver answers a task with one JSON value that follows the answer format. A check is a program that reads one answer with its task and returns whether the answer keeps one rule, and an answer every check passes is valid. Two sets of tools for the solver are then compared by how many valid answers each gives on tasks neither has seen. No reference answer exists for those tasks, so a check has to be right on a task nobody has solved: it verifies the property its rule states, and never compares an answer with one you worked out.",
  "Take the rules from the field's own public standard, and give each its source: the standard, specification, reference manual or textbook that states it, named precisely enough to look up. A limit, state or duty the field does not hold measures your wording and no solver, so add none. A solver that follows every public rule must never be rejected for something it could not read: whatever a check enforces is stated in a rule, the scope or the conventions, with its units and tolerances, and nothing a solver needs is in the hidden values. Choose rules that can act together on one answer, so that a task can make meeting one spend the margin another needs.",
  "Write one check for each rule, and no other. The check program is one TypeScript module that exports `checks`, an object with a function under each check id. A function takes one argument, `request`, and returns a boolean, or a promise of one: `request.publicTask` is `{ taskId, family, publicInput }`, `request.artifact` is the answer, and `request.hidden` is the task's hidden values. It runs offline in a closed cell and imports nothing, so it computes from its argument alone, and the same answer always gets the same verdict. It returns true where the answer keeps its rule and false where it breaks it. An answer that breaks another rule is that rule's check's to refuse. It does not throw on any answer the format allows.",
  `Give at least ${plural(EXAMPLES, "example task")}, different in what they ask and not only in their numbers. Either every task carries hidden values or none does. For each example give one accept control: an answer that keeps every rule. You choose the task, so you can start from an answer and derive the task from it. For each check give at least one reject control: an answer to an example that follows the answer format, breaks that check's rule, and names the check. The smallest answer the format allows, such as empty strings and empty lists, has to be rejected on every task: where it would pass, the format or the rules ask too little.`,
  "draft_exam puts a whole draft to the host, which reads it without a model: its shape, then every control through the checks, twice, and the smallest answer on every example. It returns the faults it found, or that the draft stands. A draft that stands is the campaign's exam, and the session ends there. When a draft has faults, mend them and put the whole draft again. Call finish only if no exam can be drafted for the prompt, and say why.",
].join("\n");

/** A name spelled twice among `ids`, or undefined. */
const twice = (ids: readonly string[]): string | undefined =>
  ids.find((id, index) => ids.indexOf(id) !== index);

/** What a draft's controls are short of or get wrong, one sentence each. */
function controlFaults(draft: Draft): string[] {
  // Only the format is read of it here: whether an answer follows it.
  const contract: Contract = { answerFormat: draft.answerFormat, conventions: "", rules: [], scope: "" };
  const controls = [
    ...draft.accept.map((each) => ({ ...each, named: "an accept control" })),
    ...draft.reject.map((each) => ({ ...each, named: `a reject control for ${each.check}` })),
  ];
  const placed = controls.flatMap(({ task, answer, named }) => {
    if (draft.tasks[task] === undefined) {
      return [
        `${named} names example ${String(task)}, and the examples are 0 to ${String(draft.tasks.length - 1)}`,
      ];
    }
    const unformed = answerFormatFault(contract, answer);
    return unformed === null
      ? []
      : [
          `${named} of example ${String(task)} does not follow the answer format (${unformed}): a solver's answer that does not is refused before any check reads it`,
        ];
  });
  return [
    ...placed,
    ...draft.tasks.flatMap((_, index) =>
      draft.accept.some(({ task }) => task === index)
        ? []
        : [`example ${String(index)} has no accept control: an answer to it that keeps every rule`],
    ),
    ...draft.checks.flatMap(({ id }) =>
      draft.reject.some(({ check }) => check === id)
        ? []
        : [`check ${id} has no reject control: an answer that breaks its rule and names it`],
    ),
    ...draft.reject.flatMap(({ check }) =>
      draft.checks.some(({ id }) => id === check)
        ? []
        : [`a reject control names ${check}, and the draft holds no such check`],
    ),
  ];
}

/**
 * What the host can say of a draft before anything runs, one sentence a fault: its shape. The
 * answer format's own fault comes first and alone, since nothing below reads without it.
 */
export function draftFaults(draft: Draft): string[] {
  if (asRecord(draft.answerFormat)?.type !== "object") {
    return [
      "the answer format is not a JSON Schema of type object: a solver's answer is one JSON object, which the schema describes",
    ];
  }
  const ruleIds = draft.rules.map(({ id }) => id);
  const checkIds = draft.checks.map(({ id }) => id);
  const again = twice(ruleIds) ?? twice(checkIds);
  const hidden = draft.tasks.filter((task) => task.hidden !== null).length;
  return [
    ...OUTSIDE.flatMap(([spelled, what]) =>
      spelled.test(draft.evaluator)
        ? [
            `the check program reaches for ${what}: a check computes from its request alone, so that one answer gets one verdict on every host`,
          ]
        : [],
    ),
    ...(again === undefined ? [] : [`${again} is named twice: an id names one rule or one check`]),
    ...draft.rules.flatMap(({ id, statement, source }) => [
      ...(statement.trim() === "" ? [`rule ${id} states nothing`] : []),
      ...(source.trim() === ""
        ? [`rule ${id} names no source: the standard, manual or text that states it`]
        : []),
      ...(draft.checks.filter((check) => check.rule === id).length === 1
        ? []
        : [
            `rule ${id} has ${String(draft.checks.filter((check) => check.rule === id).length)} checks, and each rule has one`,
          ]),
    ]),
    ...draft.checks.flatMap(({ id, rule }) => [
      ...(ruleIds.includes(rule) ? [] : [`check ${id} enforces ${rule}, and the draft holds no such rule`]),
      ...(draft.evaluator.includes(id)
        ? []
        : [`the check program names no ${id}: \`checks\` holds a function under each check's id`]),
    ]),
    ...(draft.tasks.length < EXAMPLES
      ? [
          `the draft holds ${plural(draft.tasks.length, "example task")}, and at least ${String(EXAMPLES)} are needed`,
        ]
      : []),
    ...(hidden === 0 || hidden === draft.tasks.length
      ? []
      : ["some examples carry hidden values and some carry none: either every task has them or none does"]),
    ...draft.tasks.flatMap(({ family, publicInput }, index) =>
      family.trim() === "" || publicInput === null
        ? [`example ${String(index)} has no family or no public input`]
        : [],
    ),
    ...controlFaults(draft),
  ];
}

function draftTool(desk: Desk): AgentTool {
  const { request } = desk;
  const control = {
    task: Type.Integer({
      minimum: 0,
      description: "The example it answers, by its place in `tasks`, from 0.",
    }),
    answer: Type.Unknown(),
  };
  return tool({
    name: "draft_exam",
    label: "Draft the exam",
    description:
      "Put a whole draft of the exam to the host's reading, which uses no model. It returns the faults it found, or that the draft stands. A draft that stands is the campaign's exam.",
    parameters: Type.Object({
      domain: Type.String({ minLength: 1, description: "The domain, in a few words." }),
      scope: Type.String({ minLength: 1, description: "What a task of this domain may ask." }),
      conventions: Type.String({
        description: "What a practitioner takes as given: units, rounding, notation.",
      }),
      rules: Type.Array(
        Type.Object({
          id: Type.String({ pattern: "^R[0-9]+$" }),
          statement: Type.String({ minLength: 1 }),
          source: Type.String({ minLength: 1, description: "Where the field states the rule." }),
        }),
        { minItems: 1 },
      ),
      answer_format: Type.Unknown({
        description: "A JSON Schema of type object, which every answer follows.",
      }),
      checks: Type.Array(
        Type.Object({
          id: Type.String({ pattern: "^check-[a-z0-9-]+$" }),
          rule: Type.String({ description: "The id of the one rule it enforces." }),
          assertion: Type.String({
            minLength: 1,
            description: "The property it verifies, in a sentence a solver may read.",
          }),
        }),
        { minItems: 1 },
      ),
      evaluator: Type.String({ minLength: 1, description: "The check program's TypeScript source." }),
      tasks: Type.Array(
        Type.Object({
          family: Type.String({ minLength: 1 }),
          public_input: Type.Unknown({ description: "What the solver reads of the task." }),
          hidden: Type.Unknown({ description: "What only the checks receive; null when a task has none." }),
        }),
      ),
      accept_controls: Type.Array(Type.Object(control)),
      reject_controls: Type.Array(
        Type.Object({ ...control, check: Type.String({ description: "The check that must refuse it." }) }),
      ),
    }),
    executionMode: "sequential",
    execute: async (_id, args) => {
      if (desk.tries >= request.limits.tries) {
        throw new Error("This session can put no further draft. Call finish.");
      }
      desk.tries += 1;
      const draft: Draft = {
        domain: args.domain,
        scope: args.scope,
        conventions: args.conventions,
        rules: args.rules,
        // SAFETY: a tool's arguments are JSON the provider parsed, here and for each value below.
        answerFormat: args.answer_format as JsonValue,
        checks: args.checks,
        evaluator: args.evaluator,
        tasks: args.tasks.map(({ family, public_input, hidden }) => ({
          family,
          // SAFETY: as above.
          publicInput: public_input as JsonValue,
          // SAFETY: as above.
          hidden: (hidden ?? null) as JsonValue,
        })),
        // SAFETY: as above.
        accept: args.accept_controls.map(({ task, answer }) => ({ task, answer: answer as JsonValue })),
        // SAFETY: as above.
        reject: args.reject_controls.map(({ task, answer, check }) => ({
          task,
          answer: answer as JsonValue,
          check,
        })),
      };
      const faults = await request.reading(draft);
      if (faults.length === 0) {
        append(request.log, "exam.drafted", {
          session: request.id,
          draft: parseJsonAs<JsonObject>(capturedJsonStringify(draft)),
        });
        desk.stands = true;
        return {
          ...text("The draft stands: it is the campaign's exam. The session ends here."),
          terminate: true,
        };
      }
      const left = request.limits.tries - desk.tries;
      return text(
        [
          `The draft does not stand. ${plural(faults.length, "fault")}:`,
          ...faults.map((fault) => `- ${fault}`),
          left > 0
            ? `Mend them and put the whole draft again. This session can put ${plural(left, "more draft")}.`
            : "This session can put no further draft. Call finish.",
        ].join("\n"),
      );
    },
  });
}

function finishTool(desk: Desk): AgentTool {
  return tool({
    name: "finish",
    label: "Finish",
    description: "End the session without an exam. Say in one or two sentences why none could be drafted.",
    parameters: Type.Object({ note: Type.String({ minLength: 1, maxLength: 700 }) }),
    executionMode: "sequential",
    execute: async (_id, args) => {
      desk.note = args.note.trim();
      return { ...text("Finished."), terminate: true };
    },
  });
}

/** The exam a log holds: the draft of its last `exam.drafted`, or null. */
export function draftOf(events: readonly LogEvent[]): Draft | null {
  const draft = asRecord(events.findLast(({ kind }) => kind === "exam.drafted")?.data.draft);
  // `exam.drafted` is written by `draftTool` alone, with a `Draft` under this key.
  return draft === null ? null : parseJsonAs<Draft>(capturedJsonStringify(draft));
}

export async function draftExam(request: DraftRequest): Promise<Drafted> {
  const { log, limits, model } = request;
  const began = performance.now();
  if (read(log).some(({ kind, data }) => kind === "draft.started" && data.session === request.id)) {
    throw new Error(`session ${request.id} is in the log already; a session's id names one session`);
  }
  const desk: Desk = { request, tries: 0, stands: false, note: null };
  append(log, "draft.started", {
    session: request.id,
    model: priceKey(model),
    effort: request.effort,
    limits: { ...limits },
    prompt: request.prompt,
  });
  const tools = [draftTool(desk), finishTool(desk)];
  const wall = new AbortController();
  // Aborted when the loop returns, whatever returned it, so the model's own process is closed.
  const done = new AbortController();
  const signal = AbortSignal.any([wall.signal, done.signal, ...(request.kill ? [request.kill] : [])]);
  const turns: AssistantMessage[] = [];
  const summaries: Usage[] = [];
  const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: Date.now() });
  const system = createInitialSystemMessage(SYSTEM_PROMPT, tools.map(toToolDeclaration));
  // A name every solver's wall denies (`wall-policy.ts`): the Examiner's Claude Code keeps its
  // session here, the draft's checks and hidden values included.
  const home = mkdtempSync(join(tmpdir(), "ana-claude-cli-examiner-"));
  const over = () => desk.stands || desk.note !== null;
  let crash: string | null = null;
  const timer = setTimeout(() => wall.abort(), limits.wallSeconds * 1000);
  try {
    const models = request.models(home);
    const stream: StreamFn = (asked, context, options) => models.streamSimple(asked, context, options);
    const opening = `The operator's prompt:\n\n${request.prompt}\n\nThis session has ${plural(Math.round(limits.wallSeconds / 60), "minute")}, ${plural(limits.turns, "turn")} and ${plural(limits.tries, "draft")}.`;
    await runAgentLoop(
      [user(opening)],
      { messages: system === undefined ? [] : [system], tools },
      {
        model,
        reasoning: request.effort,
        sessionId: request.id,
        convertToLlm: (messages) => messages,
        toolExecution: "sequential",
        finishTurn: ({ message }) => {
          if (message.role === "assistant") turns.push(message);
          return over() || turns.length >= limits.turns ? { action: "end" } : undefined;
        },
        getFollowUpMessages: async () => (over() ? [] : [user(NUDGE)]),
        prepareRequest: loopCompaction(log, "draft", request.id, stream, summaries),
      },
      traceSink(log, "draft", request.id, () => turns.length),
      signal,
      stream,
    );
  } catch (error) {
    crash = errorMessage(error);
  } finally {
    clearTimeout(timer);
    done.abort();
    rmSync(home, { recursive: true, force: true });
  }
  const cut = wall.signal.aborted || request.kill?.aborted === true;
  crash ??= cut ? null : failedTurn(turns);
  const by = {
    stands: desk.stands,
    finished: desk.note !== null,
    killed: request.kill?.aborted === true,
    wall: wall.signal.aborted,
    crashed: crash !== null,
    turns: turns.length >= limits.turns,
  };
  const ended = ENDINGS.find((reason) => by[reason]) ?? "stopped";
  const tokens = tokensOf([...turns.map((turn) => turn.usage), ...summaries]);
  const reported = asRecord(
    turns.flatMap((turn) => turn.diagnostics ?? []).findLast((d) => d.type === REPORTED_COST)?.details,
  )?.totalCostUsd;
  append(log, "draft.finished", {
    session: request.id,
    ended,
    stands: desk.stands,
    tries: desk.tries,
    note: desk.note,
    crash,
    turns: turns.length,
    tokens: { ...tokens },
    ...dollars(freezePrices([model]), priceKey(model), tokens),
    reportedCost: isNumber(reported) ? reported : null,
    seconds: (performance.now() - began) / 1000,
  });
  return { stands: desk.stands, tries: desk.tries, ended };
}
