/**
 * The epoch reviewer's one executing tool. Every other authority it has reads bytes: it opens
 * source, quotes it and reasons about it. Run truss-opus-20260916T151117729Z-064960 shows what
 * that costs. Its single harness-defect conceded inside its own claim that "no current artifact
 * can distinguish the two readings and nothing is presently mis-decided", and the host admitted
 * it as advisory; its two decisive observations were filed as `hardness` and
 * `diagnosis-uncertain`, neither of which routes to an owner. A reader that cannot execute
 * cannot demonstrate, so `demonstrated()` could only ever mean forty characters of prose.
 *
 * A probe changes one field of a known-correct accept control and runs the candidate's own
 * declared checks over the original and the changed artifact, through `runControls` — the same
 * path the control census uses, so a probe cannot decide anything the census would decide
 * differently. The answer is a fact about the evaluation rather than a reading of it: which
 * declared checks moved their verdict when that one field changed.
 *
 * It is a narrow fact and the host says so, because the wider reading is false. No check moving
 * does not mean no check reads the field: `mass <= maxMass` observes `mass` and accepts both 8
 * and 9 against a limit of 10. An `unobserved` finding still needs the reviewer to show that the
 * changed artifact breaks a public obligation and was accepted anyway; the probe supplies the
 * verdicts, not that judgement. Nor is a returned pair a settled one — a timeout or a thrown
 * check comes back as an ordinary non-result receipt with no blocking checks, which would
 * otherwise read exactly like "no check moved".
 *
 * Its authority ends there. A probe writes no candidate byte, reaches no hidden expectation the
 * checks do not already receive, and changes no pass, acceptance, claim or promotion. It runs at
 * most PROBE_BUDGET times in a review, over accept controls the candidate itself published, and
 * the changed path must already exist in the artifact: inventing a field would report "no check
 * reads it" about something the artifact never carried.
 *
 * Probe rows are review evidence like the reviewer's prose, and stay private under the same rule.
 * Only `epoch-review-public.ts` crosses to authoring, and it projects no probe.
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

/** Each probe loads the generated check program in a confined child and may launch the declared
 *  external tools, so it costs what one census control costs. Eight is enough to settle the
 *  artifact roots one review can argue about and small enough that a review cannot turn into a
 *  second census. */
export const PROBE_BUDGET = 8;
/** A replacement value is one field, not a redesigned artifact. In a file map one field is one
 *  file: esp32 run 08c0f2's accept controls carry files of up to 3,000 characters of JSON. */
const VALUE_MAX_CHARS = 4_000;
/** What one probe executed and what the candidate's own checks said about it. Private review
 *  evidence: `blockingCheckIds` is verifier detail. */
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
  /** Declared checks whose verdict the one changed field moved. Empty is the decisive negative:
   *  no declared check applicable to this task reads that field. */
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

/** Per probe, not per review. `probeTool` reuses one verifier, whose evidence log accumulates and
 *  is keyed by phase, subject id and attempt alone, and every `runControls` call starts at attempt
 *  1. Under one shared id `hostNonResult` settles this probe from an earlier probe's timeout row. */
const baselineId = (probe: number) => `review-probe-${probe}-baseline`;
const mutatedId = (probe: number) => `review-probe-${probe}-mutated`;

export function emptyProbeState(): ProbeState {
  return { rows: [], refused: 0 };
}

/** Both sides answered, so the comparison carries information. `runControls` does not throw when
 *  an evaluation fails to decide: a timeout, a thrown check, an unknown task or a pending cleanup
 *  settles as an ordinary `non-result` receipt with no blocking checks, and a pair like that is
 *  indistinguishable from "no check moved" by the ids alone. The original must also pass, because
 *  a changed artifact says nothing against a control the checks already refuse. */
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
 *  The rows rather than their numbers, because the recorder needs both: the numbers for the
 *  reviewer's own evidence prose, and the control, path and moved checks for the public projection
 *  the finding otherwise reaches with its check name alone. */
export function probeBackedRows(state: ProbeState, cited: JsonValue | undefined): ReviewProbeRow[] {
  if (!Array.isArray(cited)) return [];
  const numbers = new Set(cited.filter(isNumber));
  return state.rows.filter((row) => conclusive(row) && numbers.has(row.id)).sort((a, b) => a.id - b.id);
}

/** A review that executed probes and then records a harness-defect without saying whether it rests
 *  on them loses the one route to a first-occurrence blocking finding, and its evidence record
 *  cannot link the finding to the rows that support it. The 2026-09-16 replay of run
 *  truss-opus-20260916T151117729Z-064960 ran eight probes, narrated what they returned inside a
 *  claim and left `probeIds` unset, so both were lost. Asking costs one argument, and `probeIds: []`
 *  is the answer when the reading came from source alone. */
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

/** Load the candidate's own contract the way measurement loads it: the validated brief, the
 *  generated check program in its confined child, the published corpus and the recorded battery. */
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

/** The steps of a probe path: the declared grammar of `jsonPathTokens` plus a quoted key, read as
 *  the plain step it names. A file map's keys hold dots, so `$.firmware['fw_logic.cpp']` is the
 *  only way to name one file; esp32 run 08c0f2's reviewer tried five spellings and none resolved. */
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
 * A copy of `artifact` with one already-present field replaced, rebuilt along the path and sharing
 * everything else. Null when the path does not resolve: a probe that adds a field would answer
 * "no declared check reads it" about a field the artifact never carried, which is true and useless.
 *
 * The path is the rooted spelling the candidate's own checks declare — `$.layout.members[0].area`,
 * read through `probeSteps`. It used to be a second language, bare and dotted with array
 * positions as integer segments, so a reviewer that copied a path out of the declarations it was
 * reading was told the field did not exist. One grammar, plus the quoted key a declaration never
 * needs, and the refusal is true when it fires.
 */
export function withReplacedField(artifact: JsonValue, path: string, value: JsonValue): JsonValue | null {
  const tokens = probeSteps(path);
  if (tokens === null || tokens.length === 0) return null;
  return replacedAt(artifact, tokens, value) ?? null;
}

/** `value` with the field at `tokens` replaced, or `undefined` when a step is missing. A step that
 *  resolved proves its kind: `[i]` only into an array, `.name` only into a plain object. */
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

/** Checks that decided one artifact and not the other. Symmetric, because a mutation that makes a
 *  refusing check stop refusing is the same kind of evidence as one that makes it start. */
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
 *  because an accept is evaluated against every applicable check, which is the whole question;
 *  `runControls` will also report that the changed artifact failed an accept, and that finding is
 *  about a corpus this candidate never published, so it is read from the receipts and dropped. */
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

/** What the reviewer is told `probe_check` is for, as data. The wording is the whole of the
 *  reviewer's instruction for the one tool that executes, so it lives where it can be read
 *  without the lifetime machinery around it. */
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
 * The reviewer's probe tool, with the lifetime it opens on first use. The candidate is loaded
 * once and reused: loading the generated check program is the expensive half, and a review that
 * probes twice should pay for it once. `close` settles the verifier lifetime after the turn,
 * whether the review completed, failed or never probed at all; `failed` says a primary failure is
 * already propagating, the only case in which an unresolved cleanup does not throw.
 *
 * Probes run one at a time. A reader may issue overlapping tool calls, and each probe's id names
 * its synthetic control subjects and the rows a finding cites, while the budget counts recorded
 * rows: two probes started together would share an id and could both pass the last budget slot.
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
