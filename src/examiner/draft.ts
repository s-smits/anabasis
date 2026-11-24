import { type Static, Type } from "typebox";
import { answerFormatFault, type Objective, type RubricItem, rubricFaults } from "../kernel/contract.ts";
import { type ControlFile, DELIVERABLES } from "../kernel/answer-files.ts";
import { GAP_FLOOR } from "../kernel/compare.ts";
import { PER_CHECK_MS } from "../kernel/verify.ts";
import { REACH } from "./ladder.ts";
import { budgetLine, FAIR, type SolveBudget, TASK, UNHELD } from "./prompt.ts";
import { FROM_FILE, fromHome } from "./shell.ts";
import { append, eventsOf, type LogEvent } from "../kernel/log.ts";
import { capturedJsonStringify, decodedJsonText, parseJsonAs } from "../meta/json-runtime.ts";
import { asRecord, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { plural } from "../meta/text.ts";
import { ending, text, tool } from "../tools/answer.ts";

interface DraftedRule {
  readonly id: string;
  readonly statement: string;
  readonly source: string;
}

interface DraftControl {
  readonly task: number;
  readonly answer: JsonValue;
  readonly files?: readonly ControlFile[];
}

export interface Draft {
  readonly domain: string;
  readonly scope: string;
  readonly conventions: string;
  readonly rules: readonly DraftedRule[];
  readonly answerFormat: JsonValue;
  readonly checks: readonly {
    readonly id: string;
    readonly rule: string;
    readonly assertion: string;
    readonly tools?: readonly string[];
  }[];
  readonly evaluator: string;
  readonly objective?: Objective;
  readonly objectiveTools?: readonly string[];
  readonly tasks: readonly {
    readonly family: string;
    readonly publicInput: JsonValue;
    readonly hidden: JsonValue;
  }[];
  readonly accept: readonly DraftControl[];
  readonly reject: readonly (DraftControl & { readonly check: string })[];
}

interface DraftingTerms {
  readonly limits: { readonly wallSeconds: number; readonly turns: number; readonly puts: number };
  readonly id: string;
  readonly log: string;
  readonly prompt: string;
  readonly budget: SolveBudget;
  readonly reading: (draft: Draft, home?: string) => Promise<readonly string[]>;
}

const EXAMPLES = 3;
const EVALUATOR_TRANSPILER = new Bun.Transpiler({ loader: "ts" });
const OUTSIDE = [
  [/(?<!\.)\brequire\s*\(|\bimport\s*\(/u, "an import"],
  [
    /(?<!\.)\b(?:Bun|process)\s*(?:\??\.|\[)|\b(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:Bun|process)\b/u,
    "the runtime's own objects",
  ],
  [/(?<!\.)\bfetch\s*\(/u, "the network"],
  [
    /\bMath\s*\.\s*random\b|\bDate\s*\.\s*now\b|\bnew\s+Date\b(?!\s*\(\s*[^)\s.])|(?<!\bnew\s+|\.)\bDate\s*\(\s*\)|\bperformance\s*\.\s*now\b|\bcrypto\s*\.\s*(?:randomUUID|getRandomValues|randomBytes)\b/u,
    "a random number or the clock",
  ],
  [/(?<!\.)\beval\s*\(|\(\s*0\s*,\s*eval\s*\)|(?<!\.)\bFunction\s*\(/u, "dynamic code evaluation"],
] as const;
const TEXT_FILE = Type.Object({ path: Type.String({ minLength: 1 }), text: Type.String() });
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
const DRAFT_PARAMETERS = Type.Object({
  domain: Type.String({ minLength: 1, description: "The domain, in a few words." }),
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
      scale: Type.Optional(
        Type.Literal("unit", {
          description:
            'Set to `"unit"` for `[0, 1]` scores compared by absolute difference rather than ratio.',
        }),
      ),
      items: Type.Optional(
        Type.Array(
          Type.Object({
            id: Type.String({ pattern: "^[a-z][a-z0-9-]*$" }),
            weight: Type.Number({ exclusiveMinimum: 0 }),
          }),
          {
            minItems: 1,
            description:
              'Weighted `[0, 1]` rubric items (`direction: "higher"`, `scale: "unit"`). Check program exports `scores` mapping each `id` to `(request, runtime) => number` in `[0, 1]`; host computes the weighted mean.',
          },
        ),
      ),
      tools: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), {
          description:
            "Installed programs `objective` invokes via `runtime.tools.run` (e.g. `python3`, `bash`, or a domain engine installed in the environment).",
        }),
      ),
    },
    {
      description:
        "A quantity with its direction, as the system prompt says, or empty where the exam has none.",
    },
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

const FLOOR = `${String(GAP_FLOOR * 100)}%`;

const SYSTEM = [
  "You are the Examiner. An operator has named a technical domain in a prompt, and you draft the exam on which a solving model will be measured in that domain: its public rules, scope and conventions, its answer format, its checks, its objective, example tasks and controls. You draft once, at the opening of a campaign. Later sessions write further tasks under what you draft here, and can change none of it.",
  `${TASK} The solver's first message holds the public input; its home holds the same task as public/task.json and the public rules, scope and conventions under public/resources/. It answers with one JSON value that follows the answer format, and an answer every check passes is valid. ${FAIR}`,
  `Beside that value a solver may leave files under ${DELIVERABLES.folder}/ in its working directory. Submit captures the regular files there, at most ${String(DELIVERABLES.count)} and ${String(DELIVERABLES.bytes)} bytes in all, and each check receives them as request.files, a list of { path, base64, text, entries } with text where the file is UTF-8 and entries, a list of { path, text } for each UTF-8 member, where it is a zip archive such as a workbook or a document whose members inflate within ${String(DELIVERABLES.bytes)} bytes across the files, empty where the folder is absent; the objective receives them too. So a work product the prompt asks for, such as a report or a workbook, is one a check can read, and a control or a try carries the files a check needs.`,
  `A public input may in turn list under files what a practitioner is handed as files, such as a table, a log or a memo, as rows of { path, text } with relative paths: the solver's home then holds each as a file under public/files/ at its path, beside the JSON that lists it.`,
  `Two harnesses for the solver are compared on tasks neither was built on, each task solved afresh under each harness. A task tells them apart in two ways only. On validity: some of its solves are valid and some are not, and a valid answer beats one that is not. On the objective, where the exam declares one: two answers are both valid and one is better by it than the other by at least ${FLOOR} of the larger measure (or ${FLOOR} on [0, 1] for a unit-scale objective). Any other task is a tie, and a tie leaves the test, so an exam on which every solve is valid and nothing chooses between valid answers tells no harness from another, however many tasks it holds.`,
  `Who solves, and how hard a task can be for it:\n\n${REACH}`,
  "Which of the two ways the exam's tasks can use is decided here, and nothing written later adds the other. How much gradient validity carries differs by domain: hard-constraint domains (physical feasibility, compilers, simulators) separate harnesses on binary validity, whereas open-ended or multi-criteria domains keep prompt-stated requirements as a binary feasibility floor while the objective separates valid answers. Validity tells harnesses apart only on tasks in one of the three places above, so it needs rules and a scope that leave the solver a method to find. The objective tells them apart on a task with more than one valid answer where the field's standard method, applied to the input, falls short of the best measure; where it reaches it, every careful solve submits that answer and the task ties. So ask of the domain what makes one valid answer better than another to a practitioner: what they pay for, save, minimise or maximise while meeting the requirements, such as a cost, a mass, a length, a count, a time, an error, a margin to a limit, or in multi-criteria analytical domains a proper score or penalised count over independent hidden-ground-truth domain criteria (penalising wrong or hedged claims so a broad guess cannot score high). Whether valid answers differ on it is decided here too, by what the answer format and the scope leave to the answer: where a task fixes everything the quantity depends on, every valid answer measures the same and none is better, and where the answer chooses some of it, such as the parts, the sizes, the amounts or the estimates, they differ. Where the domain has such a quantity, leave the answer what it depends on and declare it as the objective. Declare none only where no task of the domain could leave an answer that choice; the exam then measures by validity alone.",
  'Compute the objective via either a single `objective(request, runtime)` export (bounded to `[0, 1]` when `scale: "unit"`) or, for multi-criteria analytical domains, `objective.items` paired with a `scores` export mapping each item id to `[0, 1]`. Both may read `request.hidden`—including per-task rubric targets placed in `request.hidden` so later writing sessions can vary task-specific criteria under the frozen evaluator. A measure agreeing with a public-input recomputation lets standard methods tie; score against hidden generating parameters or planted defects on a public-input scale without hidden denominators. In multi-criteria domains, split every graded component—point accuracy, uncertainty calibration (penalising wide hedges, e.g. interval or proper scores), record-integrity or exclusion overlap (F1/Jaccard rather than recall alone), and deliverables—into graded partial-credit `scores` items (fraction of criteria/targets met or smooth error decay on `[0, 1]`, avoiding coarse all-or-nothing `0/1` cliffs that amplify rollout variance) where exact answers score near `1` and wrong, missing, or hedged claims fall toward `0`, rather than a `direction: "lower"` error toward `0`. Reserve binary `checks` for unambiguous structural, physical, or numerical feasibility invariants rather than exact hidden-set equality on prose boundaries.',
  `A rule states a domain property every valid answer has, which a check decides from its argument: a coupled bound that holds, a quantity that is conserved, an equilibrium or state the field's own engine reaches, or a behavioural test the answer passes. The host already enforces \`answer_format\` JSON Schema (types, required keys, enums, structural bounds) before checks run, and a capable solver already satisfies syntax, compilation, file presence, catalogue membership and simple distinctness on its own; put structural constraints in \`answer_format\` and focus rules and checks on coupled domain invariants, competing limits and executable behaviour while keeping surface formatting (headings, ordering, equivalent notations) lenient unless the domain standard fixes it. Give each rule its source: the standard, specification, reference manual or textbook that defines the property, named precisely enough to look up, and one that states the limit as your rule does; a nominal or typical value is no limit. ${UNHELD} Name the standard rather than restating its tables, equations or working, which the solver can look up, and leave the way to the property to the solver. A rule, a convention or a task's input that states the procedure, its steps or the numbers it needs hands the solver the whole method, and every task becomes running it once; so does a rule met by matching a shape the scope spells out or by writing one exact text.`,
  "The scope bounds every task written later: a size it fixes is the ceiling on how hard a task can be made, and a class of problem it leaves out is one no task can pose. Draft a scope under which tasks can be written at every grade this field reaches, with the effects that decide answers near its limits. It names the classes of problem a task may pose, never a list of the faults tasks plant, and never says that an effect it leaves unnamed is absent: the solver reads the scope, and a list of plants turns finding a fault into matching one.",
  "The operator's prompt outranks your choice of rules. Every requirement it names stays in the exam at the strength the prompt states: unambiguous feasibility limits and required analyses stay as rules with binary checks, graded multi-item accuracy or record-integrity criteria stay at full weight inside the composite `objective`, and a quantity the prompt asks to minimise or maximise is the objective. A check measures the property its rule names, never a weaker one under that name.",
  `Write one check for each rule, and no other. The check program is one TypeScript module that exports \`checks\`, an object with a function under each check id. A function takes \`(request, runtime)\` and returns a boolean, or a promise of one: \`request.publicTask\` is \`{ taskId, family, publicInput }\`, \`request.artifact\` is the answer, and \`request.hidden\` is the task's hidden values. It runs offline in a closed cell and imports nothing, so it computes from its argument alone, and the same answer always gets the same verdict. Where a check or the objective needs an installed program or domain engine (such as \`python3\` with any packages already installed in your shell's environment, \`bash\`, a compiler, a simulator, or a package you install yourself), declare each program name in its \`tools\` array and run it via \`await runtime.tools.run({ toolId, args, files, stdin })\`, which returns \`{ nonResult, exitCode, stdout, stderr }\` inside the same offline cell. Anything you install under \`.toolchain/\` in your home (using \`uv\` venvs or launchers locating sibling files via \`$(dirname "$0")\`, with no hardcoded home paths) is frozen with the draft into the verifier cell and resolved ahead of host \`PATH\` binaries. A check that runs longer than ${String(PER_CHECK_MS / 60_000)} minutes is at fault, which drops the task as the check's defect. It returns true where the answer keeps its rule and false only where it breaks it: an answer that breaks another rule is that rule's check's to refuse, and where its own computation cannot reach a verdict on an answer the format allows—such as a solver that does not converge, an unexpected \`NaN\`, or a missing lookup entry—it throws rather than catching and returning \`false\` or \`0\`, dropping the task as the check's defect instead of misscoring the answer. It holds its rule's stated bounds without relaxing them—so a quantity a rule calls zero or absent refuses any non-zero amount—while allowing a small floating-point arithmetic epsilon (e.g. 1e-9) on sums or products of decimal inputs so IEEE-754 rounding never rejects an exact boundary value. It verifies the property its rule states, must be right on a task nobody has answered, and never compares the answer with an answer you worked out. A check that recomputes the one value its rule allows leaves each task one valid answer.`,
  `Give at least ${plural(EXAMPLES, "example task")}, different in what they ask and not only in their numbers. Either every task carries hidden values or none does. For each example give one accept control: an answer that keeps every rule. You choose the task, so you can start from an answer and derive the task from it; where the exam declares an objective, an example leaves room on it only where the standard method's answer measures worse than that control by at least ${FLOOR}. For each check give at least one reject control: an answer to an example that follows the answer format, breaks that check's rule, and names the check. The smallest answer the format allows, such as empty strings and empty lists, has to be rejected on every task: where it would pass, the format or the rules ask too little.`,
  "draft_exam validates the whole draft and returns any faults; a fault-free draft becomes the campaign's fixed exam.",
].join("\n\n");

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

const twice = (ids: readonly string[]): string | undefined =>
  ids.find((id, index) => ids.indexOf(id) !== index);

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

function stripCode(source: string, start: number, scope: "whole" | "template", parts: string[]): number {
  let [index, braceDepth] = [start, 0];
  const end = source.length;
  while (index < end) {
    const [ch, next] = [source[index] ?? "", source[index + 1]];
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
      while (index < end && source[index] !== ch) index += source[index] === "\\" ? 2 : 1;
      index += 1;
      parts.push('""');
      continue;
    }
    if (ch === "`") {
      parts.push('""');
      index = scanTemplate(source, index + 1, parts);
      continue;
    }
    if (ch === "{") braceDepth += 1;
    else if (ch === "}") {
      if (scope === "template" && braceDepth === 0) return index + 1;
      braceDepth = Math.max(0, braceDepth - 1);
    }
    parts.push(ch);
    index += 1;
  }
  return index;
}

function scanTemplate(source: string, start: number, parts: string[]): number {
  let index = start;
  while (index < source.length && source[index] !== "`") {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] !== "$" || source[index + 1] !== "{") {
      index += 1;
      continue;
    }
    parts.push(" ");
    index = stripCode(source, index + 2, "template", parts);
    parts.push(" ");
  }
  return index + 1;
}

function evaluatorFaults(draft: Draft): string[] {
  let scanned: ReturnType<typeof EVALUATOR_TRANSPILER.scan>;
  let transformed: string;
  try {
    scanned = EVALUATOR_TRANSPILER.scan(draft.evaluator);
    transformed = EVALUATOR_TRANSPILER.transformSync(draft.evaluator);
  } catch (error) {
    return [`the check program did not compile: ${errorMessage(error)}`];
  }
  const parts: string[] = [];
  stripCode(transformed, 0, "whole", parts);
  const code = parts.join("");
  const reached = [
    ...(scanned.imports.length > 0 ? ["an import"] : []),
    ...OUTSIDE.flatMap(([spelled, what]) => (spelled.test(code) ? [what] : [])),
  ];
  const hasItems = draft.objective?.items !== undefined && draft.objective.items.length > 0;
  return [
    ...[...new Set(reached)].map(
      (what) =>
        `the check program reaches for ${what}: a check computes from its request alone, so that one answer gets one verdict on every host`,
    ),
    ...(scanned.exports.includes("checks") ? [] : ["the check program does not export `checks`"]),
    ...(draft.objective !== undefined && !hasItems && !scanned.exports.includes("objective")
      ? ["the draft declares an objective, and the check program does not export `objective`"]
      : []),
    ...(hasItems && !scanned.exports.includes("scores")
      ? ["the draft declares objective.items, and the check program does not export `scores`"]
      : []),
    ...(hasItems && scanned.exports.includes("objective")
      ? ["the draft declares objective.items, which uses `scores` rather than an `objective` export"]
      : []),
  ];
}

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
    ...rubricFaults(
      draft.objective,
      draft.checks.map(({ id }) => id),
    ),
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

function draftedFrom(args: Static<typeof DRAFT_PARAMETERS>): Draft {
  const { quantity, direction, scale, items, tools } = args.objective;
  const rubric: readonly RubricItem[] | undefined =
    items !== undefined && items.length > 0 ? items.map(({ id, weight }) => ({ id, weight })) : undefined;
  const objective: Objective | undefined =
    quantity !== undefined && direction !== undefined
      ? {
          quantity,
          direction,
          ...keyIfDefined("scale", rubric === undefined ? scale : "unit"),
          ...keyIfDefined("items", rubric),
        }
      : undefined;
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
    ...keyIfDefined("objective", objective),
    ...keyIfDefined("objectiveTools", tools !== undefined && tools.length > 0 ? tools : undefined),
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

export function draftOf(events: readonly LogEvent[]): Draft | null {
  const draft = asRecord(eventsOf(events, "exam.drafted").at(-1)?.event.data.draft);
  return draft === null ? null : parseJsonAs<Draft>(draft);
}

export function drafting(
  terms: DraftingTerms,
  within: <T>(action: () => Promise<T>) => Promise<T>,
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
        const { quantity, direction } = args.objective;
        const unformed = [
          ...((quantity === undefined) === (direction === undefined)
            ? []
            : [
                "the objective is a quantity with its direction, or neither: this draft gives one of the two",
              ]),
          ...draftFaults(draft),
        ];
        const faults =
          unformed.length > 0 ? unformed : await within(async () => await terms.reading(draft, home));
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
    enters: `A ${kind} enters the exam through ${put.name}, and .toolchain/ in your home is frozen beside it for declared verifier tools; nothing else in your home enters the exam`,
    nudge: `Put a ${kind} with ${put.name}`,
    finish:
      "End the session without an exam, only where none can be drafted for the prompt. Say in one or two sentences why.",
    declined: null,
    done: (): "stands" | null => (desk.stands ? "stands" : null),
    counted: () => ({ ...desk }),
    result: () => ({ puts: desk.tries, held: [], refused: [] }),
  } as const;
}
