/**
 * Move 2 of a campaign that opens from a prompt: the Examiner drafts the exam.
 *
 * A campaign opens either over a stored pack a v1 Builder wrote, which four flags name, or from a
 * prompt (`7f0add79:docs/plan.md`, row F53). Here the operator's prompt names a domain, and one session
 * drafts what a campaign needs before its first task is solved: the public rules, each with the
 * source that states it, the answer format, one check for each rule, the objective or why there is
 * none, a few example tasks, and control answers, which are answers to those examples with a known
 * label.
 *
 * The session is `examine`'s in its drafting mode (`session.ts`), and this file is what that mode
 * is made of (`drafting`): what the Examiner is told, the tool it puts a whole draft by, and the two
 * readings a draft is held to without a model. The first is its shape (`draftFaults`), which the
 * session reads itself, so no caller can let a draft out of shape stand. The second is the
 * caller's (`reading`, `tools/d2/exam.ts`): every control answer through the checks, twice, and the
 * smallest answer the format allows on every example. The Examiner is told the faults and puts the
 * draft again. A draft with no fault stands: it goes into the log whole, as `exam.drafted`, and the
 * session ends. The campaign reads its exam from that event (`draftOf`). Validation and acceptance
 * stay together here because only drafting submits a whole exam (28 October).
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
 * The prompt is built around the comparison's two ways of telling harnesses apart, validity and
 * the objective (`ROOM`, `src/kernel/compare.ts`), since the draft fixes which a campaign can ever
 * use. On 4 November every exam drafted since 1 November with an objective had untied most of its
 * compared tasks (buffer 305 of 381, truss 20 of 21) and every one without had tied nearly all
 * (esp32 0 of 62, jobstat 7 of 180, 0 promotions). The business-records exams, also work products,
 * declared an objective in 18 of 21 puts and untied 49 of 50 tasks; the jobstat exams declared one
 * in 0 of 17, each convention naming a data defect's repair and each task's input naming every
 * step, and one program answered 43 of 43 solves (jobstat-fresh-opus-forkedPR600-turns6,
 * g-1). Until then the objective was one optional paragraph ending "a field with no such quantity
 * declares none", and omitting it was silent. Now the session is asked what a practitioner
 * prefers between two valid answers, and a draft gives a quantity with its direction or its
 * author's reason for none (`unmeasured`, kept on the exam side), a decision the shape requires.
 * The same day the prompt named conventions and a task's input beside rules as what can hand over
 * the whole method. Until 5 November it said nothing a solver needs is hidden, and all 7 jobstat
 * drafts published every planted defect with its repair; validity now rests on `FAIR` alone.
 *
 * On 5 November an exam that declared the objective as the share of an answer's values agreeing
 * with a recomputation from the input scored 243 of 265 solves at exactly 1, and its three
 * comparisons tied every task, 51 of 51 (jobstath2-fresh-opus-forkedPR608). So the
 * prompt names that measure as one the standard method reaches, beside one read against what the
 * task was built from. A rule requiring hidden values whenever an objective is declared was
 * weighed and not taken: truss's mass reads none, and the standard method does not reach its best.
 *
 * The Examiner is told the prompt, its limits and what the host found in each draft, and no count
 * of tasks, since an author told a target writes towards it. It reads the reach scale and who the
 * grades are for (`REACH`, `ladder.ts`), not the worked fields, which teach how hard a task is and
 * belong to writing. On 16 October five fresh campaigns' task admissions refused 74 of 95 drafts,
 * 67 as answered in all three solves, which is why it is told that a lookup, a matching or a search
 * meets any rules that leave them. Until 31 October it was told to choose rules that act together;
 * both of that day's paired esp32 arms did, and the reference answered 34 of 35 of their first room
 * solves validly. Both then drafted rules restating the field's tables and formulas, whose examples
 * passed 9 of 9 solves at 3 turns; a rule now states its property and names its public standard.
 *
 * It is told that the prompt's requirements stay in the exam at the strength the prompt states:
 * truss-fresh-opus-v064 was asked for trusses "within strict mass limits" and drafted no check of
 * mass, and the host's reading cannot see a requirement a draft leaves out (27 October). Where it
 * has a shell (`shell.ts`) it is told what the shell is and what the wall test found of the
 * network, and not what to use it for; nothing hidden exists at drafting, and the wall closes the
 * repository, where the log lies.
 *
 * No solve runs at drafting. From 22 October to 1 November a draft with no fault was solved before
 * it stood, and from 3 to 4 November (#585) one the Starter Built Harness answered on every solve
 * was refused: four jobstat campaigns put 10 drafts, 60 of 60 example solves valid, three ended
 * `exam` with nothing compared, at $1.17 to $2.77 and up to half an hour a draft. The operator asked
 * for gates that trust a capable model. The reading's notes, facts a draft stood with, left with
 * it: they rode on the reply that ends the session (`ending`, `src/tools/answer.ts`), and none of
 * 250 `draft_exam` results on record carried them to a model.
 */
import { type Static, Type } from "typebox";
import { answerFormatFault, type Objective } from "../kernel/contract.ts";
import { ROOM } from "../kernel/compare.ts";
import { CHECK_WALL_MS } from "../kernel/verify.ts";
import { REACH } from "./ladder.ts";
import { budgetLine, FAIR, type SolveBudget, TASK, UNHELD } from "./prompt.ts";
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
  /** Why the draft declares no objective, in its author's words, where it declares none. Kept on
   *  the exam side: `stageExam` stages it nowhere, so no solver, Builder or writing session reads
   *  it. Absent from drafts logged before 4 November, which `draftOf` reads as they are. */
  readonly unmeasured?: string;
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

interface DraftingTerms {
  readonly limits: { readonly wallSeconds: number; readonly turns: number; readonly puts: number };
  readonly id: string;
  readonly log: string;
  /** The operator's prompt, as the campaign's opening holds it. */
  readonly prompt: string;
  /** The budget the exam's solves will be held to, as the campaign's setting names it. */
  readonly budget: SolveBudget;
  /** What the host reads of a draft whose shape holds, a fault a sentence: its control answers
   *  through its checks. */
  readonly reading: (draft: Draft) => Promise<readonly string[]>;
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
      "What a task of this domain may ask. It bounds every task written later, so a size it fixes for a task is the ceiling on how hard one can be made.",
  }),
  conventions: Type.String({
    description:
      "What a practitioner takes as given: units, rounding, notation. A step of the work stated here is one no solver has to find.",
  }),
  rules: Type.Array(
    Type.Object({
      id: Type.String({ pattern: "^R[0-9]+$" }),
      statement: Type.String({ pattern: "\\S", description: "The property every valid answer has." }),
      source: Type.String({ pattern: "\\S", description: "Where the field defines the property." }),
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
  objective: Type.Object(
    {
      quantity: Type.Optional(
        Type.String({
          pattern: "\\S",
          description:
            "The quantity the check program's `objective` export computes of a valid answer, with its unit.",
        }),
      ),
      direction: Type.Optional(
        Type.Union([Type.Literal("lower"), Type.Literal("higher")], { description: "Which way is better." }),
      ),
      none: Type.Optional(
        Type.String({
          pattern: "\\S",
          description:
            "Where the exam declares no objective: why every valid answer to a task is as good as any other to a practitioner.",
        }),
      ),
    },
    { description: "A quantity with its direction, or why there is none, as the system prompt says." },
  ),
  tasks: Type.Array(
    Type.Object({
      family: Type.String({ pattern: "\\S" }),
      public_input: Type.Unknown(),
      hidden: Type.Unknown({ description: "Null when the task has none." }),
    }),
  ),
  accept_controls: Type.Array(Type.Object(CONTROL)),
  reject_controls: Type.Array(
    Type.Object({ ...CONTROL, check: Type.String({ description: "The check that must refuse it." }) }),
  ),
});

/** How far apart two valid answers are on the objective before one is the better: the
 *  comparison's own floor. */
const FLOOR = `${String(ROOM * 100)}%`;

/** The system prompt. */
const SYSTEM = [
  "You are the Examiner. An operator has named a technical domain in a prompt, and you draft the exam on which a solving model will be measured in that domain: its public rules, scope and conventions, its answer format, its checks, its objective, example tasks and controls. You draft once, at the opening of a campaign. Later sessions write further tasks under what you draft here, and can change none of it.",
  `${TASK} The solver's first message holds the public input; its home holds the same task as public/task.json and the public rules, scope and conventions under public/resources/. It answers with one JSON value that follows the answer format, and an answer every check passes is valid. ${FAIR}`,
  `Two harnesses for the solver are compared on tasks neither was built on, each task solved afresh under each harness. A task tells them apart in two ways only. On validity: some of its solves are valid and some are not, and a valid answer beats one that is not. On the objective, where the exam declares one: two answers are both valid and one is better by it than the other by at least ${FLOOR} of the larger measure. Any other task is a tie, and a tie leaves the test, so an exam on which every solve is valid and nothing chooses between valid answers tells no harness from another, however many tasks it holds.`,
  `Who solves, and how hard a task can be for it:\n\n${REACH}`,
  "Which of the two ways the exam's tasks can use is decided here, and nothing written later adds the other. Validity tells harnesses apart only on tasks in one of the three places above, so it needs rules and a scope that leave the solver a method to find. The objective tells them apart on a task with more than one valid answer where the field's standard method, applied to the input, falls short of the best measure; where it reaches it, every careful solve submits that answer and the task ties. So ask of the domain what makes one valid answer better than another to a practitioner: what they pay for, save, minimise or maximise while meeting the requirements, such as a cost, a mass, a length, a count, a time, an error or a margin to a limit. Where the domain has such a quantity, declare it as the objective. Declare none only where every valid answer to a task is as good as any other to a practitioner, and say why under the objective's `none`; the exam then measures by validity alone.",
  "The check program computes the objective in an `objective` export: a function that takes the same `request` as a check and returns the quantity of a valid answer as a finite number. It is your own computation, as each check is, and it may read the hidden values and measure the answer against what you built the task from. A share of the answer's values that agree with a recomputation from the public input is a measure the standard method reaches, so careful solves tie on it; a measure against the parameters a task's data were generated from, or another value you built the task from, is one a method that misses a defect in the data falls short of. One so measured cannot be gamed where it is the task's mean of a non-negative proper loss over its quantities, any tolerance folded into the value: absolute error for a point estimate, the interval score at a stated level for an interval. Coverage alone rewards a wider interval, and a value that changes sign or sits near zero makes trivial differences large.",
  `A rule states a property every valid answer has, which a check decides from its argument: a bound that holds, a quantity that is conserved, a state the field's own engine reaches, a test the answer passes. Give each rule its source: the standard, specification, reference manual or textbook that defines the property, named precisely enough to look up, and one that states the limit as your rule does; a nominal or typical value is no limit. ${UNHELD} Name the standard rather than restating its tables, equations or working, which the solver can look up, and leave the way to the property to the solver. A rule, a convention or a task's input that states the procedure, its steps or the numbers it needs hands the solver the whole method, and every task becomes running it once; so does a rule met by matching a shape the scope spells out or by writing one exact text.`,
  "The scope bounds every task written later: a size it fixes is the ceiling on how hard a task can be made, and an effect it leaves out is one no task can turn on. Draft a scope under which tasks can be written at every grade this field reaches, with the effects that decide answers near its limits.",
  "The operator's prompt outranks your choice of rules. Every requirement it names, such as a limit, a quantity to meet or an analysis an answer has to pass, stays in the exam at the strength the prompt states, as a rule with its check, and a quantity it asks to minimise or maximise is the objective. Where no check can decide such a requirement from its argument alone, such as a work product or a step of the work, name it in the scope as not measured, and do not check a weaker property under its name.",
  `Write one check for each rule, and no other. The check program is one TypeScript module that exports \`checks\`, an object with a function under each check id. A function takes one argument, \`request\`, and returns a boolean, or a promise of one: \`request.publicTask\` is \`{ taskId, family, publicInput }\`, \`request.artifact\` is the answer, and \`request.hidden\` is the task's hidden values. It runs offline in a closed cell and imports nothing, so it computes from its argument alone, and the same answer always gets the same verdict. A check that runs longer than ${String(CHECK_WALL_MS / 60_000)} minutes, its tools included, reaches no verdict. It returns true where the answer keeps its rule and false only where it breaks it: an answer that breaks another rule is that rule's check's to refuse, and where its own computation cannot reach a verdict on an answer the format allows, such as a solver that does not converge, it throws, which drops the task as the check's defect instead of refusing the answer. It holds its rule exactly, allowing no tolerance the rule does not state, so a check of a quantity a rule calls zero or absent refuses any trace of it. It verifies the property its rule states, must be right on a task nobody has answered, and never compares the answer with an answer you worked out. A check that recomputes the one value its rule allows leaves each task one valid answer.`,
  `Give at least ${plural(EXAMPLES, "example task")}, different in what they ask and not only in their numbers. Either every task carries hidden values or none does. For each example give one accept control: an answer that keeps every rule. You choose the task, so you can start from an answer and derive the task from it. For each check give at least one reject control: an answer to an example that follows the answer format, breaks that check's rule, and names the check. The smallest answer the format allows, such as empty strings and empty lists, has to be rejected on every task: where it would pass, the format or the rules ask too little.`,
  "draft_exam puts a whole draft to the host, which reads it without a model: its shape, then every control through the checks, twice, and the smallest answer on every example. It returns the faults it found, or that the draft stands. A draft that stands is the campaign's exam and is not changed afterwards, and the session ends there.",
].join("\n\n");

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
        : [`example ${String(index)} has no accept control`],
    ),
    ...draft.checks.flatMap(({ id }) =>
      draft.reject.some(({ check }) => check === id) ? [] : [`check ${id} has no reject control`],
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
  const again = twice(ruleIds) ?? twice(draft.checks.map(({ id }) => id));
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
    ...draft.rules.flatMap(({ id }) => {
      const checked = draft.checks.filter((check) => check.rule === id).length;
      return checked === 1 ? [] : [`rule ${id} has ${String(checked)} checks, and each rule has one`];
    }),
    ...draft.checks.flatMap(({ id, rule }) =>
      ruleIds.includes(rule) ? [] : [`check ${id} enforces ${rule}, and the draft holds no such rule`],
    ),
    ...((draft.objective === undefined) === (draft.unmeasured === undefined)
      ? [
          "the objective is a quantity with its direction, or why there is none: this draft gives both or neither",
        ]
      : []),
    ...(draft.tasks.length < EXAMPLES
      ? [
          `the draft holds ${plural(draft.tasks.length, "example task")}, and at least ${String(EXAMPLES)} are needed`,
        ]
      : []),
    ...(hidden === 0 || hidden === draft.tasks.length
      ? []
      : ["some examples carry hidden values and some carry none"]),
    ...draft.tasks.flatMap(({ publicInput }, index) =>
      publicInput === null ? [`example ${String(index)} has no public input`] : [],
    ),
    ...controlFaults(draft),
  ];
}

/** The draft as `draft_exam`'s arguments carry it, under the names `Draft` and `exam.drafted` use. */
function draftedFrom(args: Static<typeof DRAFT_PARAMETERS>): Draft {
  const { quantity, direction, none } = args.objective;
  // A quantity without its direction, or a direction without its quantity, is no decision, whatever
  // reason for none stands beside it, so the draft is held to give one (`draftFaults`).
  const half = (quantity === undefined) !== (direction === undefined);
  return {
    domain: args.domain,
    scope: args.scope,
    conventions: args.conventions,
    rules: args.rules,
    // SAFETY: a tool's arguments are JSON the provider parsed, here and for each value below.
    answerFormat: args.answer_format as JsonValue,
    checks: args.checks,
    evaluator: args.evaluator,
    ...keyIfDefined(
      "objective",
      quantity !== undefined && direction !== undefined ? { quantity, direction } : undefined,
    ),
    ...keyIfDefined("unmeasured", half ? undefined : none),
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
 *  it: its runs of every control answer through the checks are the verifier's time, and they wait
 *  on the host's load. On 3 November a truss session put its first draft at 44 of its 60 minutes,
 *  and the clock ended it during the host's work on that draft, so the draft got no reading and
 *  still counted as one of the campaign's tries. */
export function drafting(terms: DraftingTerms, within: <T>(action: () => Promise<T>) => Promise<T>) {
  const { limits } = terms;
  const kind = "draft";
  const desk = { tries: 0, stands: false };
  const none = `This session can put no further ${kind}. Call finish.`;
  const put = tool({
    name: "draft_exam",
    description: "Put a whole draft of the exam to the host's reading, as the system prompt says.",
    parameters: DRAFT_PARAMETERS,
    execute: async (args) => {
      if (desk.tries >= limits.puts) throw new Error(none);
      desk.tries += 1;
      const draft = draftedFrom(args);
      const seen = capturedJsonStringify(draft);
      const unformed = draftFaults(draft);
      const faults = unformed.length > 0 ? unformed : await within(async () => await terms.reading(draft));
      if (faults.length === 0) {
        append(terms.log, "exam.drafted", {
          session: terms.id,
          draft: parseJsonAs<JsonObject>(seen),
        });
        desk.stands = true;
        return ending(text("The draft stands: it is the campaign's exam. The session ends here."));
      }
      const left = limits.puts - desk.tries;
      return text(
        [
          `The ${kind} does not stand. ${plural(faults.length, "fault")}:`,
          ...faults.map((fault) => `- ${fault}`),
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
    finish:
      "End the session without an exam, only where none can be drafted for the prompt. Say in one or two sentences why.",
    declined: null,
    done: (): "stands" | null => (desk.stands ? "stands" : null),
    counted: () => ({ ...desk }),
    result: () => ({ puts: desk.tries, held: [], refused: [] }),
  } as const;
}
