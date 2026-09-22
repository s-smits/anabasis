/**
 * Compare model conditions over recorded battery bytes, one battery per condition.
 *
 * Comparing terminal pass counts can conflate a model that solved fewer tasks with a battery
 * that measured different tasks. This reads the controller's recorded battery for each condition,
 * joins the conditions on task id only when their task-set and correctness-model identities agree, and
 * prints the three denominators, the per-family split, the paired buckets and the shared blind
 * spots. Verifier detail never enters the output: task ids, families, counts and hashes only.
 *
 *   bun .claude/skills/model-condition-comparison/scripts/compare-conditions.mts \
 *     --condition opus=/abs/run-root/campaigns/<slug>::<runId> \
 *     --condition fable=/abs/other-root/campaigns/<slug>/candidates/<iter>/runs/<runId>/battery.json \
 *     [--json]
 *
 * A condition names a `battery.json` directly, or `campaignDir::runId`, which is looked up under the
 * battery roots (`candidates/<iter>/runs` and `../../domains/<slug>/runs`, plus `contest`, which
 * only campaigns measured before 2026-09-04 wrote). The first condition is the reference the paired
 * buckets are read against.
 *
 * The pairing here is the operator's comparison between conditions they launched. The controller
 * ran a candidate-versus-current contest until 2026-09-04; it no longer does, and a candidate is
 * adopted on its own admitted battery, so nothing this script prints decides a promotion.
 */

import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { isAbsolute, join, resolve } from "#src/meta/path.ts";
import { type CaseOutcome, classifyCaseOutcome } from "#src/claim/case-record.ts";
import { BATTERY_FILE, batteryPath } from "#src/truth/battery-record.ts";
import { wilsonInterval } from "#src/claim/estimation.ts";
import { type ExitWith, exitWith, parseOrDie } from "../../system-path-simulation/scripts/cli-args.mts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { asRecord, isBoolean, isNumber, isString } from "#src/meta/json-shape.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

const die: ExitWith = exitWith("compare-conditions");

/** The sign-test threshold this reading uses. Advisory only: no controller gate consumes it. */
const SIGN_TEST_Z = 1.96;
/** How many task ids a bucket prints before it truncates; the JSON form carries them all. */
const LISTED_TASKS = 12;

interface ConditionCase {
  taskId: string;
  family: string;
  outcome: CaseOutcome;
  nonResultKind: string | null;
  turns: number | null;
  toolCalls: number | null;
  solverErrors: number | null;
}

interface Condition {
  label: string;
  path: string;
  runId: string;
  slug: string;
  backendPin: string;
  variant: string | null;
  terminal: string | null;
  agentHash: string | null;
  graderHash: string | null;
  taskSetHash: string | null;
  thresholdDigest: string | null;
  cases: ConditionCase[];
}

interface Census {
  cases: number;
  verified: number;
  passed: number;
  unaccepted: number;
  nonResult: number;
  rate: number | null;
  wilson: { lower: number; upper: number } | null;
  turnsMean: number | null;
  toolCallsMean: number | null;
  solverErrors: number;
  nonResultKinds: Record<string, number>;
}

interface PairedBuckets {
  reference: string;
  other: string;
  otherPasses: string[];
  referencePasses: string[];
  bothPass: string[];
  bothFail: string[];
  unresolved: string[];
  signZ: number | null;
}

type Comparability = "paired-same-harness" | "paired-same-battery" | "not-comparable";
/** What a join of two recorded conditions supports, and why it does not support more. */
interface Comparison {
  verdict: Comparability;
  reasons: string[];
}

function str(value: unknown): string | null {
  return isString(value) ? value : null;
}

function num(value: unknown): number | null {
  return isNumber(value) && Number.isFinite(value) ? value : null;
}

function readJson(path: string): JsonObject {
  let value: unknown;
  try {
    value = readJsonFile(path);
  } catch (cause) {
    die(`${path}: ${errorMessage(cause)}`);
  }
  const record = asRecord(value);
  if (record === null) die(`${path}: not a JSON object`);
  return record;
}

/** The three roots a recorded battery may live under, in the order a reviewer usually finds them. */
function locateBattery(campaignDir: string, runId: string): string {
  const slug = campaignDir.split("/").findLast((part) => part.length > 0) ?? "";
  const candidatesDir = join(campaignDir, "candidates");
  const candidateRuns = existsSync(candidatesDir)
    ? readdirSync(candidatesDir).map((iteration) => batteryPath(join(candidatesDir, iteration), runId))
    : [];
  const found = [
    ...candidateRuns,
    // Only campaigns measured before 2026-09-04 wrote a contest battery; kept so those stay readable.
    join(campaignDir, "contest", runId, BATTERY_FILE),
    batteryPath(join(campaignDir, "..", "..", "domains", slug), runId),
  ].filter((path) => existsSync(path));
  if (found.length === 0) {
    die(`${campaignDir}::${runId}: no battery.json under candidates, contest or domains`);
  }
  if (found.length > 1) {
    die(
      `${campaignDir}::${runId}: ${found.length} battery.json files; name one directly: ${found.join(", ")}`,
    );
  }
  return resolve(found[0] ?? "");
}

function conditionCase(value: unknown, path: string, index: number): ConditionCase {
  const row = asRecord(value);
  const taskId = str(row?.taskId);
  const family = str(row?.family);
  if (row === null || taskId === null || family === null) {
    die(`${path}: case ${index} has no taskId or family`);
  }
  const acceptedSubmit = row.acceptedSubmit === true;
  const pass = isBoolean(row.pass) ? row.pass : null;
  const runtimeNonResult = str(row.runtimeNonResult);
  const solver = asRecord(row.solver);
  const errors = Array.isArray(solver?.errors) ? solver.errors.length : null;
  return {
    taskId,
    family,
    outcome: classifyCaseOutcome({ acceptedSubmit, pass, runtimeNonResult }),
    nonResultKind: str(row.runtimeNonResultKind),
    turns: num(solver?.turns),
    toolCalls: num(solver?.toolCalls),
    solverErrors: errors,
  };
}

function readCondition(label: string, spec: string): Condition {
  const separator = spec.indexOf("::");
  const path =
    separator === -1
      ? resolve(spec)
      : locateBattery(resolve(spec.slice(0, separator)), spec.slice(separator + 2));
  if (!existsSync(path)) die(`${label}: ${path} does not exist`);
  const battery = readJson(path);
  const runId = str(battery.runId);
  const slug = str(battery.slug);
  const backendPin = str(battery.backendPin);
  if (runId === null || slug === null || backendPin === null) {
    die(`${path}: runId, slug or backendPin missing`);
  }
  if (!Array.isArray(battery.cases)) die(`${path}: cases missing`);
  const snapshot = asRecord(battery.bundleSnapshot);
  return {
    label,
    path,
    runId,
    slug,
    backendPin,
    variant: str(asRecord(battery.condition)?.variant),
    terminal: str(battery.terminalReason),
    agentHash: str(snapshot?.agentHash),
    graderHash: str(snapshot?.graderHash),
    taskSetHash: str(snapshot?.taskSetHash),
    thresholdDigest: str(battery.thresholdManifestDigest),
    cases: battery.cases.map((value, index) => conditionCase(value, path, index)),
  };
}

function mean(values: ReadonlyArray<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length;
}

function census(cases: readonly ConditionCase[]): Census {
  const by = (outcome: CaseOutcome) => cases.filter((row) => row.outcome === outcome).length;
  const passed = by("pass");
  const verified = passed + by("fail");
  const nonResultKinds: Record<string, number> = {};
  for (const row of cases) {
    if (row.outcome !== "non-result") continue;
    const kind = row.nonResultKind ?? "untyped";
    nonResultKinds[kind] = (nonResultKinds[kind] ?? 0) + 1;
  }
  return {
    cases: cases.length,
    verified,
    passed,
    unaccepted: by("unaccepted"),
    nonResult: by("non-result"),
    rate: verified === 0 ? null : passed / verified,
    wilson: wilsonInterval(passed, verified),
    turnsMean: mean(cases.map((row) => row.turns)),
    toolCallsMean: mean(cases.map((row) => row.toolCalls)),
    solverErrors: cases.reduce((sum, row) => sum + (row.solverErrors ?? 0), 0),
    nonResultKinds,
  };
}

/** This paired summary treats fail and unaccepted as unsuccessful attempts. The capability
 * rate above still uses verified cases only. Non-results leave the pair unresolved. */
function scored(outcome: CaseOutcome): boolean | null {
  if (outcome === "non-result") return null;
  return outcome === "pass";
}

function paired(reference: Condition, other: Condition): PairedBuckets {
  const buckets: PairedBuckets = {
    reference: reference.label,
    other: other.label,
    otherPasses: [],
    referencePasses: [],
    bothPass: [],
    bothFail: [],
    unresolved: [],
    signZ: null,
  };
  const otherByTask = new Map(other.cases.map((row) => [row.taskId, row]));
  const seen = new Set<string>();
  for (const row of reference.cases) {
    seen.add(row.taskId);
    const partner = otherByTask.get(row.taskId);
    const a = scored(row.outcome);
    const b = partner === undefined ? null : scored(partner.outcome);
    if (a === null || b === null) buckets.unresolved.push(row.taskId);
    else if (a && b) buckets.bothPass.push(row.taskId);
    else if (!a && !b) buckets.bothFail.push(row.taskId);
    else if (b) buckets.otherPasses.push(row.taskId);
    else buckets.referencePasses.push(row.taskId);
  }
  for (const row of other.cases) if (!seen.has(row.taskId)) buckets.unresolved.push(row.taskId);
  const wins = buckets.otherPasses.length;
  const losses = buckets.referencePasses.length;
  buckets.signZ = wins + losses === 0 ? null : (wins - losses) / Math.sqrt(wins + losses);
  return buckets;
}

/** Task-level joins require matching recorded task, correctness-model and threshold hashes.
 * Matching agent bytes permit pairing; source, isolation and resource identity need separate review. */
function comparability(conditions: readonly Condition[]): Comparison {
  const reasons: string[] = [];
  const first = conditions[0];
  if (first === undefined) return { verdict: "not-comparable", reasons: ["no conditions"] };
  const same = (key: "taskSetHash" | "graderHash" | "agentHash" | "thresholdDigest") =>
    conditions.every((condition) => condition[key] !== null && condition[key] === first[key]);
  if (!same("taskSetHash")) {
    reasons.push("task-set hashes differ or are unrecorded: the conditions measured different batteries");
  }
  if (!same("graderHash")) {
    reasons.push(
      "grader hashes differ or are unrecorded: the conditions were verified by different correctness models",
    );
  }
  if (!same("thresholdDigest")) {
    reasons.push("threshold manifest digests differ: the conditions ran under different declared policy");
  }
  if (reasons.length > 0) return { verdict: "not-comparable", reasons };
  if (!same("agentHash")) {
    reasons.push(
      "agent bundle hashes differ: the pin and the harness both moved, so a task-level difference has two candidate causes",
    );
    return { verdict: "paired-same-battery", reasons };
  }
  if (new Set(conditions.map((condition) => condition.backendPin)).size < conditions.length) {
    reasons.push(
      "two conditions share one backend pin: they are a run-to-run repeat, not a model comparison",
    );
  }
  return { verdict: "paired-same-harness", reasons };
}

function families(conditions: readonly Condition[]): Map<string, Census[]> {
  const names = [
    ...new Set(conditions.flatMap((condition) => condition.cases.map((row) => row.family))),
  ].sort();
  return new Map(
    names.map((name) => [
      name,
      conditions.map((condition) => census(condition.cases.filter((row) => row.family === name))),
    ]),
  );
}

function pct(value: number | null): string {
  return value === null ? "null" : `${(value * 100).toFixed(1)}%`;
}

function fixed(value: number | null): string {
  return value === null ? "null" : value.toFixed(1);
}

function short(hash: string | null): string {
  return hash === null ? "unrecorded" : hash.slice(0, 9);
}

function listed(ids: readonly string[]): string {
  if (ids.length === 0) return "none";
  const head = ids.slice(0, LISTED_TASKS).join(", ");
  return ids.length > LISTED_TASKS ? `${head} … (${ids.length} total)` : head;
}

function identityLines(conditions: readonly Condition[]): string[] {
  const lines = [
    "| condition | run | backend pin | variant | terminal | agent | grader | task set | thresholds | cases |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const condition of conditions) {
    lines.push(
      `| ${condition.label} | ${condition.runId} | ${condition.backendPin} | ${condition.variant ?? "null"} | ${condition.terminal ?? "null"} | ${short(condition.agentHash)} | ${short(condition.graderHash)} | ${short(condition.taskSetHash)} | ${short(condition.thresholdDigest)} | ${condition.cases.length} |`,
    );
  }
  return lines;
}

function censusLines(conditions: readonly Condition[], counts: readonly Census[]): string[] {
  const lines = [
    "| condition | verified | passed | rate | Wilson | unaccepted | non-result | turns mean | tool calls mean | solver errors |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  conditions.forEach((condition, index) => {
    const c = counts[index];
    if (c === undefined) return;
    const wilson = c.wilson === null ? "null" : `[${pct(c.wilson.lower)}, ${pct(c.wilson.upper)}]`;
    lines.push(
      `| ${condition.label} | ${c.verified} | ${c.passed} | ${pct(c.rate)} | ${wilson} | ${c.unaccepted} | ${c.nonResult} | ${fixed(c.turnsMean)} | ${fixed(c.toolCallsMean)} | ${c.solverErrors} |`,
    );
  });
  for (const [index, c] of counts.entries()) {
    const kinds = Object.entries(c.nonResultKinds).map(([kind, count]) => `${kind} ×${count}`);
    if (kinds.length > 0) {
      lines.push(`- ${conditions[index]?.label ?? index}: non-result kinds ${kinds.join(", ")}`);
    }
  }
  lines.push(
    "",
    "Capability rate = passed / verified. With at least one verified case, difficulty uses verified + unaccepted; otherwise there is no difficulty evidence. Non-results leave both.",
  );
  return lines;
}

function familyLines(conditions: readonly Condition[], byFamily: Map<string, Census[]>): string[] {
  const lines = [
    `| family | ${conditions.map((condition) => `${condition.label} passed/verified (unaccepted, non-result)`).join(" | ")} |`,
  ];
  lines.push(`| --- | ${conditions.map(() => "---").join(" | ")} |`);
  for (const [family, counts] of byFamily) {
    const cells = counts.map((c) => `${c.passed}/${c.verified} (${c.unaccepted}, ${c.nonResult})`);
    lines.push(`| ${family} | ${cells.join(" | ")} |`);
  }
  return lines;
}

function pairLines(pair: PairedBuckets): string[] {
  const wins = pair.otherPasses.length;
  const losses = pair.referencePasses.length;
  const z = pair.signZ === null ? "null (no decided pair)" : pair.signZ.toFixed(2);
  const clears = pair.signZ !== null && Math.abs(pair.signZ) > SIGN_TEST_Z ? "clears" : "does not clear";
  return [
    `### ${pair.other} against ${pair.reference}`,
    "",
    `- only ${pair.other} passes (${wins}): ${listed(pair.otherPasses)}`,
    `- only ${pair.reference} passes (${losses}): ${listed(pair.referencePasses)}`,
    `- both pass (${pair.bothPass.length}), both fail (${pair.bothFail.length}): ${listed(pair.bothFail)}`,
    `- unresolved, a non-result or an absent task on either side (${pair.unresolved.length}): ${listed(pair.unresolved)}`,
    `- sign test z = ${z}; ${clears} ${SIGN_TEST_Z} (advice only: the controller runs no contest and adopts a candidate on its own admitted battery)`,
  ];
}

function readingLines(verdict: Comparability, pairs: readonly PairedBuckets[]): string[] {
  if (verdict === "not-comparable") {
    return [
      "Task-level buckets are withheld: read the census and the family split as two separate measurements, and compare mechanisms (terminal, non-result kinds, turns, tool calls), never pass counts.",
    ];
  }
  const lines = [
    "Reading the buckets:",
    "- both fail: a shared blind spot; inspect the harness contract or the verifier before either model, and never patch for one task.",
    "- only one condition passes: read that task's trace for the failing condition and assign one owner (tools-spec, instructions, fingerprint or environment); a change is admitted only when its paired effect is non-negative under every condition.",
    "- unresolved: environment work, not capability; recover the provider or wall before re-measuring.",
  ];
  if (verdict === "paired-same-battery") {
    lines.push(
      "- the agent bundle also moved: attribute a difference to the pin only after a same-harness cross condition confirms it.",
    );
  }
  if (pairs.every((pair) => pair.otherPasses.length === 0 && pair.referencePasses.length === 0)) {
    lines.push(
      "- no decided pair differs: the battery found no difference between the conditions, which is not evidence that none exists.",
    );
  }
  return lines;
}

function report(conditions: readonly Condition[]): string {
  const counts = conditions.map((condition) => census(condition.cases));
  const compare = comparability(conditions);
  const byFamily = families(conditions);
  const reference = conditions[0];
  const pairs =
    compare.verdict === "not-comparable" || reference === undefined
      ? []
      : conditions.slice(1).map((other) => paired(reference, other));
  const lines = [
    "# Model condition comparison",
    "",
    "## Identity",
    "",
    ...identityLines(conditions),
    "",
    `Comparability: ${compare.verdict}`,
    ...compare.reasons.map((reason) => `- ${reason}`),
    "",
    "## Census",
    "",
    ...censusLines(conditions, counts),
    "",
    "## Families",
    "",
    ...familyLines(conditions, byFamily),
    "",
    "## Paired buckets",
    "",
    ...pairs.flatMap((pair) => [...pairLines(pair), ""]),
    ...readingLines(compare.verdict, pairs),
  ];
  return `${lines.join("\n")}\n`;
}

function jsonReport(conditions: readonly Condition[]): string {
  const compare = comparability(conditions);
  const reference = conditions[0];
  return JSON.stringify(
    {
      schema: "model-condition-comparison/v1",
      conditions: conditions.map((condition) => ({
        ...condition,
        cases: undefined,
        caseCount: condition.cases.length,
        census: census(condition.cases),
      })),
      comparability: compare,
      families: Object.fromEntries(families(conditions)),
      pairs:
        compare.verdict === "not-comparable" || reference === undefined
          ? []
          : conditions.slice(1).map((other) => paired(reference, other)),
    },
    null,
    2,
  );
}

function main(): void {
  const parsed = parseOrDie(die, { repeatable: ["condition"], flags: ["json"] });
  const specs = parsed.repeated.get("condition") ?? [];
  if (specs.length < 2) {
    die("name at least two --condition label=<battery.json | campaignDir::runId> options");
  }
  const labels = new Set<string>();
  const conditions = specs.map((spec) => {
    const equalsAt = spec.indexOf("=");
    const label = equalsAt === -1 ? "" : spec.slice(0, equalsAt);
    const target = spec.slice(equalsAt + 1);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(label)) {
      die(`--condition ${spec}: the label before = must be a lowercase slug`);
    }
    if (labels.has(label)) die(`--condition ${spec}: label ${label} is used twice`);
    labels.add(label);
    if (!isAbsolute(target)) die(`--condition ${spec}: the path must be absolute`);
    return readCondition(label, target);
  });
  console.log(parsed.flags.has("json") ? jsonReport(conditions) : report(conditions).trimEnd());
}

main();
