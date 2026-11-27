import { type Static, Type } from "typebox";
import {
  answerFormatFault,
  codeObjective,
  type Objective,
  type RubricItem,
  rubricFaults,
} from "../kernel/contract.ts";
import { type ControlFile, DELIVERABLES } from "../kernel/answer-files.ts";
import { GAP_FLOOR } from "../kernel/compare.ts";
import { PER_CHECK_MS } from "../kernel/verify.ts";
import { REACH } from "./difficulty.ts";
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
      Type.Object({ path: Type.String({ minLength: 1 }), base64: Type.String({ minLength: 1 }) }),
      Type.Object({ path: Type.String({ minLength: 1 }), entries: Type.Array(TEXT_FILE) }),
    ]),
    {
      description: `Files beside the answer under ${DELIVERABLES.folder}/: { path, text }, { path, base64 } (use { "from_file": "<path>" } for binary .xlsx/.docx/.pdf/.sqlite/.png files built in your home), or { path, entries } for a stored archive.`,
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
export const TASK_FIELDS = {
  family: Type.String({ pattern: "\\S" }),
  public_input: Type.Unknown(),
  hidden: Type.Unknown({ description: "Null when the task has none." }),
};
export const CHECK_ITEM_SCHEMA = Type.Object({
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
});
export const EVALUATOR_SCHEMA = Type.Union([
  Type.String({ minLength: 1, description: "The check program's TypeScript source." }),
  Type.Object({ from_file: Type.String({ minLength: 1 }) }),
]);
export const RUBRIC_ITEM_SCHEMA = Type.Object({
  id: Type.String({ pattern: "^[a-z][a-z0-9-]*$" }),
  weight: Type.Number({ exclusiveMinimum: 0 }),
  kind: Type.Optional(Type.Union([Type.Literal("code"), Type.Literal("judge")])),
  criterion: Type.Optional(Type.String({ minLength: 1 })),
});
const OBJECTIVE_FIELDS = {
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
  tools: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description:
        "Installed programs `objective` invokes via `runtime.tools.run` (e.g. `python3`, `bash`, or a domain engine installed in the environment).",
    }),
  ),
};
const DRAFT_COMMON = {
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
  checks: Type.Array(CHECK_ITEM_SCHEMA, { minItems: 1 }),
  evaluator: EVALUATOR_SCHEMA,
  accept_controls: Type.Array(Type.Object(CONTROL)),
  reject_controls: Type.Array(
    Type.Object({ ...CONTROL, check: Type.String({ description: "The check that must refuse it." }) }),
  ),
};
const OBJECTIVE_DESCRIPTION =
  "A quantity with its direction, as the system prompt says, or empty where the exam has none.";
const DRAFT_PARAMETERS = Type.Object({
  ...DRAFT_COMMON,
  objective: Type.Object(
    {
      ...OBJECTIVE_FIELDS,
      items: Type.Optional(
        Type.Array(RUBRIC_ITEM_SCHEMA, {
          minItems: 1,
          description:
            'Weighted `[0, 1]` rubric items (`direction: "higher"`). Code items map via `scores[id](request, runtime) => number` in `[0, 1]`; optional `kind: "judge"` items take a one-line `criterion` (20-220 chars, never id `"holistic"`, at most 4) scored by swapped pairwise judging when qualitative substance cannot be checked in code.',
        }),
      ),
    },
    { description: OBJECTIVE_DESCRIPTION },
  ),
  tasks: Type.Array(Type.Object(TASK_FIELDS)),
});
type DraftArgs = Static<typeof DRAFT_PARAMETERS>;

const FLOOR = `${String(GAP_FLOOR * 100)}%`;

const LANE_CHOICE =
  'Choose the scoring lane the domain needs: use deterministic `code` items alone when quality is fully mechanical; use a minimal binary `valid` floor plus `kind: "judge"` items (one-line `criterion`, 20-220 chars, never id `"holistic"`, up to 4) for purely qualitative work; or pair graded `[0, 1]` `code` items with non-overlapping `kind: "judge"` items carrying substantial weight whenever both verifiable accuracy and deliverable quality, completeness, diagnostics, presentation and conclusions matter.';

const SYSTEM_PROMPT = [
  "You are the Examiner. Draft the campaign's fixed exam from the operator's prompt: public rules, scope, conventions, answer format, checks, objective, example tasks and controls. Later sessions write further tasks under this frozen contract and cannot change it.",
  `${TASK} Solvers receive public/task.json, public/resources/ and any public/files/, answer with answer.json matching answer_format, and pass validity when every check returns true. ${FAIR}`,
  `Deliverables and mixed workspaces: solvers may write files under ${DELIVERABLES.folder}/ (up to ${String(DELIVERABLES.count)} files, ${String(DELIVERABLES.bytes)} bytes total), passed to checks, objectives and pairwise judging as request.files ({ path, base64, text, entries }). When the prompt asks for real work products (such as .xlsx, .docx, .pdf, .ipynb, .sqlite or .png files), let answer.json be a compact manifest/summary while deliverables/ holds the full work products. Likewise, public_input.files accepts { path, text }, { path, base64 } (use { "from_file": "<path>" } to embed binary files built in your shell), or { path, entries }, placed under public/files/.`,
  `Harness comparisons score held-out tasks afresh on validity first, then on the objective between valid answers differing by at least ${FLOOR} of the larger measure (or ${FLOOR} on [0, 1] for rubric items). Ties leave the test, so an exam where every solve passes and ties separates nothing.`,
  `Who solves and difficulty calibration:\n\n${REACH}`,
  `Designing validity and the objective: hard-constraint domains separate harnesses on binary validity; multi-artifact analytical domains keep unambiguous structural/delivery/feasibility invariants as binary checks while the objective separates valid answers. Compute the objective via \`objective(request, runtime)\` or \`objective.items\` + \`scores\` mapping each code item to \`[0, 1]\`. ${LANE_CHOICE} Generate \`publicInput\` forward from exact \`hidden\` ground truth or mechanical invariants—never solve a task with a stronger model. Both \`objective\` and \`scores\` may read per-task rubric targets in \`request.hidden\`. Give every code rubric item smooth partial credit on \`[0, 1]\` (exact near 1, penalising wrong or hedged claims toward 0; avoid 0/1 cliffs and saturating presence checks). For judged items, focus criteria on full requirement coverage, formal diagnostics and method justification, clear presentation and visuals, and explicit quantitative findings or recommendations.`,
  `Rules, scope and conventions: the host enforces \`answer_format\` JSON Schema before checks run, so focus rules and checks on coupled domain invariants, artifact format and computation integrity, and executable behaviour while keeping surface formatting lenient. Any numeric or size bound in \`answer_format\` is a public rule and belongs in scope. Cite authoritative domain standards without restating their procedures or tables. ${UNHELD} Draft a broad scope covering every grade and regime (never listing planted faults). Honour every computable requirement in the operator's prompt at full strength.`,
  `Check program: one offline TypeScript module exporting \`checks\` (and \`objective\` or \`scores\` when declared) with no imports, network, clock or randomness. Each function takes \`(request, runtime)\` where \`request\` holds \`publicTask\`, \`artifact\`, \`hidden\` and \`files\`. Declare needed host or \`.toolchain/\` binaries (such as \`python3\`) in \`tools\` and call \`await runtime.tools.run({ toolId, args, files, stdin })\`. Checks must finish well under ${String(PER_CHECK_MS / 60_000)} minutes, throw rather than catching computation errors into \`false\`/\`0\`, hold stated bounds with small float epsilon (1e-9), and verify properties rather than comparing against a fixed reference answer.`,
  `Examples and controls: supply at least ${plural(EXAMPLES, "distinct example task")} (either all carry hidden values or none), one accept control per example (beating naive baselines by at least ${FLOOR} when an objective exists), and at least one format-valid reject control per check. Empty/minimal format-valid answers must fail every task. draft_exam validates the whole draft and returns any faults; a fault-free draft becomes the campaign's fixed exam.`,
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
  const scored = codeObjective(draft.objective);
  const hasItems = scored?.items !== undefined && scored.items.length > 0;
  return [
    ...[...new Set(reached)].map(
      (what) =>
        `the check program reaches for ${what}: a check computes from its request alone, so that one answer gets one verdict on every host`,
    ),
    ...(scanned.exports.includes("checks") ? [] : ["the check program does not export `checks`"]),
    ...(scored !== undefined && !hasItems && !scanned.exports.includes("objective")
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
  const checkIds = draft.checks.map(({ id }) => id);
  const again = twice(ruleIds) ?? twice(checkIds);
  const hidden = draft.tasks.filter((task) => task.hidden !== null).length;
  return [
    ...evaluatorFaults(draft),
    ...rubricFaults(draft.objective, checkIds),
    ...(again === undefined ? [] : [`${again} is named twice: an id names one rule or one check`]),
    ...draft.rules.flatMap(({ id }) => {
      const checked = draft.checks.filter((check) => check.rule === id).length;
      return checked >= 1
        ? []
        : [`rule ${id} has ${String(checked)} checks, and each rule needs at least one`];
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

function draftedFrom(args: DraftArgs): Draft {
  const { quantity, direction, items, tools } = args.objective;
  const rubric: readonly RubricItem[] | undefined =
    items !== undefined && items.length > 0
      ? items.map(({ id, weight, kind, criterion }) =>
          kind === "judge"
            ? { id, weight, kind, criterion: criterion ?? "" }
            : { id, weight, ...keyIfDefined("kind", kind) },
        )
      : undefined;
  const objective: Objective | undefined =
    quantity !== undefined && direction !== undefined
      ? {
          quantity,
          direction,
          ...keyIfDefined("scale", rubric === undefined ? undefined : ("unit" as const)),
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
        if (unformed.length === 0) desk.tries += 1;
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
    system: SYSTEM_PROMPT,
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
