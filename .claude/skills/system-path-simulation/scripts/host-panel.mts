/**
 * Post-actor host panel: run valid, equivalent and hostile artifacts for ONE task through the
 * deciding production path, with no model and no generated writer.
 *
 * Five stewards wrote this same panel by hand between 7 and 10 September, and two of the copies
 * carried helper faults that first read as product faults: one compiled the public schema without
 * the canonical accept list, one looked for `.toolchain` directly under the accepted snapshot
 * instead of its parent workspace. This script is the one owner. It uses the same consumers the
 * census and a measured case use — `runControls` over a task-bound corpus, `loadCorrectnessModel`
 * and `evaluateCheckProgram`, the public artifact schema, `resolveToolInventory` over
 * `bundleSnapshotToolTree`, `createVerifierHost` under a verifier lifetime — so a row's verdict is
 * the verifier's, not this script's.
 *
 *   bun .claude/skills/system-path-simulation/scripts/host-panel.mts \
 *     --candidate /abs/snapshot-or-product-dir --task <taskId> \
 *     --panel /abs/panel.json --out /abs/report-dir [--json]
 *
 * `panel.json` (schema `host-panel/v1`):
 *
 *   { "schema": "host-panel/v1",
 *     "accept": [ { "id": "valid", "artifact": <inline artifact> } ],
 *     "reject": [ { "id": "no-op-loop", "mutationClass": "hollow", "expectedCheckId": "scenario",
 *                   "artifact": { "fromControl": "accept-12",
 *                                 "patch": [ { "path": "files/firmware.c", "replace": "<old>", "with": "<new>" } ] } } ] }
 *
 * An artifact is either inline or a mutation of one of the candidate's own task-bound controls,
 * so a panel states the fact it changes rather than retyping a whole artifact. A patch whose
 * `replace` text is absent refuses before any host work: the mutation was planned against bytes
 * the candidate no longer has, and running it would measure a different fact.
 *
 * Output: `report.json` (schema `host-panel-report/v1`) with one row per panel entry, the control
 * result, the host's execution evidence and tool inventory, the source identity, and the candidate
 * fingerprint before and after. Exit 1 when any row's observed outcome disagrees with its expected
 * side; that is the panel's verdict about the candidate, not a script fault, and exit 2 is one.
 *
 * A passing panel is discrimination evidence for these rows on this task only. It does not prove
 * the whole correctness model, the battery, or a capability rate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { sha256 } from "#src/meta/digest.ts";
import { BRIEF_FILE, CONTROLS_FILE } from "#src/meta/bundle-layout.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import type { Brief } from "#src/truth/brief.ts";
import { externalChecksOf } from "#src/truth/brief.ts";
import { type ControlCorpus, isControlCorpus } from "#src/truth/controls.ts";
import { loadCorrectnessModel } from "#src/truth/contracts.ts";
import { evaluateCheckProgram } from "#src/truth/predicate.ts";
import { runControls } from "#src/truth/run-controls.ts";
import type { ControlReceipt } from "#src/truth/battery-record.ts";
import { primarySide, sideMatchesExpected } from "#src/truth/control-receipts.ts";
import { loadRecordedTasks } from "#src/run/run-driver.ts";
import { compilePublicArtifactSchema } from "#src/solve/public-artifact-schema.ts";
import { createSubmissionAuthority } from "#src/solve/final-submission.ts";
import { resolveToolInventory } from "#src/verify/tool-inventory.ts";
import { createVerifierHost } from "#src/verify/host.ts";
import { closeVerifierLifetime, createVerifierLifetime } from "#src/verify/verifier-lifetime.ts";
import { fingerprintSlug } from "#src/claim/fingerprint.ts";
import { bundleSnapshotToolTree } from "#src/claim/bundle-snapshot.ts";
import { captureSourceIdentity } from "#src/run/source-identity.ts";
import { absoluteOption, type ExitWith, exitWith, parseOrDie, requiredOption } from "#skills/main/cli.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";

const die: ExitWith = exitWith("host-panel");

const PANEL_SCHEMA = "host-panel/v1";
const REPORT_SCHEMA = "host-panel-report/v1";

interface PanelRow {
  id: string;
  side: "accept" | "reject";
  artifact: JsonValue;
  mutationClass: string | null;
  expectedCheckId: string | null;
  fromControl: string | null;
}

type Outcome = "verified-pass" | "verified-fail" | "unaccepted" | `non-result:${string}`;

interface ReportRow {
  id: string;
  side: PanelRow["side"];
  fromControl: string | null;
  expectedCheckId: string | null;
  artifactDigest: string;
  publicSchemaAccepted: boolean;
  outcome: Outcome;
  blockingCheckIds: string[];
  agrees: boolean;
  receipt: ControlReceipt | null;
}

interface ResolvedArtifact {
  artifact: JsonValue;
  fromControl: string | null;
}

const corpus: ControlCorpus = { accept: [], reject: [] };
function readJson(path: string, what: string): JsonValue {
  try {
    return readJsonFile(path);
  } catch (cause) {
    die(`could not read ${what}: ${errorMessage(cause)}`);
  }
}

/** Apply one `{ path, replace, with }` mutation to a string leaf of a cloned artifact. */
function patchArtifact(artifact: JsonValue, patch: JsonValue, rowId: string): JsonValue {
  const step = asRecord(patch);
  if (
    step === null ||
    !isString(step.path) ||
    !isString(step.replace) ||
    !isString(step.with) ||
    step.replace === ""
  ) {
    die(`row ${rowId}: each patch needs string "path", non-empty "replace" and "with"`);
  }
  const clone = structuredClone(artifact);
  const keys = step.path.split("/").filter((key) => key !== "");
  if (keys.length === 0) die(`row ${rowId}: patch path must name a field`);
  const last = keys.pop();
  let cursor: JsonValue = clone;
  for (const key of keys) {
    const record = asRecord(cursor);
    if (record === null || !(key in record)) {
      die(`row ${rowId}: patch path ${step.path} does not exist in the artifact`);
    }
    cursor = record[key] ?? null;
  }
  const holder = asRecord(cursor);
  if (holder === null || last === undefined || !isString(holder[last])) {
    die(`row ${rowId}: patch path ${step.path} is not a string leaf of the artifact`);
  }
  const text = holder[last];
  if (!text.includes(step.replace)) {
    die(
      `row ${rowId}: patch text ${JSON.stringify(step.replace)} is absent from ${step.path}; the planned mutation no longer matches the candidate bytes`,
    );
  }
  holder[last] = text.replace(step.replace, step.with);
  return clone;
}

function resolveArtifact(
  value: JsonValue,
  declared: ControlCorpus,
  taskId: string,
  rowId: string,
): ResolvedArtifact {
  const record = asRecord(value);
  if (record === null || !isString(record.fromControl)) return { artifact: value, fromControl: null };
  const control = [...declared.accept, ...declared.reject].find((row) => row.id === record.fromControl);
  if (control === undefined) {
    die(`row ${rowId}: control ${record.fromControl} is not in the candidate's controls.json`);
  }
  if (control.taskId !== taskId) {
    die(`row ${rowId}: control ${control.id} is bound to task ${control.taskId}, not ${taskId}`);
  }
  const patches = record.patch ?? [];
  if (!Array.isArray(patches)) die(`row ${rowId}: "patch" must be a list`);
  let artifact = structuredClone(control.artifact);
  for (const patch of patches) artifact = patchArtifact(artifact, patch, rowId);
  return { artifact, fromControl: control.id };
}

function parsePanel(value: JsonValue, declared: ControlCorpus, taskId: string): PanelRow[] {
  const panel = asRecord(value);
  if (panel === null || panel.schema !== PANEL_SCHEMA) die(`panel must declare "schema": "${PANEL_SCHEMA}"`);
  const rows: PanelRow[] = [];
  const seen = new Set<string>();
  for (const side of ["accept", "reject"] as const) {
    const list = panel[side] ?? [];
    if (!Array.isArray(list)) die(`panel "${side}" must be a list`);
    for (const entry of list) {
      const row = asRecord(entry);
      if (row === null || !isString(row.id) || row.id === "" || !("artifact" in row)) {
        die(`every ${side} row needs "id" and "artifact"`);
      }
      if (seen.has(row.id)) die(`row id ${row.id} appears twice`);
      seen.add(row.id);
      const mutationClass = side === "reject" ? row.mutationClass : null;
      const expectedCheckId = side === "reject" ? row.expectedCheckId : null;
      if (side === "reject" && (!isString(mutationClass) || !isString(expectedCheckId))) {
        die(`reject row ${row.id} needs string "mutationClass" and "expectedCheckId"`);
      }
      const { artifact, fromControl } = resolveArtifact(row.artifact ?? null, declared, taskId, row.id);
      rows.push({
        id: row.id,
        side,
        artifact,
        fromControl,
        mutationClass: isString(mutationClass) ? mutationClass : null,
        expectedCheckId: isString(expectedCheckId) ? expectedCheckId : null,
      });
    }
  }
  if (rows.length === 0) die("panel names no rows");
  return rows;
}

function outcomeOf(receipt: ControlReceipt | null, accepted: boolean): Outcome {
  if (!accepted) return "unaccepted";
  if (receipt === null) return "non-result:verifier";
  if (receipt.observedOutcome === "pass") return "verified-pass";
  if (receipt.observedOutcome === "fail") return "verified-fail";
  return `non-result:${receipt.nonResultKind ?? "verifier"}`;
}

const parsed = parseOrDie(die, { values: ["candidate", "task", "panel", "out"], flags: ["json"] });
const absolute = absoluteOption(die);
const required = requiredOption(die, parsed.single);
const candidate = absolute("candidate", required("candidate"));
const panelPath = absolute("panel", required("panel"));
const outDir = absolute("out", required("out"));
const taskId = parsed.single.get("task");
if (taskId === undefined || taskId === "") die("--task is required");
const asJson = parsed.flags.has("json");
if (!existsSync(join(candidate, BRIEF_FILE))) {
  die(`${candidate} has no ${BRIEF_FILE}`);
}
if (existsSync(join(outDir, "report.json"))) {
  die(`${outDir} already holds a report.json; one destination per panel`);
}

const brief = parseJsonAs<Brief>(readFileSync(join(candidate, BRIEF_FILE), "utf8"));
const tasks = loadRecordedTasks(candidate);
const task = tasks.find((row) => row.taskId === taskId);
if (task === undefined) die(`task ${taskId} is not in the candidate's tasks.json (${tasks.length} tasks)`);
const controlsValue = readJson(join(candidate, CONTROLS_FILE), "controls");
if (!isControlCorpus(controlsValue)) die("controls.json does not carry accept and reject lists");
const rows = parsePanel(readJson(panelPath, "panel"), controlsValue, taskId);

/** Public schema acceptance is the first production gate an artifact meets; an unaccepted row
 *  never reaches the verifier, exactly as an unaccepted submission never does. */
const schema = compilePublicArtifactSchema(
  brief.artifactSchema,
  controlsValue.accept.map((row) => row.artifact),
);
const acceptedById = new Map(
  rows.map((row) => {
    const authority = createSubmissionAuthority({ maxAttempts: 1, publicArtifactSchema: schema });
    return [row.id, authority.acceptArtifact(JSON.stringify(row.artifact)).accepted] as const;
  }),
);
for (const row of rows) {
  if (acceptedById.get(row.id) !== true) continue;
  if (row.side === "accept") {
    corpus.accept.push({ id: row.id, taskId, artifact: row.artifact });
    continue;
  }
  const { expectedCheckId } = row;
  if (expectedCheckId === null) die(`reject row ${row.id} names no expectedCheckId`);
  const reject: ControlCorpus["reject"][number] = {
    id: row.id,
    taskId,
    artifact: row.artifact,
    mutationClass: row.mutationClass ?? "panel",
    expectedCheckId,
  };
  corpus.reject.push(reject);
}

const source = captureSourceIdentity();
const before = fingerprintSlug(candidate);
const externalChecks = externalChecksOf(brief);
const toolTree = bundleSnapshotToolTree(candidate);
const resolved = resolveToolInventory({ toolIds: externalChecks.map((check) => check.adapterId), toolTree });
if (resolved.missing.length > 0 || resolved.invalid.length > 0) {
  die(
    `declared tools did not resolve: missing ${JSON.stringify(resolved.missing)}, invalid ${JSON.stringify(resolved.invalid)} (tool tree ${toolTree ?? "none"})`,
  );
}
mkdirSync(outDir, { recursive: true });
const lifetime = createVerifierLifetime({ root: join(outDir, "verifier-lifetime") });
const host = createVerifierHost({ inventory: resolved.inventory, toolTree, lifetime });
let failed = false;
let receipts: ControlReceipt[] = [];
let control: Awaited<ReturnType<typeof runControls>> | null = null;
try {
  const evaluate = evaluateCheckProgram(brief, await loadCorrectnessModel(candidate, lifetime));
  if (corpus.accept.length + corpus.reject.length > 0) {
    control = await runControls(
      evaluate,
      corpus,
      [task],
      { brief, externalChecks, verifierLifetime: lifetime },
      host,
    );
    receipts = control.controlReceipts;
  }
} catch (cause) {
  failed = true;
  writeFileSync(
    join(outDir, "failure.json"),
    JSON.stringify(
      {
        message: String(cause),
        stack: cause instanceof Error ? cause.stack : null,
        hostEvidence: host.evidence(),
      },
      null,
      2,
    ),
  );
  throw cause;
} finally {
  await closeVerifierLifetime(lifetime, failed ? "failed" : "clean");
}
const pendingReceipts = lifetime.pendingReceipts();
const after = fingerprintSlug(candidate);
const fingerprintUnchanged = JSON.stringify(before) === JSON.stringify(after);

const report: ReportRow[] = rows.map((row) => {
  const receipt = receipts.find((candidateReceipt) => candidateReceipt.controlId === row.id) ?? null;
  const accepted = acceptedById.get(row.id) === true;
  const outcome = outcomeOf(receipt, accepted);
  // The production attribution rule: a reject agrees only when its declared check, and no other,
  // blocked it. A reject failing for an unrelated check proves nothing about the intended mutation.
  const agrees =
    receipt !== null &&
    accepted &&
    sideMatchesExpected(primarySide(receipt), row.side === "accept" ? "pass" : "fail", row.expectedCheckId);
  return {
    id: row.id,
    side: row.side,
    fromControl: row.fromControl,
    expectedCheckId: row.expectedCheckId,
    artifactDigest: sha256(JSON.stringify(row.artifact)),
    publicSchemaAccepted: accepted,
    outcome,
    blockingCheckIds: receipt?.observedBlockingCheckIds ?? [],
    agrees,
    receipt,
  };
});
const disagreements = report.flatMap((row) => (row.agrees ? [] : [row.id]));
const document = {
  schema: REPORT_SCHEMA,
  source,
  helperSha256: sha256(readFileSync(Bun.fileURLToPath(import.meta.url))),
  candidate,
  taskId,
  panel: { path: panelPath, sha256: sha256(readFileSync(panelPath)) },
  fingerprint: { before, after, unchanged: fingerprintUnchanged },
  rows: report,
  disagreements,
  control:
    control === null
      ? null
      : {
          claimable: control.claimable,
          findings: control.findings,
          accepts: control.accepts,
          rejects: control.rejects,
          acceptsPassed: control.acceptsPassed,
          rejectsFailed: control.rejectsFailed,
          rejectsAttributed: control.rejectsAttributed,
        },
  hostEvidence: host.evidence(),
  tools: host.tools(),
  toolTree,
  pendingReceipts,
  scope:
    "Public schema acceptance and the production control runner over stated artifacts for one task; no model solver or generated writer ran. Discrimination evidence for these rows only.",
};
writeFileSync(join(outDir, "report.json"), JSON.stringify(document, null, 2));
if (asJson) console.log(JSON.stringify(document));
else {
  for (const row of report) {
    console.log(
      `${row.id} expected=${row.side} outcome=${row.outcome}${row.agrees ? "" : " DISAGREES"}${row.blockingCheckIds.length === 0 ? "" : ` blocking=${row.blockingCheckIds.join(",")}`}`,
    );
  }
}
if (!fingerprintUnchanged) {
  die(
    "candidate fingerprint changed during the panel; the report is retained but the candidate is no longer the measured bytes",
  );
}
if (pendingReceipts.length > 0) {
  die(`verifier lifetime closed with pending receipts: ${pendingReceipts.join(", ")}`);
}
runtimeProcess.exitCode = disagreements.length === 0 ? 0 : 1;
