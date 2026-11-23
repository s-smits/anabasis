/**
 * Component-level WRI readers and triggers for lanes 20 to 23:
 * - Lane 20 (`draft-audit.txt`): Adversarial Draft Auditor (`referee.draft`, `referee.draft.refused`),
 *   pass counts, finding kinds, cost/turn overhead, and unverified final-pass cap leaks.
 * - Lane 21 (`grounding.txt`): Verifier grounding, declared tools, staged `.toolchain/host-tools.json`
 *   provenance (`origin`), `faulty` verdicts, and `check`/`verifier` non-results.
 * - Lane 22 (`wall-audit.txt`): Runtime cross-seat information wall signals and `solve.finished.network`
 *   cross-arm parity (`COMPARISON_REACH`).
 * - Lane 23 (`seats.txt`): Unified per-role ledger across all agentic seats + Verifier + Host,
 *   seat cap anomalies, auxiliary spend share, and post-pause comparison overshoots.
 *
 * Wall-safe: prints only event kinds, counts, enums, session ids, 8-char digests, dollars, and
 * ratios — never task text, answers, hidden values, check failure reasons, prompts, or Referee prose.
 */
import { starterIn } from "#src/campaign/climb.ts";
import { PAUSE, pauseKindsOf, pausePointReached } from "#src/campaign/word.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { unadmitted } from "#src/kernel/acceptance.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { spendOf } from "#src/kernel/meter.ts";
import { tracesIn } from "#src/kernel/trace.ts";
import { HOST_TOOLS_FILE } from "#src/kernel/verify.ts";
import { TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { countBy } from "#src/meta/tally.ts";
import { hasWholeToken, plural } from "#src/meta/text.ts";
import { EXAM_END, firedIf, type Index, items, percent, share, tally, text, type Trigger } from "./folds.ts";

interface DraftAuditPass {
  readonly index: number;
  readonly session: string;
  readonly pass: number;
  readonly verdict: string;
  readonly findings: readonly string[];
  readonly probes: number;
  readonly turns: number;
  readonly billed: number;
}

interface WallScan {
  readonly buildCheckIds: number;
  readonly buildHeldTasks: number;
  readonly buildInternalKinds: number;
  readonly examHarnessDigests: number;
  readonly examInternalKinds: number;
  readonly networkCounts: Readonly<Record<string, number>>;
  readonly networkMismatches: readonly string[];
  readonly mixedNetworkPresence: boolean;
}

interface RoleRow {
  readonly role: string;
  readonly runs: number;
  readonly turns: number;
  readonly calls: number;
  readonly errors: number;
  readonly anomalies: number;
  readonly billed: number;
}

const EXAM_HASH_PREFIX = 16;
const CHECK_ID_RE = /^check-[a-z0-9-]+$/u;
const INTERNAL_KIND_RE = /\b(?:referee\.finding|referee\.draft(?:\.refused)?|campaign\.word)\b/u;
const NON_SOLVER_SKEW = 0.4;
const MIN_SKEW_DOLLARS = 10;
const MIN_TASK_ID_LEN = 4;
const FULL_DIGEST_LEN = 64;
const SHORT_DIGEST_LEN = 8;
const CLEAN_DRAFT_ENDS = new Set(["stands", "finished"]);
const CLEAN_EXAM_ENDS = new Set(["supplied", "finished"]);
const VERIFIER_NON_RESULTS = new Set(["check", "verifier"]);

const passesText = (count: number) => (count === 1 ? "1 pass" : `${String(count)} passes`);

function draftAuditPasses(events: readonly LogEvent[]): DraftAuditPass[] {
  return events.flatMap(({ kind, data }, index) => {
    if (kind !== "referee.draft") return [];
    const findings = items(data.findings).flatMap((entry) => {
      const findingKind = text(asRecord(entry)?.kind);
      return findingKind === "" ? [] : [findingKind];
    });
    return [
      {
        index,
        session: text(data.session) || "d-?",
        pass: isNumber(data.pass) ? data.pass : 1,
        verdict: text(data.verdict) || "unknown",
        findings,
        probes: items(data.probeRows).length,
        turns: isNumber(data.turns) ? data.turns : 0,
        billed: isNumber(data.billed) ? data.billed : 0,
      },
    ];
  });
}

function unverifiedFinalPasses(
  events: readonly LogEvent[],
  passes: readonly DraftAuditPass[],
): DraftAuditPass[] {
  const draftedBy = new Map<string, number>();
  for (const [index, { kind, data }] of events.entries()) {
    if (kind === "exam.drafted") draftedBy.set(text(data.session) || "d-?", index);
  }
  const bySession = Map.groupBy(passes, ({ session }) => session);
  return [...bySession].flatMap(([session, rows]) => {
    const freezeAt = draftedBy.get(session);
    const before = freezeAt === undefined ? rows : rows.filter((row) => row.index < freezeAt);
    const last = before.at(-1);
    return last?.verdict === "defects" ? [last] : [];
  });
}

/** Lane 20 derived reader (`draft-audit.txt`). */
export function draftAuditRows(events: readonly LogEvent[]): string[] {
  const passes = draftAuditPasses(events);
  const refused = events.filter(({ kind }) => kind === "referee.draft.refused");
  if (passes.length === 0 && refused.length === 0) return ["draft-audit: none recorded"];
  const sessions = new Set(passes.map(({ session }) => session)).size;
  const billed = passes.reduce((sum, row) => sum + row.billed, 0);
  const turns = passes.reduce((sum, row) => sum + row.turns, 0);
  const probes = passes.reduce((sum, row) => sum + row.probes, 0);
  const verdicts = tally(countBy(passes, ({ verdict }) => verdict));
  const findingKinds = tally(
    countBy(
      passes.flatMap(({ findings }) => findings),
      (kind) => kind,
    ),
  );
  const unverified = unverifiedFinalPasses(events, passes);
  const detail = passes.map(
    (row) =>
      `  ${row.session} pass ${String(row.pass)}: ${row.verdict}, ${plural(row.findings.length, "finding")} (${tally(countBy(row.findings, (kind) => kind))}), ${plural(row.probes, "probe")}, ${plural(row.turns, "turn")}, $${row.billed.toFixed(2)}`,
  );
  const refusedLine =
    refused.length === 0
      ? []
      : [`  refused: ${tally(countBy(refused, ({ data }) => text(data.ruling) || "unknown"))}`];
  return [
    `draft-audit: ${passesText(passes.length)} across ${plural(sessions, "session")}, $${billed.toFixed(2)} billed (${plural(turns, "turn")}, ${plural(probes, "probe")}); verdicts: ${verdicts}; findings: ${findingKinds}; refused: ${String(refused.length)}; final-pass unverified defects: ${unverified.length > 0 ? `yes (${String(unverified.length)})` : "no"}`,
    ...detail,
    ...refusedLine,
  ];
}

function stagedToolchainSummary(
  events: readonly LogEvent[],
  examsDir: string | undefined,
): { readonly origin: string; readonly hostTools: number; readonly stagedBins: number } | null {
  if (examsDir === undefined || !existsSync(examsDir)) return null;
  const draft = draftOf(events);
  if (draft === null) return null;
  const toolchain = join(examsDir, hashJsonValue(draft).slice(0, EXAM_HASH_PREFIX), "bundle", TOOL_TREE_DIR);
  if (!existsSync(toolchain)) return null;
  const binDir = join(toolchain, "bin");
  const stagedBins = existsSync(binDir) ? readdirSync(binDir).length : 0;
  const hostPath = join(toolchain, HOST_TOOLS_FILE);
  if (!existsSync(hostPath)) return { origin: "absent", hostTools: 0, stagedBins };
  try {
    const parsed = asRecord(capturedJsonParse(readFileSync(hostPath, "utf8")));
    const origin = text(parsed?.origin) || "unknown";
    const hostTools = items(parsed?.tools).filter(isString).length;
    return { origin, hostTools, stagedBins };
  } catch {
    return { origin: "unreadable", hostTools: 0, stagedBins };
  }
}

function groundingStats(events: readonly LogEvent[]) {
  const draft = draftOf(events);
  const checks = draft?.checks ?? [];
  const checksWithTools = checks.filter(({ tools }) => (tools?.length ?? 0) > 0).length;
  const objectiveTools = draft?.objectiveTools?.length ?? 0;
  const reading = events.findLast(({ kind }) => kind === "checker.read");
  const rows = items(reading?.data.rows).length;
  const authored = unadmitted(events, []).length;
  const frozen = events.findLast(({ kind }) => kind === "contract.frozen")?.data;
  const admitted = items(frozen?.admitted).filter(isString).length;
  const faultyVerdicts = events.filter(
    ({ kind, data }) => kind === "verdict" && data.kind === "faulty",
  ).length;
  const nonResults = events.flatMap(({ kind, data }) => {
    if (kind !== "solve.finished") return [];
    const ending = asRecord(data.ending);
    const kindText = text(ending?.kind);
    return ending?.outcome === "non-result" && VERIFIER_NON_RESULTS.has(kindText) ? [kindText] : [];
  });
  return {
    hasDraft: draft !== null,
    totalChecks: checks.length,
    checksWithTools,
    objectiveTools,
    readRows: rows,
    authored,
    admitted,
    faultyVerdicts,
    nonResults,
  };
}

/** Lane 21 derived reader (`grounding.txt`). */
export function groundingRows(events: readonly LogEvent[], examsDir?: string): string[] {
  const stats = groundingStats(events);
  const staged = stagedToolchainSummary(events, examsDir);
  const stagedText =
    staged === null
      ? "staged toolchain: none or unavailable"
      : `staged toolchain: host-tools origin=${staged.origin}, host-tools=${String(staged.hostTools)}, staged-bins=${String(staged.stagedBins)}`;
  return [
    `grounding: ${plural(stats.totalChecks, "drafted check")} (${String(stats.checksWithTools)} with tools), ${plural(stats.objectiveTools, "objective tool")}; checker.read ${String(stats.readRows)} rows, ${String(stats.authored)} author-decided, ${String(stats.admitted)} admitted`,
    `  ${stagedText}`,
    `  verifier faults: ${plural(stats.faultyVerdicts, "faulty verdict")}, ${plural(stats.nonResults.length, "verifier non-result")} (${tally(countBy(stats.nonResults, (kind) => kind))})`,
  ];
}

function wallScanOf(events: readonly LogEvent[]): WallScan {
  const checkIds = new Set<string>();
  for (const check of draftOf(events)?.checks ?? []) {
    if (CHECK_ID_RE.test(check.id)) checkIds.add(check.id);
  }
  const reading = events.findLast(({ kind }) => kind === "checker.read");
  for (const row of items(reading?.data.rows)) {
    const id = text(asRecord(row)?.id);
    if (CHECK_ID_RE.test(id)) checkIds.add(id);
  }
  const releasedAt = new Map<string, number>();
  for (const [index, { kind, data }] of events.entries()) {
    if (kind !== "task.state" || data.state !== "released") continue;
    const version = text(data.version);
    if (version !== "" && !releasedAt.has(version)) releasedAt.set(version, index);
  }
  const heldTasks: { readonly taskId: string; readonly releasedAt: number }[] = [];
  for (const { kind, data } of events) {
    if (kind !== "task.proposed") continue;
    const version = text(data.version);
    const taskId = text(data.taskId) || text(asRecord(data.task)?.taskId);
    if (version !== "" && taskId.length >= MIN_TASK_ID_LEN) {
      heldTasks.push({ taskId, releasedAt: releasedAt.get(version) ?? Number.POSITIVE_INFINITY });
    }
  }
  const starter = starterIn(events);
  const harnessDigests = new Set<string>();
  for (const { kind, data } of events) {
    if (kind !== "harness.promoted" && kind !== "build.checkpoint" && kind !== "build.finished") continue;
    const digest = text(data.harness);
    if (digest.length === FULL_DIGEST_LEN && digest !== starter) harnessDigests.add(digest);
  }
  const checkList = [...checkIds];
  const digestList = [...harnessDigests];
  const shortDigests = [...new Set(digestList.map((digest) => digest.slice(0, SHORT_DIGEST_LEN)))];

  let [buildCheckIds, buildHeldTasks, buildInternalKinds, examHarnessDigests, examInternalKinds] = [
    0, 0, 0, 0, 0,
  ];
  for (const trace of tracesIn(events)) {
    if (trace.part !== "call") continue;
    if (trace.seat === "build") {
      if (checkList.some((id) => hasWholeToken(trace.text, id))) buildCheckIds += 1;
      if (
        heldTasks.some(({ taskId, releasedAt: at }) => trace.index < at && hasWholeToken(trace.text, taskId))
      ) {
        buildHeldTasks += 1;
      }
      if (INTERNAL_KIND_RE.test(trace.text)) buildInternalKinds += 1;
    } else if (trace.seat === "exam") {
      if (
        digestList.some((digest) => trace.text.includes(digest)) ||
        shortDigests.some((short) => hasWholeToken(trace.text, short))
      ) {
        examHarnessDigests += 1;
      }
      if (trace.text.includes("campaign.word")) examInternalKinds += 1;
    }
  }

  const comparisonBySolve = new Map<string, string>();
  for (const { kind, data } of events) {
    if (kind !== "solve.started") continue;
    const comparison = text(data.comparison);
    if (comparison !== "") comparisonBySolve.set(text(data.solve), comparison);
  }
  const networks: string[] = [];
  const byComparison = new Map<string, Set<string>>();
  for (const { kind, data } of events) {
    if (kind !== "solve.finished") continue;
    const network = isString(data.network) ? data.network : "absent";
    networks.push(network);
    const comparison = comparisonBySolve.get(text(data.solve));
    if (comparison !== undefined) {
      const seen = byComparison.get(comparison) ?? new Set<string>();
      seen.add(network);
      byComparison.set(comparison, seen);
    }
  }
  const networkCounts = countBy(networks, (value) => value);
  const recorded = networks.filter((value) => value !== "absent").length;
  const mixedNetworkPresence = recorded > 0 && recorded < networks.length;
  const networkMismatches = [...byComparison].flatMap(([comparison, seen]) =>
    seen.size > 1 ? [`${comparison} (${[...seen].toSorted().join(" vs ")})`] : [],
  );
  return {
    buildCheckIds,
    buildHeldTasks,
    buildInternalKinds,
    examHarnessDigests,
    examInternalKinds,
    networkCounts,
    networkMismatches,
    mixedNetworkPresence,
  };
}

/** Lane 22 derived reader (`wall-audit.txt`). */
export function wallAuditRows(events: readonly LogEvent[]): string[] {
  const scan = wallScanOf(events);
  const wallHits =
    scan.buildCheckIds +
    scan.buildHeldTasks +
    scan.buildInternalKinds +
    scan.examHarnessDigests +
    scan.examInternalKinds;
  const unobserved = Object.keys(scan.networkCounts).length === 1 && scan.networkCounts.absent !== undefined;
  const netState = unobserved
    ? "unobserved"
    : scan.networkMismatches.length === 0 && !scan.mixedNetworkPresence
      ? "clean"
      : `mismatched (${scan.networkMismatches.join("; ") || "mixed present/absent"})`;
  return [
    `wall-audit: ${plural(wallHits, "boundary signal")} (build: check-ids ${String(scan.buildCheckIds)}, held-tasks ${String(scan.buildHeldTasks)}, internal-kinds ${String(scan.buildInternalKinds)}; exam: harness-digests ${String(scan.examHarnessDigests)}, internal-kinds ${String(scan.examInternalKinds)})`,
    `network-parity: ${netState}; solve.finished.network: ${tally(scan.networkCounts)}`,
  ];
}

function pauseOvershoots(events: readonly LogEvent[]): string[] {
  const overshoots: string[] = [];
  for (const [wordIndex, event] of events.entries()) {
    if (event.kind !== "campaign.word" || event.data.word !== PAUSE) continue;
    const { after, base } = event.data;
    if (!isString(after) || after === "next" || !isNumber(base)) continue;
    try {
      pauseKindsOf(after);
    } catch {
      continue;
    }
    let reachedAt = -1;
    for (let i = wordIndex + 1; i < events.length; i += 1) {
      if (pausePointReached(events.slice(0, i + 1), after, base)) {
        reachedAt = i;
        break;
      }
    }
    if (reachedAt === -1) continue;
    for (let i = reachedAt + 1; i < events.length; i += 1) {
      const later = events[i];
      if (later?.kind === "campaign.opened") break;
      if (later?.kind === "comparison.started") {
        overshoots.push(`${text(later.data.session) || "g-?"} after pause(${after})`);
      }
    }
  }
  return overshoots;
}

function seatLedger(events: readonly LogEvent[]): {
  readonly rows: readonly RoleRow[];
  readonly totalBilled: number;
  readonly nonSolverBilled: number;
  readonly overshoots: readonly string[];
} {
  const traces = tracesIn(events);
  const spend = new Map(spendOf(events));
  const auditPasses = draftAuditPasses(events);
  const auditBilled = auditPasses.reduce((sum, row) => sum + row.billed, 0);
  const auditTurns = auditPasses.reduce((sum, row) => sum + row.turns, 0);
  const auditAnomalies = auditPasses.filter(({ verdict }) => verdict === "skipped").length;
  const refereeTotal = spend.get("referee") ?? 0;
  const refereePostBilled = Math.max(0, refereeTotal - auditBilled);
  const refereeTurnsTotal = traces.filter(({ seat, part }) => seat === "referee" && part === "turn").length;
  const refereeCalls = traces.flatMap((each) =>
    each.seat === "referee" && each.part === "call" ? [each] : [],
  );
  const draftAuditCalls = refereeCalls.filter(({ id }) => id.startsWith("draft-"));
  const postRefereeCalls = refereeCalls.filter(({ id }) => !id.startsWith("draft-"));

  const draftEnds = events.filter(({ kind }) => kind === "draft.finished");
  const draftBilled = draftEnds.reduce((sum, { data }) => sum + (isNumber(data.billed) ? data.billed : 0), 0);
  const examinerBilled = Math.max(0, (spend.get("examiner") ?? 0) - draftBilled);
  const examEnds = events.filter(({ kind }) => kind === EXAM_END);
  const buildEnds = events.filter(({ kind }) => kind === "build.finished");
  const findings = events.filter(({ kind }) => kind === "referee.finding");
  const solves = events.filter(({ kind }) => kind === "solve.finished");

  const traceStats = (seat: string) => {
    const mine = traces.filter((each) => each.seat === seat);
    const calls = mine.flatMap((each) => (each.part === "call" ? [each] : []));
    return {
      turns: mine.filter((each) => each.part === "turn").length,
      calls: calls.length,
      errors: calls.filter((each) => each.isError).length,
    };
  };

  const draftStats = traceStats("draft");
  const examStats = traceStats("exam");
  const buildStats = traceStats("build");
  const solveStats = traceStats("solve");

  const rows: RoleRow[] = [
    {
      role: "draft",
      runs: events.filter(({ kind }) => kind === "draft.started").length,
      ...draftStats,
      anomalies: draftEnds.filter(({ data }) => !CLEAN_DRAFT_ENDS.has(text(data.ended))).length,
      billed: draftBilled,
    },
    {
      role: "referee.draft",
      runs: auditPasses.length,
      turns: auditTurns,
      calls: draftAuditCalls.length,
      errors:
        draftAuditCalls.filter((each) => each.isError).length +
        events.filter(({ kind }) => kind === "referee.draft.refused").length,
      anomalies: auditAnomalies,
      billed: auditBilled,
    },
    {
      role: "examiner",
      runs: events.filter(({ kind }) => kind === "exam.started").length,
      ...examStats,
      anomalies: examEnds.filter(
        ({ data }) => !CLEAN_EXAM_ENDS.has(text(data.ended)) || items(data.held).length === 0,
      ).length,
      billed: examinerBilled,
    },
    {
      role: "builder",
      runs: events.filter(({ kind }) => kind === "build.started").length,
      ...buildStats,
      anomalies: buildEnds.filter(({ data }) => text(data.ended) !== "finished" || isString(data.broken))
        .length,
      billed: spend.get("builder") ?? 0,
    },
    {
      role: "solver",
      runs: solves.length,
      ...solveStats,
      anomalies: solves.filter(({ data }) => {
        const ending = asRecord(data.ending);
        return ending?.outcome === "fail" && text(ending.kind) === "broken-harness";
      }).length,
      billed: spend.get("solver") ?? 0,
    },
    {
      role: "referee.adjudicate",
      runs: findings.length,
      turns: Math.max(0, refereeTurnsTotal - auditTurns),
      calls: postRefereeCalls.length,
      errors: postRefereeCalls.filter((each) => each.isError).length,
      anomalies: findings.filter(
        ({ data }) => text(data.ruling) === "unclear" && items(data.probes).length === 0,
      ).length,
      billed: refereePostBilled,
    },
  ];
  const totalBilled = rows.reduce((sum, row) => sum + row.billed, 0);
  const solverBilled = spend.get("solver") ?? 0;
  return {
    rows,
    totalBilled,
    nonSolverBilled: Math.max(0, totalBilled - solverBilled),
    overshoots: pauseOvershoots(events),
  };
}

/** Lane 23 derived reader (`seats.txt`). */
export function seatSummaryRows(events: readonly LogEvent[]): string[] {
  const ledger = seatLedger(events);
  const nonSolverShare =
    ledger.totalBilled > 0 ? percent(ledger.nonSolverBilled / ledger.totalBilled) : "0.0%";
  const lines = ledger.rows.map((row) => {
    const shareText = ledger.totalBilled > 0 ? percent(row.billed / ledger.totalBilled) : "0.0%";
    return `  ${row.role}: ${String(row.runs)} runs, ${String(row.turns)} turns, ${String(row.calls)} calls (${String(row.errors)} err), ${String(row.anomalies)} anomalies, $${row.billed.toFixed(2)} (${shareText})`;
  });
  return [
    `seats: $${ledger.totalBilled.toFixed(2)} total, non-solver $${ledger.nonSolverBilled.toFixed(2)} (${nonSolverShare}); pause overshoots: ${ledger.overshoots.length === 0 ? "none" : ledger.overshoots.join("; ")}`,
    ...lines,
  ];
}

function draftAuditTriggers(log: Index): Trigger[] {
  const passes = draftAuditPasses(log.events);
  const refused = log.of("referee.draft.refused");
  const defects = passes.filter(({ verdict }) => verdict === "defects");
  const skipped = passes.filter(({ verdict }) => verdict === "skipped");
  const unverified = unverifiedFinalPasses(log.events, passes);
  const billed = passes.reduce((sum, row) => sum + row.billed, 0);
  const findings = tally(
    countBy(
      passes.flatMap((row) => row.findings),
      (kind) => kind,
    ),
  );
  return [
    ...firedIf(
      passes.length > 0,
      "DRAFT AUDITED",
      `${passesText(passes.length)}, $${billed.toFixed(2)} billed; verdicts ${tally(countBy(passes, ({ verdict }) => verdict))}; findings ${findings}`,
    ),
    ...firedIf(
      defects.length > 0,
      "DRAFT AUDIT DEFECTS",
      `${share(defects.length, passes.length)} passes found defects (${findings})${unverified.length > 0 ? `; ${plural(unverified.length, "unverified final pass")} before freeze` : ""}`,
    ),
    ...firedIf(
      refused.length > 0,
      "DRAFT AUDIT REFUSED",
      `${plural(refused.length, "refusal")} (${tally(countBy(refused, (data) => text(data.ruling) || "unknown"))})`,
    ),
    ...firedIf(
      skipped.length > 0,
      "DRAFT AUDIT SKIPPED",
      `${share(skipped.length, passes.length)} passes ended skipped`,
    ),
  ];
}

function groundingTriggers(log: Index): Trigger[] {
  const stats = groundingStats(log.events);
  const hasTooling = stats.checksWithTools > 0 || stats.objectiveTools > 0 || stats.readRows > 0;
  return [
    ...firedIf(
      stats.hasDraft && hasTooling,
      "VERIFIER TOOL PROVENANCE",
      `${String(stats.checksWithTools)}/${String(stats.totalChecks)} drafted checks declare tools, ${String(stats.objectiveTools)} objective tools; ${String(stats.authored)} author-decided, ${String(stats.admitted)} admitted`,
    ),
    ...firedIf(
      stats.faultyVerdicts > 0 || stats.nonResults.length > 0,
      "VERIFIER FAULTS",
      `${plural(stats.faultyVerdicts, "faulty verdict")}, ${plural(stats.nonResults.length, "verifier non-result")} (${tally(countBy(stats.nonResults, (kind) => kind))})`,
    ),
  ];
}

function wallTriggers(log: Index): Trigger[] {
  const scan = wallScanOf(log.events);
  const wallHits =
    scan.buildCheckIds +
    scan.buildHeldTasks +
    scan.buildInternalKinds +
    scan.examHarnessDigests +
    scan.examInternalKinds;
  return [
    ...firedIf(
      scan.networkMismatches.length > 0 || scan.mixedNetworkPresence,
      "NETWORK PARITY MISMATCH",
      scan.networkMismatches.length > 0
        ? `cross-arm network drift: ${scan.networkMismatches.join("; ")}`
        : `mixed solve.finished.network presence (${tally(scan.networkCounts)})`,
    ),
    ...firedIf(
      wallHits > 0,
      "WALL BOUNDARY SIGNAL",
      `${plural(wallHits, "signal")} (build check-ids ${String(scan.buildCheckIds)}, held-tasks ${String(scan.buildHeldTasks)}, internal ${String(scan.buildInternalKinds)}; exam digests ${String(scan.examHarnessDigests)}, internal ${String(scan.examInternalKinds)})`,
    ),
  ];
}

function seatTriggers(log: Index): Trigger[] {
  const ledger = seatLedger(log.events);
  const anomalyParts = [
    ...ledger.rows
      .filter(({ anomalies }) => anomalies > 0)
      .map(({ role, anomalies }) => `${role} ${String(anomalies)}`),
    ...(ledger.overshoots.length > 0 ? [`pause overshoot: ${ledger.overshoots.join("; ")}`] : []),
  ];
  const skewed =
    log.compared.length > 0 &&
    ledger.totalBilled >= MIN_SKEW_DOLLARS &&
    ledger.nonSolverBilled / ledger.totalBilled > NON_SOLVER_SKEW;
  return [
    ...firedIf(anomalyParts.length > 0, "SEAT BOUNDARY ANOMALY", anomalyParts.join("; ")),
    ...firedIf(
      skewed,
      "ROLE YIELD SKEW",
      `non-solver roles spent $${ledger.nonSolverBilled.toFixed(2)} of $${ledger.totalBilled.toFixed(2)} (${percent(ledger.nonSolverBilled / ledger.totalBilled)})`,
    ),
  ];
}

/** Triggers for lanes 20 to 23, called from `overview` (`tools/wri/read.ts`). */
export function componentTriggers(log: Index): Trigger[] {
  return [...draftAuditTriggers(log), ...groundingTriggers(log), ...wallTriggers(log), ...seatTriggers(log)];
}
