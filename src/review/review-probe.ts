/**
 * `probe_check`, the epoch reviewer's one executing tool. A probe changes one existing field of an
 * accept control and runs the candidate's declared checks over the original and the changed
 * artifact through `runControls`, the path the control census uses. It reports which checks moved
 * their verdict.
 *
 * That fact is narrow. No check moving does not mean no check reads the field (`mass <= maxMass`
 * accepts both 8 and 9 against 10), and a timeout or thrown check returns a non-result receipt that
 * would otherwise look like "no check moved"; only a conclusive pair counts as evidence.
 *
 * A probe writes no candidate byte and changes no pass, acceptance, claim or promotion. Probe rows
 * are private review evidence; `epoch-review-public.ts` projects none of them.
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
import { plainRecord } from "../meta/json-evidence.ts";
import { type JsonValue, isNumber, isString } from "../meta/json-shape.ts";
import { type ReaderTool, type ReaderToolResult, readerParameters, readerToolText } from "./review-reader.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { BRIEF_FILE, CONTROLS_FILE } from "../meta/bundle-layout.ts";

/** Probes per review. Each costs about one census control, so the budget stops a review from
 *  becoming a second census. */
export const PROBE_BUDGET = 8;
/** A replacement is one field; in a file map that field can be a whole file. */
const VALUE_MAX_CHARS = 4_000;
/** One probe and what the candidate's checks decided. Private: `blockingCheckIds` is verifier
 *  detail. */
export type ReviewProbeRow = {
  /** 1-based, and what a finding cites in `probeIds`. */
  id: number;
  controlId: string;
  taskId: string;
  path: string;
  /** The JSON text of the substituted value, as the reviewer wrote it. */
  value: string;
  baseline: ProbeSide | null;
  mutated: ProbeSide | null;
  /** Declared checks whose verdict the changed field moved. */
  movedCheckIds: string[];
  /** Why nothing executed; null when the pair ran. */
  refused: string | null;
};

type ProbeSide = { outcome: ControlReceiptOutcome; blockingCheckIds: string[] };

export type ProbeState = { rows: ReviewProbeRow[]; refused: number };

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

/** Control ids unique per probe: the shared verifier's evidence log is keyed by subject id and
 *  attempt, so a reused id would read an earlier probe's rows. */
const baselineId = (probe: number) => `review-probe-${probe}-baseline`;
const mutatedId = (probe: number) => `review-probe-${probe}-mutated`;

export function emptyProbeState(): ProbeState {
  return { rows: [], refused: 0 };
}

/** The original passed and the changed artifact reached a verdict. An undecided evaluation
 *  returns a non-result receipt, which would otherwise look like "no check moved". */
function conclusive(row: ReviewProbeRow): boolean {
  return (
    row.refused === null &&
    row.baseline?.outcome === "pass" &&
    (row.mutated?.outcome === "pass" || row.mutated?.outcome === "fail")
  );
}

/** The cited probe rows that are conclusive executed evidence, in id order. */
export function probeBackedRows(state: ProbeState, cited: JsonValue | undefined): ReviewProbeRow[] {
  if (!Array.isArray(cited)) return [];
  const numbers = new Set(cited.filter(isNumber));
  return state.rows.filter((row) => conclusive(row) && numbers.has(row.id)).sort((a, b) => a.id - b.id);
}

/** After conclusive probes ran, a harness-defect must state `probeIds`, with `[]` for a
 *  source-only reading, so the record links each finding to the probes it rests on. */
export function probeCitationRefusal(
  kind: string,
  state: ProbeState,
  cited: JsonValue | undefined,
): string | null {
  if (kind !== "harness-defect" || cited !== undefined) return null;
  const ran = state.rows.filter(conclusive).map((row) => row.id);
  if (ran.length === 0) return null;
  return `this review executed probe${ran.length === 1 ? "" : "s"} ${ran.join(", ")}; a harness-defect must say what it rests on. Retry with probeIds naming the probes whose result supports it, or probeIds: [] when you read this from source alone`;
}

/** Load the candidate as measurement does: validated brief, check program in its confined child,
 *  control corpus and recorded tasks. */
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

/** The steps of a probe path: the `jsonPathTokens` grammar plus a quoted key such as
 *  `$.firmware['main.cpp']`, for keys that hold dots. */
function probeSteps(path: string): string[] | null {
  const tokens = path.match(/^\$|\.[A-Za-z_][A-Za-z0-9_-]*|\[(?:0|[1-9]\d*)\]|\[(?:'[^']+'|"[^"]+")\]/g);
  if (tokens?.[0] !== "$" || tokens.join("") !== path) return null;
  return tokens.slice(1).map((token) => (/^\[['"]/.test(token) ? `.${token.slice(2, -2)}` : token));
}

/** One step down a rooted path, taking the tokens `probeSteps` produces: `[0]` into an array,
 *  `.name` into a plain object. `undefined` means the path does not exist here. */
function stepInto(value: JsonValue | undefined, token: string): JsonValue | undefined {
  if (token.startsWith("[")) return Array.isArray(value) ? value[Number(token.slice(1, -1))] : undefined;
  return plainRecord(value)?.[token.slice(1)];
}

/**
 * A copy of `artifact` with one existing field replaced, sharing everything off the path. The path
 * uses the rooted spelling the declared checks use (`$.layout.members[0].area`). Null when it does
 * not resolve, because a probe that adds a field says nothing about the artifact.
 */
export function withReplacedField(artifact: JsonValue, path: string, value: JsonValue): JsonValue | null {
  const tokens = probeSteps(path);
  if (tokens === null || tokens.length === 0) return null;
  return replacedAt(artifact, tokens, value) ?? null;
}

/** `value` with the field at `tokens` replaced, or `undefined` when a step is missing. A resolved
 *  `[i]` step is an array and a resolved `.name` step a plain object. */
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

/** Checks that blocked exactly one of the two artifacts, in either direction. */
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

/** Run the pair through the census path. Both are declared accepts so every applicable check
 *  runs; only the receipts are read, not the corpus findings. */
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

function renderRow(row: ReviewProbeRow): string {
  if (row.refused !== null) return `probe ${row.id} did not run: ${row.refused}`;
  const side = (label: string, value: ProbeSide | null) =>
    `  ${label}: ${value === null ? "no receipt" : `${value.outcome}${value.blockingCheckIds.length === 0 ? "" : `, blocked by ${value.blockingCheckIds.join(", ")}`}`}`;
  return [
    `probe ${row.id}: accept control ${row.controlId} (task ${row.taskId}), ${row.path} replaced with ${row.value}`,
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

function probeArgs(args: Record<string, JsonValue>) {
  const read = (key: string) => (isString(args[key]) ? args[key].trim() : "");
  return { controlId: read("controlId"), path: read("path"), value: read("value") };
}

/** Everything the host can refuse before anything executes. */
function argumentRefusal(parsed: ReturnType<typeof probeArgs>, state: ProbeState): string | null {
  if (state.rows.length >= PROBE_BUDGET) return `a review runs at most ${PROBE_BUDGET} probes`;
  if (parsed.controlId === "" || parsed.path === "" || parsed.value === "") {
    return "controlId, path and value are all required";
  }
  if (parsed.value.length > VALUE_MAX_CHARS) {
    return `value must be at most ${VALUE_MAX_CHARS} characters: a probe changes one field, not the artifact`;
  }
  return null;
}

/** The name, description and schema the reviewer sees for `probe_check`. */
const PROBE_CHECK_CONTRACT = {
  name: "probe_check",
  label: "Probe a declared check",
  description:
    "Execute the candidate's own declared checks over one accept control and over a copy of it with a single field changed, and return which checks moved their verdict. Use it instead of arguing a check's behaviour from source: choose a replacement that breaks a public obligation, so a check reading that field would have to refuse it, and read what the checks actually did. No check moving is not by itself proof that nothing reads the field, since a check that reads it can accept the new value too, so state which obligation the changed artifact breaks. The path must already exist in the accept control's artifact and the value must differ from the one it carries. Cite the probe numbers you relied on in `probeIds` when you record the finding; a probe whose original passed and whose changed artifact reached a verdict may be admitted blocking on its first occurrence.",
  parameters: readerParameters({
    type: "object",
    additionalProperties: false,
    required: ["controlId", "path", "value"],
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
          'The replacement value as JSON text, e.g. `0.0001`, `"bolted"` or `null`. One field only.',
      },
    },
  }),
} satisfies Omit<ReaderTool, "execute">;

/**
 * The reviewer's probe tool. The candidate is loaded on first use and reused. `close` settles the
 * verifier lifetime after the turn; `failed` says a primary failure is already propagating.
 *
 * Probes run one at a time, because a probe's id and the budget both come from the recorded rows.
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
    const parsed = probeArgs(args);
    const why = argumentRefusal(parsed, state);
    if (why !== null) return refuse(why);
    let value: JsonValue;
    try {
      value = parseJsonAs<JsonValue>(parsed.value);
    } catch {
      return refuse("value must be JSON text; quote a string value");
    }
    const id = state.rows.length + 1;
    const base: Omit<ReviewProbeRow, "taskId" | "baseline" | "mutated" | "movedCheckIds" | "refused"> = {
      id,
      controlId: parsed.controlId,
      path: parsed.path,
      value: parsed.value,
    };
    const failed = (taskId: string, reason: string) =>
      record({ ...base, taskId, baseline: null, mutated: null, movedCheckIds: [], refused: reason });
    let candidate: ProbeCandidate;
    try {
      candidate = await (opened ??= openCandidate(root, lifetimeRoot));
    } catch (cause: unknown) {
      return failed(
        "",
        `the candidate's correctness model could not be loaded: ${errorMessage(cause)}`.slice(0, 300),
      );
    }
    const control = candidate.corpus.accept.find((row) => row.id === parsed.controlId);
    if (control === undefined) {
      return refuse(
        `no accept control is named ${parsed.controlId}; accept ids are ${
          candidate.corpus.accept
            .map((row) => row.id)
            .slice(0, 20)
            .join(", ") || "none"
        }`,
      );
    }
    const mutated = withReplacedField(control.artifact, parsed.path, value);
    if (mutated === null) {
      return refuse(
        `${parsed.path} is not an existing field of control ${parsed.controlId}; probe a path the artifact already carries`,
      );
    }
    if (hashJsonValue(mutated) === hashJsonValue(/* SAFETY: as above. */ control.artifact)) {
      return refuse(
        `control ${parsed.controlId} already carries that value at ${parsed.path}; a replacement that changes nothing cannot move a verdict`,
      );
    }
    let receipts: ControlReceipt[];
    try {
      receipts = await runPair(
        candidate,
        id,
        control.taskId,
        /* SAFETY: as above. */ control.artifact,
        mutated,
      );
    } catch (cause: unknown) {
      return failed(control.taskId, `the checks did not settle: ${errorMessage(cause)}`.slice(0, 300));
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
