/**
 * `probe_check`, the epoch reviewer's one executing tool. Every other authority the reviewer has
 * reads bytes: it opens source, quotes it and reasons about it. A reader that cannot execute cannot
 * demonstrate, so without this tool `demonstrated()` can only ever mean a length of prose. What
 * that costs is a review whose defect finding concedes inside its own claim that nothing is
 * presently mis-decided, and whose two decisive observations are filed as observations, which ask
 * for no repair and so change nothing.
 *
 * A probe changes one field of a known-correct accept control and runs the candidate's own declared
 * checks over the original and the changed artifact through `runControls` — the same path the
 * control census uses, so a probe cannot decide anything the census would decide differently. The
 * answer is a fact about the evaluation rather than a reading of it: which declared checks moved
 * their verdict when that one field changed.
 *
 * The change is a whole replacement value, or an edit of one passage inside a text leaf. The edit
 * exists because a rule's second reading is often a line of code: when the artifact is a source
 * file, the field the two readings disagree about is that whole file, and a probe that could only
 * replace it whole asked the reviewer to retype thousands of characters to move one anchor. The
 * census cannot answer that question for it either, because the accept controls were all written
 * under the reference's reading.
 *
 * It is a narrow fact, and the host says so, because the wider reading is false. No check moving
 * does not mean no check reads the field: `mass <= maxMass` observes `mass` and accepts both 8 and 9
 * against a limit of 10. An `unobserved` finding still needs the reviewer to show that the changed
 * artifact breaks a public obligation and was accepted anyway; the probe supplies the verdicts, not
 * that judgement. Nor is a returned pair a settled one — a timeout or a thrown check comes back as
 * an ordinary non-result receipt with no blocking checks, which would otherwise read exactly like
 * "no check moved".
 *
 * Its authority ends there. A probe writes no candidate byte, reaches no hidden expectation the
 * checks do not already receive, and changes no pass, acceptance, claim or promotion. It runs at
 * most `PROBE_BUDGET` times in a review, over accept controls the candidate itself published, and
 * the changed path must already exist in the artifact: inventing a field would report "no check
 * reads it" about something the artifact never carried.
 *
 * Probe rows are review evidence like the reviewer's prose and stay private under the same rule.
 * Only `epoch-review-public.ts` crosses to authoring, and of a probe a finding cites it projects
 * the control, the path and the checks that moved — never the value or the edit.
 */
import { readFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import { type Brief, externalChecksOf } from "../truth/brief.ts";
import { validateBrief } from "../truth/brief-validator.ts";
import type { ControlCorpus } from "../truth/controls.ts";
import { type EvaluatorFn, loadCorrectnessModel } from "../truth/contracts.ts";
import { evaluateCheckProgram } from "../truth/predicate.ts";
import { runControls } from "../truth/run-controls.ts";
import type { BuildTask } from "../truth/tasks.ts";
import type { ControlReceipt, ControlReceiptOutcome } from "../truth/battery-record.ts";
import { resolveVerifier } from "../truth/verification-registry.ts";
import { loadRecordedTasks } from "../run/run-driver.ts";
import {
  type VerifierLifetime,
  closeVerifierLifetime,
  createVerifierLifetime,
} from "../verify/verifier-lifetime.ts";
import type { VerifierHostHandle } from "../verify/verifier-port.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { jsonPathTokens, plainRecord } from "../meta/json-evidence.ts";
import { type JsonValue, isNumber, isString } from "../meta/json-shape.ts";
import { type ReaderTool, type ReaderToolResult, readerParameters, readerToolText } from "./review-reader.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { boundText } from "../meta/bounded-text.ts";
import { BRIEF_FILE, CONTROLS_FILE } from "../meta/bundle-layout.ts";
import { contractDefect } from "../analyse/finding-owner.ts";

/** Probes per review. Each one loads the generated check program in a confined child and may launch
 *  the declared external tools, so it costs about what one census control costs. Eight is enough to
 *  settle the artifact roots a single review can argue about, and small enough that a review cannot
 *  turn into a second census. */
export const PROBE_BUDGET = 8;
/** A replacement value is one field, not a redesigned artifact, and each half of an edit is one
 *  passage. A whole file past this ceiling is still reachable, by an edit of the passage that
 *  matters rather than a retyped file. */
const VALUE_MAX_CHARS = 4_000;
/** What a probe changed: a whole replacement value as the reviewer wrote it, or the one passage of
 *  a text leaf that `find` names, rewritten to `replace`. */
type ProbeEdit = { find: string; replace: string };
type ProbeChange = { value: string } | ProbeEdit;
/** What one probe executed and what the candidate's own checks said about it. Private review
 *  evidence, because `blockingCheckIds` is verifier detail. */
export type ReviewProbeRow = {
  /** 1-based, and what a finding cites in `probeIds`. */
  id: number;
  controlId: string;
  taskId: string;
  path: string;
  change: ProbeChange;
  baseline: ProbeSide | null;
  mutated: ProbeSide | null;
  /** Declared checks whose verdict the one changed field moved. Empty is the decisive negative: no
   *  declared check applicable to this task reads that field. */
  movedCheckIds: string[];
  /** Why nothing executed; null when the pair ran. */
  refused: string | null;
  /** Set when a finding this review recorded rests on the row, which makes it one of the
   *  demonstrations the next authoring review of the round is shown (`carriedDemonstrations`). A
   *  failed turn keeps the mark and drops the finding, so it carries nothing. */
  cited?: true;
};

type ProbeSide = { outcome: ControlReceiptOutcome; blockingCheckIds: string[] };

export type ProbeState = { rows: ReviewProbeRow[]; refused: number };

type ProbeRequest = { controlId: string; path: string; change: ProbeChange };

type ProbeCandidate = {
  brief: Brief;
  evaluate: EvaluatorFn;
  corpus: ControlCorpus;
  tasks: BuildTask[];
  verifier: VerifierHostHandle | undefined;
  lifetime: VerifierLifetime;
};

/** The tool and the lifetime it opened: the caller settles the lifetime once its turn is over. */
type ReviewProbeHandle = { tool: ReaderTool; close: (failed: boolean) => Promise<void> };

/** Control ids unique per probe, not per review. `probeTool` reuses one verifier, whose evidence
 *  log accumulates and is keyed by phase, subject id and attempt alone, and every `runControls`
 *  call starts again at attempt 1. Under one shared id, `hostNonResult` would settle this probe
 *  from an earlier probe's timeout row. */
const baselineId = (probe: number) => `review-probe-${probe}-baseline`;
const mutatedId = (probe: number) => `review-probe-${probe}-mutated`;

export function emptyProbeState(): ProbeState {
  return { rows: [], refused: 0 };
}

/** Both sides answered, so the comparison carries information. `runControls` does not throw when an
 *  evaluation fails to decide: a timeout, a thrown check, an unknown task or a pending cleanup
 *  settles as an ordinary non-result receipt with no blocking checks, and a pair like that is
 *  indistinguishable from "no check moved" by the ids alone. The original must also pass, because a
 *  changed artifact says nothing against a control the checks already refuse. */
function conclusive(row: ReviewProbeRow): boolean {
  return (
    row.refused === null &&
    row.baseline?.outcome === "pass" &&
    (row.mutated?.outcome === "pass" || row.mutated?.outcome === "fail")
  );
}

/** The probe rows a finding cites that are executed evidence. A finding citing an id that never
 *  ran, a probe the host refused, or a pair that reached no verdict is not probe-backed: the
 *  reviewer would be crediting its own request rather than a result.
 *
 *  It returns the rows rather than their numbers, because the recorder needs both — the numbers for
 *  the reviewer's own evidence prose, and the control, path and moved checks for the public
 *  projection, which the finding otherwise reaches with its check name alone. */
export function probeBackedRows(state: ProbeState, cited: JsonValue | undefined): ReviewProbeRow[] {
  if (!Array.isArray(cited)) return [];
  const numbers = new Set(cited.filter(isNumber));
  return state.rows.filter((row) => conclusive(row) && numbers.has(row.id)).sort((a, b) => a.id - b.id);
}

/** A review that executed probes and then records a defect without saying whether it rests
 *  on them loses the one route to a first-occurrence blocking finding, and its evidence record
 *  cannot link the finding to the rows that support it — which is exactly what a reviewer does when
 *  it narrates what its probes returned inside the claim prose and leaves `probeIds` unset. Asking
 *  costs one argument, and `probeIds: []` is the answer when the reading came from source alone. */
export function probeCitationRefusal(
  finding: { defect: boolean | null; owner: string | null },
  state: ProbeState,
  cited: JsonValue | undefined,
): string | null {
  if (!contractDefect(finding) || cited !== undefined) return null;
  const ran = state.rows.filter(conclusive).map((row) => row.id);
  if (ran.length === 0) return null;
  return `this review executed probe${ran.length === 1 ? "" : "s"} ${ran.join(", ")}; a defect must say what it rests on. Retry with probeIds naming the probes whose result supports it, or probeIds: [] when you read this from source alone`;
}

/** Load the candidate's own contract the way measurement loads it: the validated brief, the
 *  generated check program in its confined child, the published corpus and the recorded battery.
 *  Loading it any other way would make the probe an answer about a different program. */
async function openCandidate(root: string, lifetimeRoot: string): Promise<ProbeCandidate> {
  const lifetime = createVerifierLifetime({ root: lifetimeRoot });
  const briefUnknown: unknown = parseJsonAs(readFileSync(join(root, BRIEF_FILE), "utf8"));
  const validation = validateBrief(briefUnknown);
  if (!validation.ok) {
    throw new Error("the candidate's brief does not validate, so its declared checks cannot be run");
  }
  const brief =
    /* SAFETY: `validateBrief` reported ok directly above, which is the only proof of this shape. */ briefUnknown as Brief;
  const evaluate = evaluateCheckProgram(brief, await loadCorrectnessModel(root, lifetime));
  const corpus = parseJsonAs<ControlCorpus>(readFileSync(join(root, CONTROLS_FILE), "utf8"));
  const toolIds = externalChecksOf(brief).map((check) => check.adapterId);
  const verifier =
    toolIds.length === 0
      ? undefined
      : resolveVerifier({
          toolTree: bundleSnapshotToolTree(root),
          bundleDir: root,
          toolIds,
          verifierLifetime: lifetime,
        }).verifier;
  return { brief, evaluate, corpus, tasks: loadRecordedTasks(root), verifier, lifetime };
}

/** One step down a rooted path, taking the tokens `jsonPathTokens` produces: `[0]` into an array,
 *  `.name` into a plain object. `undefined` means the path does not exist here. */
function stepInto(value: JsonValue | undefined, token: string): JsonValue | undefined {
  if (token.startsWith("[")) return Array.isArray(value) ? value[Number(token.slice(1, -1))] : undefined;
  return plainRecord(value)?.[token.slice(1)];
}

/**
 * A copy of `artifact` with one already-present field replaced, rebuilt along the path and sharing
 * everything else. Null when the path does not resolve: a probe that added a field would answer
 * "no declared check reads it" about a field the artifact never carried, which is true and useless.
 *
 * The path is the rooted spelling the candidate's own checks declare — `$.layout.members[0].area`,
 * read through `jsonPathTokens`, the one grammar a reviewer copying a path out of those
 * declarations can use.
 */
export function withReplacedField(artifact: JsonValue, path: string, value: JsonValue): JsonValue | null {
  const tokens = jsonPathTokens(path);
  if (tokens === null || tokens.length === 0) return null;
  return replacedAt(artifact, tokens, value) ?? null;
}

/**
 * The leaf at `path` with the one passage `find` names rewritten to `replace`, which is what an edit
 * hands `withReplacedField` in place of a value. Where that leaf is not text holding `find` exactly
 * once it comes back as it was, so the probe is refused as a change that changes nothing; overlapping
 * occurrences count, since `aa` in `aaa` names two passages and editing either would be a guess. The
 * text is sliced rather than passed through `String.replace`, which reads `$&` in a replacement as a
 * pattern, and code is full of dollar signs.
 */
export function editedPassage(artifact: JsonValue, path: string, edit: ProbeEdit): JsonValue {
  const text = (jsonPathTokens(path) ?? []).reduce<JsonValue | undefined>(stepInto, artifact) ?? null;
  if (!isString(text)) return text;
  const at = text.indexOf(edit.find);
  return at === -1 || at !== text.lastIndexOf(edit.find)
    ? text
    : `${text.slice(0, at)}${edit.replace}${text.slice(at + edit.find.length)}`;
}

/** A token spelled back into the grammar, with a key that is not a plain name in quotes. */
const spelled = (token: string) =>
  token.startsWith("[") || /^\.[A-Za-z_][A-Za-z0-9_-]*$/.test(token) ? token : `['${token.slice(1)}']`;

/** What the deepest step a path reached holds, so a refusal can say where the path stopped. */
function stepContents(at: JsonValue, prefix: string): string {
  if (Array.isArray(at)) return `${prefix} holds ${at.length} element${at.length === 1 ? "" : "s"}`;
  const record = plainRecord(at);
  if (record === null) return `${prefix} is a leaf`;
  return `${prefix} carries ${Object.keys(record).slice(0, 12).join(", ") || "no keys"}`;
}

/** The quoted spelling that reaches a key an unquoted dot split: `.design.json` below a record that
 *  carries `design.json` becomes `['design.json']`. Empty when no run of the remaining name steps
 *  joins into a key the record carries. */
function quotedSpelling(at: JsonValue, prefix: string, rest: readonly string[]): string {
  const record = plainRecord(at);
  if (record === null) return "";
  const bracket = rest.findIndex((token) => token.startsWith("["));
  const names = (bracket === -1 ? rest : rest.slice(0, bracket)).map((token) => token.slice(1));
  for (let count = names.length; count >= 2; count -= 1) {
    const key = names.slice(0, count).join(".");
    if (Object.hasOwn(record, key)) return `${prefix}${spelled(`.${key}`)}${rest.slice(count).join("")}`;
  }
  return "";
}

/**
 * Why `path` names nothing in `artifact`, in words that are true of the path as written. A path
 * outside the grammar is told so rather than that its field is absent, because the field may well
 * be there: the bare spelling `files.src/main.cpp` names a file the control carries. A rooted path
 * is told where it stopped and what that step carries, and when an unquoted dot split a key that
 * step does carry, it is given the quoted spelling that reaches it.
 */
export function missingFieldRefusal(artifact: JsonValue, path: string, controlId: string): string {
  const tokens = jsonPathTokens(path);
  if (tokens === null || tokens.length === 0) {
    return `${path} is not a rooted path; spell it as the declared checks do, \`$.layout.members[0].area\`, with a key holding a dot or a slash quoted: \`$.files['src/main.cpp']\``;
  }
  let at = artifact;
  let depth = 0;
  for (const token of tokens) {
    const next = stepInto(at, token);
    if (next === undefined) break;
    at = next;
    depth += 1;
  }
  const prefix = `$${tokens.slice(0, depth).map(spelled).join("")}`;
  const quoted = quotedSpelling(at, prefix, tokens.slice(depth));
  return `${path} is not an existing field of control ${controlId}: ${stepContents(at, prefix)}${quoted === "" ? "" : `; a key holding a dot is quoted, as in ${quoted}`}. Probe a path the artifact already carries`;
}

/** `value` with the field at `tokens` replaced, or `undefined` when a step is missing. A step that
 *  resolved proves its own kind, because `stepInto` returns `undefined` for a `[i]` into anything
 *  but an array and for a `.name` into anything but a plain object; that is why the rebuild below
 *  may branch on `Array.isArray` alone once the recursion has come back with a value. */
function replacedAt(value: JsonValue, tokens: readonly string[], leaf: JsonValue): JsonValue | undefined {
  const [token, ...rest] = tokens;
  if (token === undefined) return leaf;
  const child = stepInto(value, token);
  const next = child === undefined ? undefined : replacedAt(child, rest, leaf);
  if (next === undefined) return undefined;
  if (Array.isArray(value)) return value.with(Number(token.slice(1, -1)), next);
  return { ...plainRecord(value), [token.slice(1)]: next };
}

const sideOf = (receipt: ControlReceipt | undefined): ProbeSide | null =>
  receipt === undefined
    ? null
    : { outcome: receipt.observedOutcome, blockingCheckIds: [...receipt.observedBlockingCheckIds].sort() };

/** Checks that decided one artifact and not the other. The comparison is symmetric because a
 *  replacement that makes a refusing check stop refusing is the same evidence as one that makes it
 *  start: either way the check read the field, which is the only thing a probe answers. */
function movedChecks(baseline: ProbeSide | null, mutated: ProbeSide | null): string[] {
  if (baseline === null || mutated === null) return [];
  const before = new Set(baseline.blockingCheckIds);
  const after = new Set(mutated.blockingCheckIds);
  return [
    ...new Set([
      ...baseline.blockingCheckIds.filter((id) => !after.has(id)),
      ...mutated.blockingCheckIds.filter((id) => !before.has(id)),
    ]),
  ].sort();
}

/** Run the pair through the census path. The synthetic corpus declares both artifacts as accepts
 *  because an accept is evaluated against every applicable check, which is the whole question a
 *  probe asks. `runControls` will then also report that the changed artifact failed as an accept,
 *  and that finding is about a corpus this candidate never published, so only `controlReceipts` is
 *  read here and everything else the execution returns is dropped. */
async function runPair(
  candidate: ProbeCandidate,
  probe: number,
  taskId: string,
  artifact: JsonValue,
  mutated: JsonValue,
): Promise<ControlReceipt[]> {
  const corpus: ControlCorpus = {
    accept: [
      { id: baselineId(probe), taskId, artifact },
      { id: mutatedId(probe), taskId, artifact: mutated },
    ],
    reject: [],
  };
  const execution = await runControls(
    candidate.evaluate,
    corpus,
    candidate.tasks,
    {
      brief: candidate.brief,
      externalChecks: externalChecksOf(candidate.brief),
      lanes: 1,
      verifierLifetime: candidate.lifetime,
    },
    candidate.verifier,
  );
  return execution.controlReceipts;
}

/** The reply names an edit by its size rather than echoing it, because the reviewer wrote both
 *  halves and the leaf around them can run to thousands of characters. */
function renderRow(row: ReviewProbeRow): string {
  if (row.refused !== null) return `probe ${row.id} did not run: ${row.refused}`;
  const side = (label: string, value: ProbeSide | null) =>
    `  ${label}: ${value === null ? "no receipt" : `${value.outcome}${value.blockingCheckIds.length === 0 ? "" : `, blocked by ${value.blockingCheckIds.join(", ")}`}`}`;
  const change =
    "find" in row.change
      ? `edited, its one passage of ${row.change.find.length} characters rewritten as ${row.change.replace.length}`
      : `replaced with ${row.change.value}`;
  return [
    `probe ${row.id}: accept control ${row.controlId} (task ${row.taskId}), ${row.path} ${change}`,
    side("original", row.baseline),
    side("changed", row.mutated),
    row.movedCheckIds.length === 0
      ? `  no declared check changed its verdict for this replacement. That alone does not show ${row.path} is unobserved: a check that reads it may simply accept the new value too. To record unobserved, say which public obligation the changed artifact breaks while the checks still accept it`
      : `  ${row.movedCheckIds.length} declared check(s) moved: ${row.movedCheckIds.join(", ")}`,
    ...(conclusive(row)
      ? []
      : [
          "  inconclusive: this probe needs an original that passes and a changed artifact that reached a verdict, so it is not executed evidence and cannot carry a blocking finding",
        ]),
  ].join("\n");
}

/**
 * Everything the host can refuse before anything executes, or the request it will run. A change is
 * a value or an edit, never both and never neither, so a `replace` beside a `value` is refused rather
 * than ignored. The ids and the value are trimmed; `find` and `replace` are not, because in code the
 * whitespace is part of the passage, and a `replace` left empty or unsent deletes it.
 */
function probeRequest(args: Record<string, JsonValue>, state: ProbeState): ProbeRequest | string {
  if (state.rows.length >= PROBE_BUDGET) return `a review runs at most ${PROBE_BUDGET} probes`;
  const text = (key: string) => (isString(args[key]) ? args[key] : "");
  const [controlId, path, value] = [text("controlId").trim(), text("path").trim(), text("value").trim()];
  const [find, replace] = [text("find"), text("replace")];
  if (controlId === "" || path === "" || (value === "") === (find + replace === "")) {
    return "controlId and path are required, with either value or find and replace, not both";
  }
  if (Math.max(value.length, find.length, replace.length) > VALUE_MAX_CHARS) {
    return `value, find and replace must each be at most ${VALUE_MAX_CHARS} characters: a probe changes one field or one passage of it, not the artifact, so change one passage of a long text with find and replace`;
  }
  return { controlId, path, change: value === "" ? { find, replace } : { value } };
}

/** What the reviewer is told `probe_check` is for, as data. This wording is the whole of the
 *  reviewer's instruction for the one tool that executes — what to probe, what a null result does
 *  and does not show, and that a finding must cite the probes behind it — so it lives here, where
 *  it can be read on its own, rather than inside the lifetime machinery that serves it. */
const PROBE_CHECK_CONTRACT = {
  name: "probe_check",
  label: "Probe a declared check",
  description:
    "Execute the candidate's own declared checks over one accept control and over a copy of it with a single field changed, and return which checks moved their verdict. Use it instead of arguing a check's behaviour from source: choose a replacement that breaks a public obligation, so a check reading that field would have to refuse it, and read what the checks actually did. No check moving is not by itself proof that nothing reads the field, since a check that reads it can accept the new value too, so state which obligation the changed artifact breaks. The path must already exist in the accept control's artifact and the value must differ from the one it carries. For a string field holding a source file or other long text, send `find` and `replace` in place of `value`: `find` must occur exactly once in that leaf, it becomes `replace`, and every other byte stays. Cite the probe numbers you relied on in `probeIds` when you record the finding; a probe whose original passed and whose changed artifact reached a verdict may be admitted blocking on its first occurrence.",
  parameters: readerParameters({
    type: "object",
    additionalProperties: false,
    required: ["controlId", "path"],
    properties: {
      controlId: {
        type: "string",
        description: "The id of an accept control in correctness-model/controls.json.",
      },
      path: {
        type: "string",
        description:
          "A rooted path to an existing leaf of that control's artifact, spelled as the declared checks spell theirs: `$.layout.members[0].area`. Array positions are bracketed; a key holding a dot or a slash is quoted: `$.firmware['main.cpp']`.",
      },
      value: {
        type: "string",
        description:
          'The replacement value as JSON text, e.g. `0.0001`, `"bolted"` or `null`. One field only. Omit it when you send `find` and `replace`.',
      },
      find: {
        type: "string",
        description:
          "Exact text inside the string field at `path`, occurring there exactly once; include enough of its surroundings to make it unique. Sent with `replace`, in place of `value`.",
      },
      replace: {
        type: "string",
        description: "The text that takes the place of `find`; empty deletes it.",
      },
    },
  }),
} satisfies Omit<ReaderTool, "execute">;

/**
 * The reviewer's probe tool, with the lifetime it opens on first use. The candidate is loaded once
 * and reused, because loading the generated check program into its confined child is the expensive
 * half of a probe and a review that probes twice should pay for it once. `close` settles the
 * verifier lifetime after the turn, whether the review probed, failed or never probed at all, and
 * `failed` says a primary failure is already propagating — the one case in which an unresolved
 * cleanup is swallowed rather than thrown, so the review keeps the identity of its real failure.
 *
 * Probes run one at a time on `queue`. A reader may issue overlapping tool calls, and both the id
 * and the budget are read off `state.rows` at the moment a probe starts: two probes started
 * together would take the same id, which names their synthetic control subjects and is what a
 * finding cites, and both would pass the last budget slot.
 */
export function probeTool(root: string, lifetimeRoot: string, state: ProbeState): ReviewProbeHandle {
  let opened: Promise<ProbeCandidate> | null = null;
  const refuse = (why: string): Promise<ReaderToolResult> => {
    state.refused += 1;
    return Promise.resolve(readerToolText(`refused: ${why}`));
  };
  const record = (row: ReviewProbeRow): ReaderToolResult => {
    state.rows.push(row);
    return readerToolText(renderRow(row));
  };
  const runProbe = async (args: Record<string, JsonValue>): Promise<ReaderToolResult> => {
    const request = probeRequest(args, state);
    if (isString(request)) return refuse(request);
    let value: JsonValue = null;
    try {
      if ("value" in request.change) value = parseJsonAs<JsonValue>(request.change.value);
    } catch {
      return refuse("value must be JSON text; quote a string value");
    }
    const id = state.rows.length + 1;
    const base = { id, controlId: request.controlId, path: request.path, change: request.change };
    const failed = (taskId: string, reason: string) =>
      record({ ...base, taskId, baseline: null, mutated: null, movedCheckIds: [], refused: reason });
    let candidate: ProbeCandidate;
    try {
      candidate = await (opened ??= openCandidate(root, lifetimeRoot));
    } catch (cause: unknown) {
      return failed(
        "",
        `the candidate's correctness model could not be loaded, so no probe can run in this review: ${errorMessage(cause)}`,
      );
    }
    const control = candidate.corpus.accept.find((row) => row.id === request.controlId);
    if (control === undefined) {
      return refuse(
        `no accept control is named ${request.controlId}; accept ids are ${
          candidate.corpus.accept
            .map((row) => row.id)
            .slice(0, 20)
            .join(", ") || "none"
        }`,
      );
    }
    const { path, change } = request;
    const leaf = "find" in change ? editedPassage(control.artifact, path, change) : value;
    const mutated = withReplacedField(control.artifact, path, leaf);
    if (mutated === null) return refuse(missingFieldRefusal(control.artifact, path, request.controlId));
    if (hashJsonValue(mutated) === hashJsonValue(control.artifact)) {
      return refuse(
        `control ${request.controlId} is unchanged at ${path}: it already carries that value, or find does not occur exactly once in text there, and a change that changes nothing cannot move a verdict`,
      );
    }
    let receipts: ControlReceipt[];
    try {
      receipts = await runPair(candidate, id, control.taskId, control.artifact, mutated);
    } catch (cause: unknown) {
      return failed(
        control.taskId,
        boundText(`the checks did not settle: ${errorMessage(cause)}`, 300).shown,
      );
    }
    const baseline = sideOf(receipts.find((row) => row.controlId === baselineId(id)));
    const changed = sideOf(receipts.find((row) => row.controlId === mutatedId(id)));
    return record({
      ...base,
      taskId: control.taskId,
      baseline,
      mutated: changed,
      movedCheckIds: movedChecks(baseline, changed),
      refused: null,
    });
  };
  let queue: Promise<unknown> = Promise.resolve();
  return {
    close: async (failed) => {
      await queue;
      if (opened === null) return;
      const candidate = await opened.catch(() => null);
      if (candidate !== null) await closeVerifierLifetime(candidate.lifetime, failed ? "failed" : "clean");
    },
    tool: {
      ...PROBE_CHECK_CONTRACT,
      execute: (_id: string, args: Record<string, JsonValue>): Promise<ReaderToolResult> => {
        const turn = queue.then(() => runProbe(args));
        queue = turn.catch(() => undefined);
        return turn;
      },
    },
  };
}
