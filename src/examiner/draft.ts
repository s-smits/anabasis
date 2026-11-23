/**
 * Drafting mode for `examine` (`session.ts`): prompts the Examiner to draft a campaign's rules,
 * answer format, check program, optional objective, example tasks, and controls, validates draft
 * shape (`draftFaults`) and installed verifier engines, and records accepted drafts as `exam.drafted`.
 */
import { type Static, Type } from "typebox";
import { answerFormatFault, type Objective } from "../kernel/contract.ts";
import { type ControlFile, DELIVERABLES } from "../kernel/answer-files.ts";
import { GAP_FLOOR } from "../kernel/compare.ts";
import { PER_CHECK_MS } from "../kernel/verify.ts";
import { REACH } from "./ladder.ts";
import { budgetLine, FAIR, type SolveBudget, TASK, UNHELD } from "./prompt.ts";
import { FROM_FILE, fromHome } from "./shell.ts";
import { append, type LogEvent } from "../kernel/log.ts";
import { capturedJsonStringify, decodedJsonText, parseJsonAs } from "../meta/json-runtime.ts";
import { asRecord, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { plural } from "../meta/text.ts";
import { ending, text, tool } from "../tools/answer.ts";

/** A rule of the contract as its author states it: the requirement, and where the field states it. */
interface DraftedRule {
  readonly id: string;
  readonly statement: string;
  readonly source: string;
}

/** One control answer of a draft, by the example it answers. */
interface DraftControl {
  readonly task: number;
  readonly answer: JsonValue;
  readonly files?: readonly ControlFile[];
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
  /** One check a rule: its id, the rule it enforces, the property it verifies, and any installed
   *  verifier engines it runs through `runtime.tools.run`. */
  readonly checks: readonly {
    readonly id: string;
    readonly rule: string;
    readonly assertion: string;
    readonly tools?: readonly string[];
  }[];
  /** The check program's source: a module that exports `checks`, a function for each check id,
   *  and `objective` where the draft declares one. */
  readonly evaluator: string;
  /** The objective two valid answers are compared by, where the field has one: absent, two valid
   *  answers to one task are even. */
  readonly objective?: Objective;
  /** Installed verifier engines declared for `objective(request, runtime)`, when it runs any. */
  readonly objectiveTools?: readonly string[];
  /** Why the draft declares no objective, in its author's words, where it declares none. Kept on
   *  the exam side: `stageExam` stages it nowhere, so no solver, Builder or writing session reads
   *  it. Absent from the oldest drafts, which `draftOf` reads as they are. */
  readonly unmeasured?: string;
  /** The example tasks, which are the exam's first. */
  readonly tasks: readonly {
    readonly family: string;
    readonly publicInput: JsonValue;
    readonly hidden: JsonValue;
  }[];
  /** Control answers, by the example each answers: answers every check passes, and answers the named
   *  check refuses, each with the files beside it. */
  readonly accept: readonly DraftControl[];
  readonly reject: readonly (DraftControl & { readonly check: string })[];
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
/** What a check program may not spell in executable code: a way out of its argument, or a value
 *  that differs from one run to the next. Comments and string literals are stripped from the
 *  transpiled output first, and `Bun.Transpiler.scan` checks imports, syntax and exports. */
const EVALUATOR_TRANSPILER = new Bun.Transpiler({ loader: "ts" });
const OUTSIDE = [
  [/\brequire\s*\(/, "an import"],
  [/\b(?:Bun|process)\s*(?:\.|\[)/, "the runtime's own objects"],
  [/\bfetch\s*\(/, "the network"],
  [
    /\bMath\s*\.\s*random\b|\bDate\s*\.\s*now\b|\bnew\s+Date\b(?!\s*\(\s*[^)\s])|\bperformance\s*\.\s*now\b|\bcrypto\s*\.\s*(?:randomUUID|getRandomValues|randomBytes)\b/,
    "a random number or the clock",
  ],
  [/\beval\s*\(|\bnew\s+Function\b/, "dynamic code evaluation"],
] as const;
const TEXT_FILE = Type.Object({ path: Type.String({ minLength: 1 }), text: Type.String() });
/** Files beside an answer, as a control or a try gives them (`ControlFile`). */
export const TEXT_FILES = Type.Optional(
  Type.Array(
    Type.Union([
      TEXT_FILE,
      Type.Object({ path: Type.String({ minLength: 1 }), entries: Type.Array(TEXT_FILE) }),
    ]),
    {
      description: `Files beside the answer, by their path under ${DELIVERABLES.folder}/, as a solver leaves them: each with its text, or for an archive such as a workbook its text members as entries, which a check then receives in an archive that stores them.`,
    },
  ),
);
const CONTROL = {
  task: Type.Integer({
    minimum: 0,
    description: "The example it answers, by its place in `tasks`, from 0.",
  }),
  answer: Type.Unknown(),
  files: TEXT_FILES,
};
/** What `draft_exam` takes: a whole draft, in the words the Examiner is told. */
const DRAFT_PARAMETERS = Type.Object({
  domain: Type.String({ minLength: 1, description: "The domain, in a few words." }),
  // What a size fixed here costs is said where the scope is written: an exam that held every
  // task to a small size its field does not had the starter answer every solve whatever was
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
      tools: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), {
          description:
            "Installed programs this check invokes via `runtime.tools.run` (e.g. `python3`, `bash`, or a domain engine installed in the environment).",
        }),
      ),
    }),
    { minItems: 1 },
  ),
  // The check program may name a file as an object, since under a strict schema of text alone a
  // draft spells the object as text (`fromHome` reads both).
  evaluator: Type.Union([
    Type.String({ minLength: 1, description: "The check program's TypeScript source." }),
    Type.Object({ from_file: Type.String({ minLength: 1 }) }),
  ]),
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
            "Where the exam declares no objective: why no task of the domain could leave valid answers that differ to a practitioner.",
        }),
      ),
      tools: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), {
          description:
            "Installed programs `objective` invokes via `runtime.tools.run` (e.g. `python3`, `bash`, or a domain engine installed in the environment).",
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
const FLOOR = `${String(GAP_FLOOR * 100)}%`;

/** The system prompt. */
const SYSTEM = [
  "You are the Examiner. An operator has named a technical domain in a prompt, and you draft the exam on which a solving model will be measured in that domain: its public rules, scope and conventions, its answer format, its checks, its objective, example tasks and controls. You draft once, at the opening of a campaign. Later sessions write further tasks under what you draft here, and can change none of it.",
  `${TASK} The solver's first message holds the public input; its home holds the same task as public/task.json and the public rules, scope and conventions under public/resources/. It answers with one JSON value that follows the answer format, and an answer every check passes is valid. ${FAIR}`,
  `Beside that value a solver may leave files under ${DELIVERABLES.folder}/ in its working directory. Submit captures the regular files there, at most ${String(DELIVERABLES.count)} and ${String(DELIVERABLES.bytes)} bytes in all, and each check receives them as request.files, a list of { path, base64, text, entries } with text where the file is UTF-8 and entries, a list of { path, text } for each UTF-8 member, where it is a zip archive such as a workbook or a document whose members inflate within ${String(DELIVERABLES.bytes)} bytes across the files, empty where the folder is absent; the objective receives them too. So a work product the prompt asks for, such as a report or a workbook, is one a check can read, and a control or a try carries the files a check needs.`,
  `A public input may in turn list under files what a practitioner is handed as files, such as a table, a log or a memo, as rows of { path, text } with relative paths: the solver's home then holds each as a file under public/files/ at its path, beside the JSON that lists it.`,
  `Two harnesses for the solver are compared on tasks neither was built on, each task solved afresh under each harness. A task tells them apart in two ways only. On validity: some of its solves are valid and some are not, and a valid answer beats one that is not. On the objective, where the exam declares one: two answers are both valid and one is better by it than the other by at least ${FLOOR} of the larger measure. Any other task is a tie, and a tie leaves the test, so an exam on which every solve is valid and nothing chooses between valid answers tells no harness from another, however many tasks it holds.`,
  `Who solves, and how hard a task can be for it:\n\n${REACH}`,
  "Which of the two ways the exam's tasks can use is decided here, and nothing written later adds the other. How much gradient validity carries differs by domain: hard-constraint domains (physical feasibility, compilers, simulators) separate harnesses on binary validity, whereas open-ended or multi-criteria domains keep prompt-stated requirements as a binary feasibility floor while the objective separates valid answers. Validity tells harnesses apart only on tasks in one of the three places above, so it needs rules and a scope that leave the solver a method to find. The objective tells them apart on a task with more than one valid answer where the field's standard method, applied to the input, falls short of the best measure; where it reaches it, every careful solve submits that answer and the task ties. So ask of the domain what makes one valid answer better than another to a practitioner: what they pay for, save, minimise or maximise while meeting the requirements, such as a cost, a mass, a length, a count, a time, an error, a margin to a limit, or in multi-criteria analytical domains a proper score or penalised count over independent hidden-ground-truth domain criteria (penalising wrong or hedged claims so a broad guess cannot score high). Whether valid answers differ on it is decided here too, by what the answer format and the scope leave to the answer: where a task fixes everything the quantity depends on, every valid answer measures the same and none is better, and where the answer chooses some of it, such as the parts, the sizes, the amounts or the estimates, they differ. Where the domain has such a quantity, leave the answer what it depends on and declare it as the objective. Declare none only where no task of the domain could leave an answer that choice, and say why under the objective's `none`; the exam then measures by validity alone.",
  "The check program computes the objective in an `objective` export: a function that takes the same `request` as a check and returns the quantity of a valid answer as a finite number. It is your own computation, as each check is, and it may read the hidden values and measure the answer against what you built the task from. A share of the answer's values that agree with a recomputation from the public input is a measure the standard method reaches, so careful solves tie on it; a measure against the parameters a task's data were generated from, or another value you built the task from, is one a method that misses a defect in the data falls short of. Score each quantity on its estimation scale using only a public-input scale; avoid hidden denominators or metrics that reward trivial hedges.",
  `A rule states a property every valid answer has, which a check decides from its argument: a bound that holds, a quantity that is conserved, a state the field's own engine reaches, a test the answer passes. Give each rule its source: the standard, specification, reference manual or textbook that defines the property, named precisely enough to look up, and one that states the limit as your rule does; a nominal or typical value is no limit. ${UNHELD} Name the standard rather than restating its tables, equations or working, which the solver can look up, and leave the way to the property to the solver. A rule, a convention or a task's input that states the procedure, its steps or the numbers it needs hands the solver the whole method, and every task becomes running it once; so does a rule met by matching a shape the scope spells out or by writing one exact text.`,
  "The scope bounds every task written later: a size it fixes is the ceiling on how hard a task can be made, and a class of problem it leaves out is one no task can pose. Draft a scope under which tasks can be written at every grade this field reaches, with the effects that decide answers near its limits. It names the classes of problem a task may pose, never a list of the faults tasks plant, and never says that an effect it leaves unnamed is absent: the solver reads the scope, and a list of plants turns finding a fault into matching one.",
  "The operator's prompt outranks your choice of rules. Every requirement it names, such as a limit, a quantity to meet or an analysis an answer has to pass, stays in the exam at the strength the prompt states, as a rule with its check, and a quantity it asks to minimise or maximise is the objective. Where no check can decide such a requirement from its argument alone, such as a step of the work, name it in the scope as not measured, and do not check a weaker property under its name. The same holds for the objective: a quantity declared because the prompt's own cannot be computed is a stand-in, so the scope names the prompt's quantity as not measured and the stand-in as what is measured in its place, and a step won on it measures the stand-in alone.",
  `Write one check for each rule, and no other. The check program is one TypeScript module that exports \`checks\`, an object with a function under each check id. A function takes \`(request, runtime)\` and returns a boolean, or a promise of one: \`request.publicTask\` is \`{ taskId, family, publicInput }\`, \`request.artifact\` is the answer, and \`request.hidden\` is the task's hidden values. It runs offline in a closed cell and imports nothing, so it computes from its argument alone, and the same answer always gets the same verdict. Where a check or the objective needs an installed program or domain engine (such as \`python3\`, \`bash\` wrapping a simulator/compiler/CLI like \`pio\`, or a solver binary installed in your environment), declare each program name in its \`tools\` array (name any domain engine itself alongside a wrapper shell so it is pinned) and run it via \`await runtime.tools.run({ toolId, args, files, stdin })\`, which returns \`{ nonResult, exitCode, stdout, stderr }\` inside the same offline cell. A check that runs longer than ${String(PER_CHECK_MS / 60_000)} minutes is at fault, which drops the task as the check's defect. It returns true where the answer keeps its rule and false only where it breaks it: an answer that breaks another rule is that rule's check's to refuse, and where its own computation cannot reach a verdict on an answer the format allows, such as a solver that does not converge, it throws, which drops the task as the check's defect instead of refusing the answer. It holds its rule's stated bounds without relaxing them—so a quantity a rule calls zero or absent refuses any non-zero amount—while allowing a small floating-point arithmetic epsilon (e.g. 1e-9) on sums or products of decimal inputs so IEEE-754 rounding never rejects an exact boundary value. It verifies the property its rule states, must be right on a task nobody has answered, and never compares the answer with an answer you worked out. A check that recomputes the one value its rule allows leaves each task one valid answer.`,
  `Give at least ${plural(EXAMPLES, "example task")}, different in what they ask and not only in their numbers. Either every task carries hidden values or none does. For each example give one accept control: an answer that keeps every rule. You choose the task, so you can start from an answer and derive the task from it; where the exam declares an objective, an example leaves room on it only where the standard method's answer measures worse than that control by at least ${FLOOR}. For each check give at least one reject control: an answer to an example that follows the answer format, breaks that check's rule, and names the check. The smallest answer the format allows, such as empty strings and empty lists, has to be rejected on every task: where it would pass, the format or the rules ask too little.`,
  "draft_exam validates the whole draft and returns any faults; a fault-free draft becomes the campaign's fixed exam.",
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
 * another way: a drafted object with no properties, whose check read a field from it, had every
 * rejection it made ruled a check defect. An accept control carries every field its checks need,
 * so reading the controls covers every check. A reference, a combination, a condition or a pattern
 * counts as naming, and the `anyOf` and `oneOf` options are read with the `properties` beside them,
 * so a sound "at least one of" format is not refused.
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

/** Strip comments and quoted/template string chunks (keeping `${...}` code) from transpiled JS. */
function codeOnly(source: string): string {
  const parts: string[] = [];
  let index = 0;
  const end = source.length;
  while (index < end) {
    const ch = source[index];
    const next = source[index + 1];
    if (ch === "/" && next === "/") {
      const eol = source.indexOf("\n", index + 2);
      index = eol === -1 ? end : eol + 1;
      parts.push("\n");
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close === -1 ? end : close + 2;
      parts.push(" ");
      continue;
    }
    if (ch === '"' || ch === "'") {
      index += 1;
      while (index < end && source[index] !== ch) {
        index += source[index] === "\\" ? 2 : 1;
      }
      index += 1;
      parts.push('""');
      continue;
    }
    if (ch === "`") {
      index += 1;
      parts.push('""');
      index = scanTemplate(source, index, parts);
      continue;
    }
    parts.push(ch ?? "");
    index += 1;
  }
  return parts.join("");
}

/** Advance past a template literal starting after its opening backtick, preserving `${...}` code. */
function scanTemplate(source: string, start: number, parts: string[]): number {
  let index = start;
  const end = source.length;
  while (index < end && source[index] !== "`") {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] !== "$" || source[index + 1] !== "{") {
      index += 1;
      continue;
    }
    index += 2;
    parts.push(" ");
    let depth = 1;
    while (index < end && depth > 0) {
      const cur = source[index];
      if (cur === "{") depth += 1;
      else if (cur === "}") depth -= 1;
      if (depth > 0) parts.push(cur ?? "");
      index += 1;
    }
    parts.push(" ");
  }
  return index + 1;
}

/** Static syntax, export and purity faults of `draft.evaluator`, checked before staging any cell. */
function evaluatorFaults(draft: Draft): string[] {
  let scanned: ReturnType<typeof EVALUATOR_TRANSPILER.scan>;
  let transformed: string;
  try {
    scanned = EVALUATOR_TRANSPILER.scan(draft.evaluator);
    transformed = EVALUATOR_TRANSPILER.transformSync(draft.evaluator);
  } catch (error) {
    return [`the check program did not compile: ${errorMessage(error)}`];
  }
  const code = codeOnly(transformed);
  const reached = [
    ...(scanned.imports.length > 0 ? ["an import"] : []),
    ...OUTSIDE.flatMap(([spelled, what]) => (spelled.test(code) ? [what] : [])),
  ];
  return [
    ...[...new Set(reached)].map(
      (what) =>
        `the check program reaches for ${what}: a check computes from its request alone, so that one answer gets one verdict on every host`,
    ),
    ...(scanned.exports.includes("checks") ? [] : ["the check program does not export `checks`"]),
    ...(draft.objective !== undefined && !scanned.exports.includes("objective")
      ? ["the draft declares an objective, and the check program does not export `objective`"]
      : []),
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
    ...evaluatorFaults(draft),
    ...(again === undefined ? [] : [`${again} is named twice: an id names one rule or one check`]),
    ...draft.rules.flatMap(({ id }) => {
      const checked = draft.checks.filter((check) => check.rule === id).length;
      return checked === 1 ? [] : [`rule ${id} has ${String(checked)} checks, and each rule has one`];
    }),
    ...draft.checks.flatMap(({ id, rule }) =>
      ruleIds.includes(rule) ? [] : [`check ${id} enforces ${rule}, and the draft holds no such rule`],
    ),
    ...draft.checks.flatMap(({ id, tools }) =>
      (tools ?? []).flatMap((toolId) =>
        isSafePathSegment(toolId) ? [] : [`check ${id} names invalid verifier tool ${toolId}`],
      ),
    ),
    ...(draft.objectiveTools ?? []).flatMap((toolId) =>
      isSafePathSegment(toolId) ? [] : [`objective names invalid verifier tool ${toolId}`],
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
  const { quantity, direction, none, tools } = args.objective;
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
    checks: args.checks.map(({ id, rule, assertion, tools: checkTools }) => ({
      id,
      rule,
      assertion,
      ...keyIfDefined("tools", checkTools !== undefined && checkTools.length > 0 ? checkTools : undefined),
    })),
    // SAFETY: `fromHome` has read a `from_file` object into the text its file holds before this runs.
    evaluator: args.evaluator as string,
    ...keyIfDefined(
      "objective",
      quantity !== undefined && direction !== undefined ? { quantity, direction } : undefined,
    ),
    ...keyIfDefined("objectiveTools", tools !== undefined && tools.length > 0 ? tools : undefined),
    ...keyIfDefined("unmeasured", half ? undefined : none),
    tasks: args.tasks.map(({ family, public_input, hidden }) => ({
      family,
      // SAFETY: as above.
      publicInput: public_input as JsonValue,
      // SAFETY: as above.
      hidden: decodedJsonText((hidden ?? null) as JsonValue),
    })),
    // SAFETY: as above.
    accept: args.accept_controls.map(({ task, answer, files }) => ({
      task,
      answer: answer as JsonValue,
      ...keyIfDefined("files", files),
    })),
    // SAFETY: as above.
    reject: args.reject_controls.map(({ task, answer, files, check }) => ({
      task,
      answer: answer as JsonValue,
      ...keyIfDefined("files", files),
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
 *  on the host's load. A clock that ran through them could end a session during the host's work
 *  on a late draft, which would then get no reading and still count as one of the campaign's
 *  tries. */
export function drafting(
  terms: DraftingTerms,
  within: <T>(action: () => Promise<T>) => Promise<T>,
  // The home of the session's shell, which `from_file` reads; absent where it has none.
  home?: string,
) {
  const { limits } = terms;
  const kind = "draft";
  const desk = { tries: 0, stands: false };
  const none = `This session can put no further ${kind}. Call finish.`;
  const put = tool(
    fromHome(home, {
      name: "draft_exam",
      description: `Put a whole draft of the exam to the host's reading, as the system prompt says.${home === undefined ? "" : ` ${FROM_FILE}`}`,
      parameters: DRAFT_PARAMETERS,
      execute: async (args) => {
        if (desk.tries >= limits.puts) throw new Error(none);
        const draft = draftedFrom(args);
        desk.tries += 1;
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
    }),
  );
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
