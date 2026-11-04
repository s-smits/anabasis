/**
 * Move 2 of a campaign that opens from a prompt: the Examiner drafts the exam.
 *
 * A campaign opens either over a stored pack a v1 Builder wrote, which four flags name, or from a
 * prompt (`7f0add79:docs/plan.md`, row F53). Here the operator's prompt names a domain, and one session
 * drafts what a campaign needs before its first task is solved: the public rules, each with the
 * source that states it, the answer format, one check for each rule, a few example tasks, and
 * control answers, which are answers to those examples with a known label.
 *
 * The session is `examine`'s in its drafting mode (`session.ts`), and this file is what that mode
 * is made of (`drafting`): what the Examiner is told, the tool it puts a whole draft by, and the two
 * readings a draft is held to without a model. The first is its shape (`draftFaults`), which the
 * session reads itself, so no caller can let a draft out of shape stand. The second is the
 * caller's (`reading`, `tools/d2/exam.ts`): every control answer through the checks, twice, and the
 * smallest answer the format allows on every example. The Examiner is told the faults and puts the
 * draft again. A draft with no fault stands: it goes into the log whole, as `exam.drafted`, and the
 * session ends. The campaign reads its exam from that event (`draftOf`).
 *
 * Validation and acceptance stay together here because only drafting submits a whole exam
 * (28 October).
 *
 * What the readings cannot say is whether a rule is the field's and its source real. The source
 * is on record beside the rule for a person to look up, and the host holds a draft only to
 * naming one (row F33).
 *
 * Every check a draft holds is its author's own computation, since nothing installs an engine of
 * the field for a campaign yet. The acceptance reading lists each such check as a fault until the
 * operator admits it by name (`tools/c/accept.ts --admit`), so a drafted exam is frozen on the
 * operator's word and never by this session (`AGENTS.md`, rule 10). A campaign launched without
 * `--hitl` is that word for every check of its draft (`planOf`, `src/campaign/opening.ts`; the
 * operator, 16 October).
 *
 * The Examiner is told the prompt, its limits and what the host found in each draft. It is told
 * no count of tasks, since an author told a target writes towards it. Of the solver it is told one
 * measured fact, that it answers every time a task whose rules a lookup, a matching or a search
 * meets: on 16 October five fresh campaigns' task admissions refused 74 of 95 drafts, 67 of them as
 * answered in all three solves, and esp32-fresh-opus-zbook held out none in six sessions. Until
 * 31 October it was also told to choose rules that act together; both of that day's paired esp32
 * arms did, and the reference answered 34 of 35 of their first room solves validly, since a search
 * answers interacting rules as surely as separate ones.
 *
 * From 22 October to 1 November a draft with no fault was also solved before it stood, and the
 * Examiner was told, an example a line, how many solves were valid and their turns:
 * esp32-fresh-opus-stackedPR506 was told 3 of 3 valid on every example and put the same draft
 * again, in a reply that also said the same draft would stand and one put was left, so that case
 * shows no reading moving an Examiner either way. From 3 to 4 November (#585) the Starter Built
 * Harness solved each example and a draft it answered on every solve was refused: four jobstat
 * campaigns put 10 drafts, 60 of 60 example solves valid, three ended `exam` with nothing
 * compared, and the 6 drafts put again after a refusal grew 12% to 19% and left 36 of 36 solves
 * valid. #594 made that reading a note, but the note rode on the reply that
 * ends the session (`ending`, `src/tools/answer.ts`), which no model call reads, so it decided
 * nothing, while it cost $1.17 to $2.77 and up to half an hour a draft, and a session cut during
 * the solves lost a draft with no fault (truss, 3 November). So no solve runs at drafting: a draft
 * with no fault at either reading stands at once, and the A/A and the test read an easy exam's
 * comparisons. A reading told early, with puts to spare and no word that the same draft stands,
 * was never tried; that form is for paired drafting seats before it returns. The operator asked
 * for gates that trust a capable model, since a gate "too-strict" or wrongly tuned can bring down
 * a system that would otherwise do well.
 *
 * On 4 November the Examiner was told that a solver reads the whole public input in its first
 * message (`firstTurn`, `src/solver/prompt.ts`), and that its home holds the same task. That day it
 * was also told, for a while, that the ten jobstat drafts held their whole plan in their inputs; an
 * outside review read that as a course, since 5 of their 30 examples named no governing source and
 * were answered all the same, so the count stays here. `SOLVER` (`ladder.ts`) gives the data form
 * of its second place, read from JobBench's statistics tasks (4 November), and names the
 * contract's own invariants as what the data is checked against, so that a check of a defect in
 * the data enforces a stated rule. Whether either moves the drafts is for paired drafting seats.
 *
 * Where it has a shell (`shell.ts`) it is told what the shell is
 * and what the wall test found of the network, and not what to use it for. Nothing hidden
 * exists at drafting, and the wall closes the repository, where the log lies.
 *
 * It is told that the prompt's requirements stay in the exam at the strength the prompt states.
 * Until 27 October it was told only to take its rules from the field's standard and add no limit
 * the field does not hold: truss-fresh-opus-v064 was asked for trusses "within strict mass limits"
 * and drafted no check of mass, and the host's reading cannot see a requirement a draft leaves out
 * (lane 34 of the investigation of 27 October).
 *
 * It is shown the reach scale and its worked examples (`ladder.ts`, which keeps the record behind
 * them), and told that rules handing the solver the whole model, or met by matching a stated shape
 * or writing one exact text, cap every task at grade 2. Its fairness rule said until 31 October that
 * whatever a check enforces is stated, with no word on how, and both paired esp32 arms then drafted
 * rules restating the field's tables and formulas, whose examples passed 9 of 9 solves at 3 turns;
 * a rule now states its property and names the public standard that defines it.
 */
import { type Static, Type } from "typebox";
import { answerFormatFault, type Objective } from "../kernel/contract.ts";
import { LADDER } from "./ladder.ts";
import { budgetLine, type SolveBudget } from "./prompt.ts";
import { append, type LogEvent } from "../kernel/log.ts";
import { capturedJsonStringify, decodedJsonText, parseJsonAs } from "../meta/json-runtime.ts";
import { asRecord, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { plural } from "../meta/text.ts";
import { ending, text, tool } from "../tools/answer.ts";

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
  /** The check program's source: a module that exports `checks`, a function for each check id,
   *  and `objective` where the draft declares one. */
  readonly evaluator: string;
  /** The objective two valid answers are compared by, where the field has one: absent, two valid
   *  answers to one task are even. */
  readonly objective?: Objective;
  /** The example tasks, which are the exam's first. */
  readonly tasks: readonly {
    readonly family: string;
    readonly publicInput: JsonValue;
    readonly hidden: JsonValue;
  }[];
  /** Control answers, by the example each answers: answers every check passes, and answers the named
   *  check refuses. */
  readonly accept: readonly { readonly task: number; readonly answer: JsonValue }[];
  readonly reject: readonly { readonly task: number; readonly answer: JsonValue; readonly check: string }[];
}

/** The host's reading of a draft, a sentence each: faults, none where the draft stands, and notes
 *  the author is told beside them and the draft stands with. */
export interface DraftReading {
  readonly faults: readonly string[];
  readonly notes: readonly string[];
}

interface DraftingTerms {
  readonly limits: { readonly wallSeconds: number; readonly turns: number; readonly puts: number };
  readonly id: string;
  readonly log: string;
  /** The operator's prompt, as the campaign's opening holds it. */
  readonly prompt: string;
  /** The budget the exam's solves will be held to, as the campaign's setting names it. */
  readonly budget: SolveBudget;
  /** What the host reads of a draft whose shape holds: its control answers through its checks, and
   *  where those hold and the caller can solve, the starter's solves of its examples. `stop` is the
   *  session's, which ends those solves with it. */
  readonly reading: (draft: Draft, stop: AbortSignal) => Promise<DraftReading>;
}

/** The fewest example tasks a draft holds: the reading needs each check seen to pass and to
 *  refuse, and the campaign's first practice tasks are drawn from them. */
const EXAMPLES = 3;
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
const CONTROL = {
  task: Type.Integer({
    minimum: 0,
    description: "The example it answers, by its place in `tasks`, from 0.",
  }),
  answer: Type.Unknown(),
};
/** What `draft_exam` takes: a whole draft, in the words the Examiner is told. */
const DRAFT_PARAMETERS = Type.Object({
  domain: Type.String({ minLength: 1, description: "The domain, in a few words." }),
  // What a size fixed here costs is said where the scope is written. The second exam drafted
  // from a prompt (9 October) held every task to six rows and six columns, which its field
  // does not: the starter then answered 24 of 24 solves at the full limit whatever was
  // written, and the harness that read a step listed every candidate of a task that small.
  scope: Type.String({
    minLength: 1,
    description:
      "What a task of this domain may ask. It bounds every task written later, so a size it fixes for a task is the ceiling on how hard one can be made. Whatever the operator's prompt asks of an answer that no check here decides, such as a work product or a step of the work, is named here as not measured.",
  }),
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
  objective: Type.Optional(
    Type.Object(
      {
        quantity: Type.String({
          minLength: 1,
          description: "The quantity the check program computes of a valid answer, with its unit.",
        }),
        direction: Type.Union([Type.Literal("lower"), Type.Literal("higher")], {
          description: "Which way is better.",
        }),
      },
      {
        description:
          "The objective, where the field has one: a quantity every valid answer has, which practitioners minimise or maximise. Leave it out where the field has none.",
      },
    ),
  ),
  tasks: Type.Array(
    Type.Object({
      family: Type.String({ minLength: 1 }),
      public_input: Type.Unknown({ description: "What the solver reads of the task." }),
      hidden: Type.Unknown({ description: "What only the checks receive; null when a task has none." }),
    }),
  ),
  accept_controls: Type.Array(Type.Object(CONTROL)),
  reject_controls: Type.Array(
    Type.Object({ ...CONTROL, check: Type.String({ description: "The check that must refuse it." }) }),
  ),
});

/** The system prompt. */
const SYSTEM = [
  "You are the Examiner. An operator has named a technical domain in a prompt, and you draft the exam on which a solving model will be measured in that domain: its public rules, its answer format, one check for each rule, a few example tasks, and controls. You do this once, at the opening of a campaign. Later sessions write further tasks against what you draft here, and a draft that stands is not changed afterwards.",
  "A task is a family, a public input, which with the public rules is all a solver reads, and hidden values, which only the checks receive. A solver answers a task with one JSON value that follows the answer format. A check is a program that reads one answer with its task and returns whether the answer keeps one rule, and an answer every check passes is valid. Two harnesses for the solver are then compared on tasks neither has seen, scoring validity first and, between valid answers, the objective where the domain declares one. A check must also be right on a task with no known valid answer: it verifies the property its rule states, and never compares an answer with one you worked out.",
  "Take the rules from the field's own public standard, and give each its source: the standard, specification, reference manual or textbook that states it, named precisely enough to look up, and one that states the limit as your rule does: a nominal or typical value is no limit. A limit, state or duty the field does not hold measures your wording and no solver, so add none. A solver that follows every public rule must never be rejected for something it could not read: whatever a check enforces is stated in a rule, the scope or the conventions, with its units and tolerances, or is defined by a public standard a rule names, and nothing a solver needs is in the hidden values. Stating a rule means stating its property and naming what defines it, never restating the standard's tables and equations: the solver can look those up. A check holds its rule exactly: it allows no tolerance the rule does not state, so a check of a quantity a rule calls zero or absent refuses any trace of it. The solver measured on this exam is a capable model with a shell and time to compute: where the rules can be met by a lookup, a matching or a search over the cases they leave, it answers every task correctly every time, however tightly they bind the parts of one answer to each other, and the exam then measures nothing. It reads the whole public input in its first message, and its home holds the same task as public/task.json.",
  `How hard the exam can be is set here, by its rules and scope, before any task is written. ${LADDER}\n\nDraft rules and a scope under which tasks can be written at every grade of this scale that this field reaches. Rules that hand the solver the whole model, every equation and number it needs, and a scope that leaves out the effects that make the field hard, turn every task into writing that model once and searching it: grade 2, however the tasks are written. So does a rule a solver meets by matching a shape the scope spells out, or by writing the one exact text a rule gives. State each rule as the property the field decides, such as a bound that holds, a state the field's own engine reaches or a value that is tested before use, name the standard that defines the engine rather than restating its working, keep in scope the effects that decide answers near the limits, and leave the way to reach it to the solver.`,
  "The operator's prompt outranks your choice of rules. Every requirement it names, such as a limit, a quantity to meet or an analysis an answer has to pass, stays in the exam at the strength the prompt states, as a rule with its check, and a quantity it asks to minimise or maximise is the objective. Where no check can decide such a requirement from its argument alone, say so in the scope, and do not check a weaker property under its name.",
  "Where the field has an objective, a quantity every valid answer has and practitioners minimise or maximise, such as a mass, a cost or a length, declare it: two valid answers to one task are then compared by it, and a task on which both tools find a valid answer still tells them apart. The check program then also exports `objective`, a function that takes the same `request` and returns that quantity of the answer as a finite number, computed from the answer and the public input alone; it is told nothing hidden. A field with no such quantity declares none.",
  "Write one check for each rule, and no other. The check program is one TypeScript module that exports `checks`, an object with a function under each check id. A function takes one argument, `request`, and returns a boolean, or a promise of one: `request.publicTask` is `{ taskId, family, publicInput }`, `request.artifact` is the answer, and `request.hidden` is the task's hidden values. It runs offline in a closed cell and imports nothing, so it computes from its argument alone, and the same answer always gets the same verdict. It returns true where the answer keeps its rule and false where it breaks it. An answer that breaks another rule is that rule's check's to refuse. It returns false only where the answer breaks the rule: where its own computation cannot reach a verdict on an answer the format allows, such as a solver that does not converge, it throws, which drops the task as the check's defect instead of refusing the answer.",
  `Give at least ${plural(EXAMPLES, "example task")}, different in what they ask and not only in their numbers. Either every task carries hidden values or none does. For each example give one accept control: an answer that keeps every rule. You choose the task, so you can start from an answer and derive the task from it. For each check give at least one reject control: an answer to an example that follows the answer format, breaks that check's rule, and names the check. The smallest answer the format allows, such as empty strings and empty lists, has to be rejected on every task: where it would pass, the format or the rules ask too little.`,
  `draft_exam puts a whole draft to the host, which reads it without a model: its shape, then every control through the checks, twice, and the smallest answer on every example. It returns the faults it found, or that the draft stands. A draft that stands is the campaign's exam, and the session ends there. When a draft has faults, mend them and put the whole draft again. Call finish only if no exam can be drafted for the prompt, and say why.`,
].join("\n");

// The answer-format keys that name an object's fields other than `properties` (`unnamed`).
const NAMING = [
  "$ref",
  "allOf",
  "anyOf",
  "oneOf",
  "if",
  "dependentSchemas",
  "unevaluatedProperties",
  "patternProperties",
];

/** A name spelled twice among `ids`, or undefined. */
const twice = (ids: readonly string[]): string | undefined =>
  ids.find((id, index) => ids.indexOf(id) !== index);

/**
 * The fields an answer carries that its format leaves unnamed, as paths. A solver learns an
 * answer's fields from the format alone, so a check that reads one refuses a right answer spelled
 * another way. On 2 November esp32-fresh-opus-forkedPR569 drafted a `pwm` object with no
 * properties, its PWM check read `clk_div_q8` from it, and the Referee ruled all 8 rejections it
 * made check defects; of 159 drafted exams on record, 2 carried such a field, both esp32 PWM
 * settings. An accept control carries every field its checks need, so reading the controls
 * covers every check. A reference, a combination, a condition or a pattern counts as naming: until
 * the release review of 3 November the `anyOf` and `oneOf` options were read without the
 * `properties` beside them, which refused a sound "at least one of" format.
 */
function unnamed(schema: JsonValue | undefined, answer: JsonValue, path: string): string[] {
  const held = asRecord(schema);
  if (held === null || NAMING.some((key) => key in held)) return [];
  if (Array.isArray(answer)) return answer.flatMap((item) => unnamed(held.items, item, `${path}[]`));
  const properties = asRecord(held.properties) ?? {};
  const rest = asRecord(held.additionalProperties);
  return Object.entries(asRecord(answer) ?? {}).flatMap(([name, value]) => {
    const inner = name in properties ? properties[name] : rest;
    return inner === null ? [`${path}.${name}`] : unnamed(inner, value, `${path}.${name}`);
  });
}

/** What a draft's controls are short of or get wrong, one sentence each. */
function controlFaults(draft: Draft): string[] {
  const controls = [
    ...draft.accept.map((each) => ({ ...each, named: "an accept control", accept: true })),
    ...draft.reject.map((each) => ({ ...each, named: `a reject control for ${each.check}`, accept: false })),
  ];
  const placed = controls.flatMap(({ task, answer, named, accept }) => {
    if (draft.tasks[task] === undefined) {
      return [
        `${named} names example ${String(task)}, and the examples are 0 to ${String(draft.tasks.length - 1)}`,
      ];
    }
    const unformed = answerFormatFault(draft.answerFormat, answer);
    if (unformed !== null) {
      return [
        `${named} of example ${String(task)} does not follow the answer format (${unformed}): a solver's answer that does not is refused before any check reads it`,
      ];
    }
    const loose = accept ? [...new Set(unnamed(draft.answerFormat, answer, "$"))] : [];
    return loose.length === 0
      ? []
      : [
          `${named} of example ${String(task)} carries ${loose.join(", ")}, which the answer format does not name: a solver learns an answer's fields from the format alone, so a check that reads one refuses a right answer spelled another way`,
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
    ...(draft.objective !== undefined && !/\bobjective\b/.test(draft.evaluator)
      ? [
          "the draft declares an objective and the check program exports no `objective`: a function of the request that returns the quantity as a number",
        ]
      : []),
    ...draft.tasks.flatMap(({ family, publicInput }, index) =>
      family.trim() === "" || publicInput === null
        ? [`example ${String(index)} has no family or no public input`]
        : [],
    ),
    ...controlFaults(draft),
  ];
}

/** The draft as `draft_exam`'s arguments carry it, under the names `Draft` and `exam.drafted` use. */
function draftedFrom(args: Static<typeof DRAFT_PARAMETERS>): Draft {
  return {
    domain: args.domain,
    scope: args.scope,
    conventions: args.conventions,
    rules: args.rules,
    // SAFETY: a tool's arguments are JSON the provider parsed, here and for each value below.
    answerFormat: args.answer_format as JsonValue,
    checks: args.checks,
    evaluator: args.evaluator,
    ...keyIfDefined("objective", args.objective),
    tasks: args.tasks.map(({ family, public_input, hidden }) => ({
      family,
      // SAFETY: as above.
      publicInput: public_input as JsonValue,
      // SAFETY: as above.
      hidden: decodedJsonText((hidden ?? null) as JsonValue),
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
}

/** The exam a log holds: the draft of its last `exam.drafted`, or null. */
export function draftOf(events: readonly LogEvent[]): Draft | null {
  const draft = asRecord(events.findLast(({ kind }) => kind === "exam.drafted")?.data.draft);
  // `exam.drafted` is written by `drafting` alone, with a `Draft` under this key.
  return draft === null ? null : parseJsonAs<Draft>(capturedJsonStringify(draft));
}

/** The drafting mode as `examine` seats it (`session.ts`): what the session is told, the
 *  tool it puts a draft by, the shape a draft is held to before the caller's reading, and the event
 *  a draft that stands is kept in. The reading runs `within` the session's clock, which pauses for
 *  it: its starter solves are the host's time. On 3 November a truss session put its first draft at
 *  44 of its 60 minutes, and the clock ended it during the solves, so the draft got no reading and
 *  still counted as one of the campaign's tries. */
export function drafting(
  terms: DraftingTerms,
  stop: AbortSignal,
  within: <T>(action: () => Promise<T>) => Promise<T>,
) {
  const { limits } = terms;
  const kind = "draft";
  const desk = { tries: 0, stands: false };
  const none = `This session can put no further ${kind}. Call finish.`;
  const put = tool({
    name: "draft_exam",
    description:
      "Put a whole draft of the exam to the host's reading, which uses no model. It returns the faults it found, or that the draft stands. A draft that stands is the campaign's exam.",
    parameters: DRAFT_PARAMETERS,
    executionMode: "sequential",
    execute: async (args) => {
      if (desk.tries >= limits.puts) throw new Error(none);
      desk.tries += 1;
      const draft = draftedFrom(args);
      const seen = capturedJsonStringify(draft);
      const unformed = draftFaults(draft);
      const { faults, notes } =
        unformed.length > 0
          ? { faults: unformed, notes: [] }
          : await within(async () => await terms.reading(draft, stop));
      const noted =
        notes.length === 0
          ? []
          : ["Notes, which leave the draft standing:", ...notes.map((note) => `- ${note}`)];
      const left = limits.puts - desk.tries;
      if (faults.length === 0) {
        append(terms.log, "exam.drafted", {
          session: terms.id,
          draft: parseJsonAs<JsonObject>(seen),
        });
        desk.stands = true;
        return ending(
          text(["The draft stands: it is the campaign's exam. The session ends here.", ...noted].join("\n")),
        );
      }
      return text(
        [
          `The ${kind} does not stand. ${plural(faults.length, "fault")}:`,
          ...faults.map((fault) => `- ${fault}`),
          ...noted,
          left > 0
            ? `Mend them and put the whole ${kind} again. This session can put ${plural(left, `more ${kind}`)}.`
            : none,
        ].join("\n"),
      );
    },
  });
  return {
    kind,
    system: SYSTEM,
    opening: `The operator's prompt:\n\n${terms.prompt}\n\n${budgetLine(terms.budget)}\n\nThis session has ${plural(Math.round(limits.wallSeconds / 60), "minute")}, ${plural(limits.turns, "turn")} and ${plural(limits.puts, kind)}.`,
    started: {
      limits: { wallSeconds: limits.wallSeconds, turns: limits.turns, tries: limits.puts },
      prompt: terms.prompt,
    },
    tools: [put],
    enters: `a ${kind} enters it through ${put.name} alone`,
    nudge: `Put a ${kind} with ${put.name}`,
    finish: "End the session without an exam. Say in one or two sentences why none could be drafted.",
    declined: null,
    done: (): "stands" | null => (desk.stands ? "stands" : null),
    counted: () => ({ ...desk }),
    result: () => ({ puts: desk.tries, held: [], refused: [] }),
  } as const;
}
