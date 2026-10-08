/**
 * A candidate pack: a campaign's pack with one public rule and one check added, and the proof that
 * nothing else in it moved.
 *
 * A pack is laid out as v1 left one (`tools/m0/stored-sweep.ts`): `correctness-model/` holds
 * `brief.json`, `evaluator.ts`, whatever those read, and the battery, `tasks.json` and
 * `controls.json`; `.toolchain/` is the tool tree the checks run. check-program/v1 gives a check
 * two places: a row of the brief's `truthChecks`, and a function under its id in the `checks` that
 * `evaluator.ts` exports (`src/kernel/verify.ts`, `check-child.ts`). Both are single files, so an
 * author who added a check by hand would write each of them whole, and nothing short of reading
 * the two files would show that the checks already there were left alone. v1 is why that matters:
 * its Builder wrote its checks beside its harness, 36 of 47 rehearsal misses were a check's fault
 * (v1 #124), and when a task failed it changed the task more often than the harness.
 *
 * So the session that writes an addition (`session.ts`) never writes either file. It sends parts:
 * a rule's id and statement, a check's declaration, and one module of code. The host applies them:
 *
 * - `brief.json` is the pack's with one row appended to `ruleDecisions` and one to `truthChecks`.
 * - The pack's `evaluator.ts` is kept byte for byte as `evaluator.pack.ts`, in the same directory,
 *   so that its relative imports still resolve.
 * - The new check's module is `added/<check id>.ts`, and exports `check`.
 * - `evaluator.ts` is written by the host (`entryText`): the pack's `checks`, and under each added
 *   id a function that imports that check's module when it is called. A check runs in a process of
 *   its own, so a process deciding an existing check never loads a line of added code, and a module
 *   that does not load is its own check's fault and no other's.
 *
 * A pack that already holds an addition is recognised by that layout and takes the next one the
 * same way, so additions stay apart on disk and one can be read, and withdrawn by a person, alone.
 * An added module may import the pack's own program files and nothing else: not a package, not a
 * builtin, not another addition. The scan that holds it to that reads import statements and is no
 * wall: an import whose specifier is computed passes it. What keeps an added module from an
 * existing check is the entry and the verifier together. It may import the pack's evaluator, call
 * its checks and write over the `checks` object it imported, and all of that ends with the one
 * process that loaded it, which decides the added check and no other; each check also runs over
 * a copy of the program in a cell of its own (`runCheck` in `src/kernel/verify.ts`). What a module
 * can reach outside its cell is the verifier's wall to refuse and not this file's.
 *
 * Both new ids are one word of letters, digits, dots, dashes and underscores, and differ from
 * every id of their kind by more than case. A check's id names its module's file, and the Mac's
 * file system folds case; a rule's id is what a citation and a ruling name, and one that reads as
 * an existing rule's would let a citation be read two ways.
 *
 * `additive` is the proof, and it reads two directories and trusts no one's account of how the
 * second was made: every file of the pack is in the candidate with the same sha256, the brief's
 * existing rows are the same JSON at the same place, the entry is the text the host writes, and
 * what is new is exactly one rule row, one check row and one module. A brief row is compared as
 * canonical JSON and not as bytes, since a row is part of one file the host has to write again.
 * A candidate someone made by hand is held to the same proof.
 *
 * What a new check may declare is narrower than what a pack's author may. It receives no hidden
 * value: no existing task carries one for it, and a check that needs one cannot run on them. It
 * names only tools an existing check already names, so the instrument is one the campaign's
 * conditions already hash. Whether its rule's statement says enough is not proven here or
 * anywhere: that is a Referee's reading of its refusals (`src/kernel/contract.ts`).
 */
import type { Rule } from "../kernel/contract.ts";
import { CHECK_PROGRAM_CONTRACT, checkProgramFiles } from "../kernel/verify.ts";
import { CONTROLS_FILE, CORRECTNESS_MODEL_DIR, TASKS_FILE } from "../meta/bundle-layout.ts";
import { sha256OfFile } from "../meta/digest.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { jsonPathTokens } from "../meta/json-evidence.ts";
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isRecord, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { keyIfNotNull, keysIf } from "../meta/optional-key.ts";
import { basename, dirname, join, posix } from "../meta/path.ts";
import { assertPathSegment, isSafePathSegment } from "../meta/path-segment.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue, stableJson } from "../meta/stable-json.ts";
import { treeContent } from "../solve/harness.ts";

/** The parts of one addition, as a session sends them and the host applies them. */
export interface Addition {
  readonly rule: { readonly id: string; readonly statement: string };
  readonly check: {
    readonly id: string;
    /** What the check asserts of an answer, which a solver reads beside the rule. */
    readonly assertion: string;
    readonly families: "all" | readonly string[];
    /** Existing public rules the check enforces beside its own. */
    readonly cites: readonly string[];
    /** The paths of the answer and of the public input the check is handed. */
    readonly artifactPaths: readonly string[];
    readonly publicInputPaths: readonly string[];
    /** Tools of the verifier's tree the check runs. */
    readonly tools: readonly string[];
  };
  /** The check's module, which exports `check`. */
  readonly code: string;
}

/** What the proof found a candidate to add. */
export interface Added {
  readonly rule: Rule;
  readonly check: {
    readonly id: string;
    readonly assertion: string;
    readonly families: "all" | readonly string[];
  };
  /** The candidate's public rules as its brief holds them, the new one last: with the campaign's
   *  answer format, conventions and scope they are the candidate's contract. */
  readonly rules: readonly Rule[];
}

/** A check as a pack's brief declares it, which is what its author may read of it beside its code. */
export interface Declared {
  readonly id: string;
  readonly assertion: string;
  readonly families: "all" | readonly string[];
  /** The rules it cites, the paths of the answer and of the public input it is handed, and the
   *  tools it names. */
  readonly cites: readonly string[];
  readonly reads: readonly string[];
  readonly inputs: readonly string[];
  readonly tools: readonly string[];
}

/** Why a candidate is not the pack with one rule and one check added: every fault found. */
export interface Unproven {
  readonly faults: readonly string[];
}

/** A brief as far as an addition reads it: the whole object, and its two lists of rows. */
interface Rows {
  readonly whole: JsonObject;
  readonly rules: readonly JsonObject[];
  readonly checks: readonly JsonObject[];
}

const BRIEF = "brief.json";
const ENTRY = "evaluator.ts";
/** The pack's own `evaluator.ts`, byte for byte, once the host has written the entry over it. */
const PACK_ENTRY = "evaluator.pack.ts";
const ADDED = "added";
const RULES = "ruleDecisions";
const CHECKS = "truthChecks";
const TOOL_TREE = ".toolchain";
/** The files of a pack's `correctness-model/` that are its battery and no part of its check
 *  program: a staged program leaves them out, so no check's module can read them. */
const BATTERY = new Set([TASKS_FILE, CONTROLS_FILE].map((file) => basename(file)));

/** A pack's `correctness-model/` directory. */
export const modelOf = (pack: string) => join(pack, CORRECTNESS_MODEL_DIR);

/** An added check's module, by its path under the check program. */
const moduleOf = (id: string) => `${ADDED}/${id}.ts`;

/**
 * The entry the host writes over a pack's own evaluator: its checks, and each added check loaded
 * when it is called. The text is a function of the added ids alone, so the proof writes it again
 * and compares.
 */
export function entryText(ids: readonly string[]): string {
  return [
    `// Written by the host over ${PACK_ENTRY}, which is the pack's own evaluator byte for byte.`,
    "// Each check below it was added alone, and its module is loaded only when that check runs.",
    `import { checks as pack } from "./${PACK_ENTRY}";`,
    "",
    "export const checks = {",
    "  ...pack,",
    ...ids.map(
      (id) =>
        `  ${capturedJsonStringify(id)}: async (request, runtime) => (await import(${capturedJsonStringify(`./${moduleOf(id)}`)})).check(request, runtime),`,
    ),
    "};",
    "",
  ].join("\n");
}

/** A model directory's brief. Throws when it does not read as one. */
function rowsOf(model: string): Rows {
  const whole = asRecord(capturedJsonParse(readFileSync(join(model, BRIEF), "utf8")));
  const [rules, checks] = [whole?.[RULES], whole?.[CHECKS]];
  if (
    whole === null ||
    !Array.isArray(rules) ||
    !Array.isArray(checks) ||
    ![...rules, ...checks].every(isRecord)
  ) {
    throw new Error(`${BRIEF} holds no ${RULES} and ${CHECKS} of rows`);
  }
  // SAFETY: every row was just held to a record.
  return { whole, rules: rules as JsonObject[], checks: checks as JsonObject[] };
}

/**
 * The checks added to a model directory so far, in the brief's order; none for a pack as its
 * author left it. A directory that holds `evaluator.pack.ts` under an entry the host did not write
 * is in neither form, and nothing can be proven over it.
 */
function addedTo(model: string, rows: Rows): string[] {
  if (!existsSync(join(model, PACK_ENTRY))) return [];
  const ids = rows.checks.flatMap(({ id }) =>
    isString(id) && isSafePathSegment(id) && existsSync(join(model, moduleOf(id))) ? [id] : [],
  );
  if (readFileSync(join(model, ENTRY), "utf8") !== entryText(ids)) {
    throw new Error(`${ENTRY} is not the entry the host writes over ${PACK_ENTRY}`);
  }
  return ids;
}

/**
 * Write the candidate's `correctness-model/` under `to`: the pack's, whole, with the addition
 * applied. Nothing is judged here but that the check's id can name a file; `additive` judges the
 * result. The tool tree is not copied: it runs to gigabytes, and a candidate still being tried
 * runs on the pack's own.
 */
export function writeCandidate(pack: string, addition: Addition, to: string): void {
  const { rule, check, code } = addition;
  assertPathSegment("check id", check.id);
  const model = modelOf(to);
  cpSync(modelOf(pack), model, { recursive: true, verbatimSymlinks: true });
  const rows = rowsOf(model);
  const ids = addedTo(model, rows);
  if (ids.length === 0) renameSync(join(model, ENTRY), join(model, PACK_ENTRY));
  mkdirSync(join(model, ADDED), { recursive: true });
  writeFileSync(join(model, moduleOf(check.id)), code);
  writeFileSync(join(model, ENTRY), entryText([...ids, check.id]));
  const families = check.families === "all" ? null : [...check.families];
  const brief: JsonObject = {
    ...rows.whole,
    [RULES]: [
      ...rows.rules,
      {
        id: rule.id,
        visibility: "public",
        statement: rule.statement,
        ...keyIfNotNull("families", families),
        ...keysIf(check.publicInputPaths.length > 0, () => ({
          publicInputPaths: [...check.publicInputPaths],
        })),
      },
    ],
    [CHECKS]: [
      ...rows.checks,
      {
        id: check.id,
        assertion: check.assertion,
        citedDecisionIds: [rule.id, ...check.cites],
        execution: {
          families: families ?? "all",
          artifactPaths: [...check.artifactPaths],
          publicInputPaths: [...check.publicInputPaths],
          hidden: "none",
          ...keysIf(check.tools.length > 0, () => ({ requiredToolIds: [...check.tools] })),
          // The label is the host's and not the session's to choose: whatever tool the code runs,
          // the code around it is its author's own, and v1's stand-ins were labelled otherwise.
          evidence: { kind: "authored" },
        },
      },
    ],
  };
  writeFileSync(join(model, BRIEF), `${capturedJsonStringify(brief, null, 2)}\n`);
}

/** A list of strings, or null where the value is not one. */
function pathsOf(value: JsonValue | undefined): readonly string[] | null {
  return Array.isArray(value) && value.every(isString) ? value : null;
}

/** A brief's public rules, each row whole: with a campaign's answer format, conventions and scope
 *  they are its contract (`contractOf` in `tools/m0/stored-sweep.ts`). */
function publicRules(rows: Rows): Rule[] {
  return rows.rules.flatMap((row): Rule[] =>
    row.visibility === "public" && isString(row.id) && isString(row.statement)
      ? // SAFETY: a rule row holds its id and its statement, as the guard beside this proves.
        [row as JsonObject & Rule]
      : [],
  );
}

/** The tools a check row names, wherever its evidence kind has it name them (`requiredToolsOf`). */
function toolsOf(row: JsonObject): readonly string[] {
  const execution = asRecord(row.execution);
  return [
    ...(pathsOf(execution?.requiredToolIds) ?? []),
    ...(pathsOf(asRecord(execution?.evidence)?.requiredToolIds) ?? []),
  ];
}

/** What is wrong with the one check row a candidate adds, beside the rules it may cite and the
 *  tools it may name: every fault, a sentence each. */
function rowFaults(row: JsonObject, citable: ReadonlySet<string>, tools: ReadonlySet<string>): string[] {
  const execution = asRecord(row.execution);
  const cited = pathsOf(row.citedDecisionIds) ?? [];
  const families = pathsOf(execution?.families);
  const scoped =
    execution?.families === "all" || (families !== null && families.length > 0 && !families.includes(""));
  const read = pathsOf(execution?.artifactPaths);
  const inputs = pathsOf(execution?.publicInputPaths);
  const evidence = asRecord(execution?.evidence)?.kind;
  return [
    ...(isString(row.assertion) && row.assertion.trim() !== "" ? [] : ["the new check asserts nothing"]),
    ...cited.flatMap((id) => (citable.has(id) ? [] : [`the new check cites ${id}, which is no public rule`])),
    ...(scoped ? [] : ["the new check names no family: `all`, or a list of families"]),
    ...((read?.length ?? 0) > 0 ? [] : ["the new check reads no path of the answer"]),
    ...(inputs === null ? ["the new check declares no list of public input paths"] : []),
    ...[...(read ?? []), ...(inputs ?? [])].flatMap((path) =>
      jsonPathTokens(path) === null ? [`${path} is not a path as the checks spell theirs`] : [],
    ),
    // No existing task carries a hidden value for a check that did not exist, so a check that
    // asks for one could run on none of them (`checkEvaluationRequest`).
    ...(execution?.hidden === "none" ? [] : ["the new check asks for a hidden value, which no task holds"]),
    ...(evidence === "authored" || evidence === "external"
      ? []
      : ["the new check declares no evidence kind"]),
    ...toolsOf(row).flatMap((tool) =>
      tools.has(tool) ? [] : [`the new check names the tool ${tool}, which no existing check names`],
    ),
  ];
}

/** What an added module imports that it may not: anything but a file of the pack's own program,
 *  by a relative path. A module that does not parse is one fault, its parser's. */
function importFaults(model: string, id: string, programFiles: ReadonlySet<string>): string[] {
  let imported: { path: string }[];
  try {
    imported = new Bun.Transpiler({ loader: "ts" }).scanImports(
      readFileSync(join(model, moduleOf(id)), "utf8"),
    );
  } catch (error) {
    return [`${moduleOf(id)} does not parse: ${errorMessage(error).split("\n")[0] ?? ""}`];
  }
  return imported.flatMap(({ path }) => {
    const target = posix.normalize(posix.join(ADDED, path));
    return path.startsWith(".") && programFiles.has(target)
      ? []
      : [`${moduleOf(id)} imports ${path}, which is not a file of the pack's own check program`];
  });
}

/**
 * The proof that `candidate` is `pack` with one rule and one check added: what it adds, or every
 * fault that says it is something else. `tools` says whether the candidate's tool tree is held to
 * the pack's too, by every entry's path, mode and content, or only its `correctness-model/`, as
 * while a candidate is still being tried and has no tree of its own.
 */
export function additive(
  pack: string,
  candidate: string,
  tools: "with-tools" | "model-only",
): Added | Unproven {
  const [before, after] = [modelOf(pack), modelOf(candidate)];
  let was: Rows;
  let now: Rows;
  let earlier: string[];
  let files: Set<string>;
  try {
    was = rowsOf(before);
    earlier = addedTo(before, was);
  } catch (error) {
    return { faults: [`the pack cannot take an addition: ${errorMessage(error)}`] };
  }
  try {
    now = rowsOf(after);
    files = new Set(checkProgramFiles(after));
  } catch (error) {
    return { faults: [`the candidate does not read: ${errorMessage(error)}`] };
  }
  const faults: string[] = [];
  // The brief: every key but the two lists as it was, and each list its old rows and one more.
  const rest = (rows: Rows) => stableJson({ ...rows.whole, [RULES]: null, [CHECKS]: null });
  if (rest(was) !== rest(now)) faults.push(`${BRIEF} differs from the pack's outside its rules and checks`);
  if (was.whole.correctnessContract !== CHECK_PROGRAM_CONTRACT) {
    faults.push(`the pack's ${BRIEF} is not ${CHECK_PROGRAM_CONTRACT}`);
  }
  for (const [list, old, grown] of [
    [RULES, was.rules, now.rules],
    [CHECKS, was.checks, now.checks],
  ] as const) {
    if (grown.length !== old.length + 1) {
      faults.push(
        `${list} holds ${String(grown.length)} rows where the pack's ${String(old.length)} and one more were due`,
      );
    }
    faults.push(
      ...old.flatMap((row, index) =>
        stableJson(row) === stableJson(grown[index] ?? null)
          ? []
          : [
              `${list} row ${String(index + 1)} (${isString(row.id) ? row.id : "no id"}) is not the pack's own`,
            ],
      ),
    );
  }
  if (faults.length > 0) return { faults };
  const [rule, check] = [now.rules.at(-1) ?? {}, now.checks.at(-1) ?? {}];
  const { id, statement } = rule;
  const checkId = check.id;
  /** Whether a row of `rows` holds `named` as its id, case apart. */
  const taken = (rows: readonly JsonObject[], named: string) =>
    rows.some((row) => isString(row.id) && row.id.toLowerCase() === named.toLowerCase());
  if (!isString(id) || !isSafePathSegment(id)) {
    faults.push(
      `the new rule's id is not one word of letters, digits, dots, dashes and underscores: ${capturedJsonStringify(id ?? null)}`,
    );
  } else if (taken(was.rules, id)) {
    faults.push(`the new rule's id is not a new one: ${id}`);
  }
  if (rule.visibility !== "public" || !isString(statement) || statement.trim() === "") {
    faults.push("the new rule is not a public rule with a statement");
  }
  if (!isString(checkId) || !isSafePathSegment(checkId) || taken(was.checks, checkId)) {
    faults.push(
      `the new check's id is not a new one that can name its module: ${isString(checkId) ? checkId : "none"}`,
    );
  }
  if (!isString(id) || !isString(checkId) || !isString(statement) || faults.length > 0) return { faults };
  const published = publicRules(now);
  if (!(pathsOf(check.citedDecisionIds) ?? []).includes(id)) {
    faults.push(`the new check ${checkId} does not cite the new rule ${id}`);
  }
  faults.push(
    ...rowFaults(check, new Set(published.map((row) => row.id)), new Set(was.checks.flatMap(toolsOf))),
  );
  // The files: the pack's own under their names, its evaluator kept whole, and three that the
  // host writes or places.
  const kept = checkProgramFiles(before).filter((file) => file !== BRIEF && file !== ENTRY);
  faults.push(
    ...kept.flatMap((file) =>
      files.has(file) && sha256OfFile(join(after, file)) === sha256OfFile(join(before, file))
        ? []
        : [`${file} is not the pack's own`],
    ),
  );
  if (
    earlier.length === 0 &&
    !(files.has(PACK_ENTRY) && sha256OfFile(join(after, PACK_ENTRY)) === sha256OfFile(join(before, ENTRY)))
  ) {
    faults.push(`the pack's ${ENTRY} is not kept whole as ${PACK_ENTRY}`);
  }
  if (!files.has(ENTRY) || readFileSync(join(after, ENTRY), "utf8") !== entryText([...earlier, checkId])) {
    faults.push(`${ENTRY} is not the entry the host writes for ${[...earlier, checkId].join(", ")}`);
  }
  const due = new Set([...kept, BRIEF, ENTRY, PACK_ENTRY, moduleOf(checkId)]);
  faults.push(
    ...[...files].flatMap((file) =>
      due.has(file) ? [] : [`${file} is no part of the pack or of one check`],
    ),
  );
  if (files.has(moduleOf(checkId))) {
    const program = kept.filter((file) => !BATTERY.has(basename(file)) && dirname(file) !== ADDED);
    faults.push(...importFaults(after, checkId, new Set([...program, PACK_ENTRY])));
  } else {
    faults.push(`the new check has no module at ${moduleOf(checkId)}`);
  }
  const treeOf = (dir: string) =>
    existsSync(join(dir, TOOL_TREE)) ? hashJsonValue(treeContent(join(dir, TOOL_TREE))) : null;
  if (tools === "with-tools" && treeOf(candidate) !== treeOf(pack)) {
    faults.push(`${TOOL_TREE} is not the pack's own tool tree`);
  }
  if (faults.length > 0) return { faults };
  const families = asRecord(check.execution)?.families;
  return {
    rule: { id, statement },
    check: {
      id: checkId,
      assertion: isString(check.assertion) ? check.assertion : "",
      families: families === "all" ? "all" : (pathsOf(families) ?? []),
    },
    rules: published,
  };
}

/** A pack's public rules and its checks, as its brief declares them. Throws on a brief that does
 *  not read. */
export function declared(pack: string) {
  const rows = rowsOf(modelOf(pack));
  return {
    rules: publicRules(rows),
    checks: rows.checks.map((row): Declared => {
      const execution = asRecord(row.execution);
      return {
        id: isString(row.id) ? row.id : "",
        assertion: isString(row.assertion) ? row.assertion : "",
        families: execution?.families === "all" ? "all" : (pathsOf(execution?.families) ?? []),
        cites: pathsOf(row.citedDecisionIds) ?? [],
        reads: pathsOf(execution?.artifactPaths) ?? [],
        inputs: pathsOf(execution?.publicInputPaths) ?? [],
        tools: toolsOf(row),
      };
    }),
  };
}

/** Copy the pack's tool tree into a candidate that has none, links verbatim, as a Builder's
 *  session copies its parent's (`src/builder/session.ts`). A pack with no tree leaves none. */
export function copyTools(pack: string, candidate: string): void {
  const held = join(pack, TOOL_TREE);
  if (existsSync(held)) cpSync(held, join(candidate, TOOL_TREE), { recursive: true, verbatimSymlinks: true });
}
