/**
 * Component readers and their triggers: `draft-audit.txt` (the Adversarial Draft Auditor, lane 18),
 * `grounding.txt` (verifier tool provenance and faults, lane 4), `wall-audit.txt` (cross-seat wall
 * signals and network parity, lane 9) and `seats.txt` (the per-role ledger and pause overshoots).
 * They print only event kinds, counts, enums, session ids, 8-character digests, dollars and ratios.
 */
import { starterIn } from "#src/campaign/climb.ts";
import { PAUSE, pauseKindsOf, pausePointReached } from "#src/campaign/signal.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { unadmitted } from "#src/kernel/acceptance.ts";
import { type EventKind, eventsOf, type LogEvent } from "#src/kernel/log.ts";
import { spendOf } from "#src/kernel/meter.ts";
import { type Seat, type Traced, tracesIn } from "#src/kernel/trace.ts";
import { HOST_TOOLS_FILE } from "#src/kernel/verify.ts";
import { TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { countBy } from "#src/meta/tally.ts";
import { hasWholeToken, plural } from "#src/meta/text.ts";
import { EXAM_END, emitIf, type Index, items, percent, share, tally, text, type Trigger } from "./folds.ts";

interface DraftAuditPass {
  readonly index: number;
  readonly session: string;
  readonly pass: number;
  readonly verdict: string;
  readonly findings: readonly string[];
  readonly allFindingsProbed: boolean;
  readonly probes: number;
  readonly turns: number;
  readonly billed: number;
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
const REFEREE_DRAFT = "referee.draft";
const REFEREE_ADJUDICATE = "referee.adjudicate";
const SOLVE_FINISHED = "solve.finished";
const SEAT_ROLES = {
  draft: "draft",
  exam: "examiner",
  build: "builder",
  solve: "solver",
  referee: REFEREE_ADJUDICATE,
} satisfies Record<Seat, string>;
const WALL_TARGET_KINDS: readonly EventKind[] = [
  "task.state",
  "task.proposed",
  "harness.promoted",
  "build.checkpoint",
  "build.finished",
];

const passesText = (count: number) => (count === 1 ? "1 pass" : `${String(count)} passes`);
const tallyStrings = (values: readonly string[]) => tally(countBy(values, (value) => value));

export function draftAuditPasses(events: readonly LogEvent[]): DraftAuditPass[] {
  return eventsOf(events, REFEREE_DRAFT).map(({ index, event: { data } }) => {
    const probeRows = items(data.probeRows);
    const probeIds = new Set(
      probeRows.flatMap((entry) => {
        const id = asRecord(entry)?.id;
        return isNumber(id) ? [id] : [];
      }),
    );
    const rawFindings = items(data.findings).flatMap((entry) => {
      const record = asRecord(entry);
      const kind = text(record?.kind);
      return kind === "" ? [] : [{ kind, probe: isNumber(record?.probe) ? record.probe : null }];
    });
    return {
      index,
      session: text(data.session) || "d-?",
      pass: isNumber(data.pass) ? data.pass : 1,
      verdict: text(data.verdict) || "unknown",
      findings: rawFindings.map(({ kind }) => kind),
      allFindingsProbed:
        rawFindings.length > 0 && rawFindings.every(({ probe }) => probe !== null && probeIds.has(probe)),
      probes: probeRows.length,
      turns: isNumber(data.turns) ? data.turns : 0,
      billed: isNumber(data.billed) ? data.billed : 0,
    };
  });
}

function finalDefectPasses(
  events: readonly LogEvent[],
  passes: readonly DraftAuditPass[],
): { readonly unverified: DraftAuditPass[]; readonly replayed: DraftAuditPass[] } {
  const draftedBy = new Map<string, number>();
  for (const { index, event } of eventsOf(events, "exam.drafted")) {
    draftedBy.set(text(event.data.session) || "d-?", index);
  }
  const unverified: DraftAuditPass[] = [];
  const replayed: DraftAuditPass[] = [];
  for (const [session, rows] of Map.groupBy(passes, (row) => row.session)) {
    const freezeAt = draftedBy.get(session);
    if (freezeAt === undefined) continue;
    const last = rows.findLast((row) => row.index < freezeAt);
    if (last?.verdict !== "defects") continue;
    if (last.allFindingsProbed) replayed.push(last);
    else unverified.push(last);
  }
  return { unverified, replayed };
}

export function unverifiedFinalPasses(
  events: readonly LogEvent[],
  passes: readonly DraftAuditPass[],
): DraftAuditPass[] {
  return finalDefectPasses(events, passes).unverified;
}

function draftAuditSummary(events: readonly LogEvent[]) {
  const passes = draftAuditPasses(events);
  const refused = eventsOf(events, "referee.draft.refused").map(({ event }) => event.data);
  const billed = passes.reduce((sum, row) => sum + row.billed, 0);
  const turns = passes.reduce((sum, row) => sum + row.turns, 0);
  const probes = passes.reduce((sum, row) => sum + row.probes, 0);
  const verdicts = tally(countBy(passes, ({ verdict }) => verdict));
  const findings = tallyStrings(passes.flatMap((row) => row.findings));
  const refusedRulings = tally(countBy(refused, (data) => text(data.ruling) || "unknown"));
  const { unverified, replayed } = finalDefectPasses(events, passes);
  return { passes, refused, billed, turns, probes, verdicts, findings, refusedRulings, unverified, replayed };
}

export function draftAuditRows(events: readonly LogEvent[]): string[] {
  const { passes, refused, billed, turns, probes, verdicts, findings, refusedRulings, unverified, replayed } =
    draftAuditSummary(events);
  if (passes.length === 0 && refused.length === 0) return ["draft-audit: none recorded"];
  const sessions = new Set(passes.map(({ session }) => session)).size;
  const finalParts = [
    ...(unverified.length > 0 ? [`unverified (${String(unverified.length)})`] : []),
    ...(replayed.length > 0 ? [`replayed (${String(replayed.length)})`] : []),
  ];
  const finalState = finalParts.length === 0 ? "none" : finalParts.join(", ");
  return [
    `draft-audit: ${passesText(passes.length)} across ${plural(sessions, "session")}, $${billed.toFixed(2)} billed (${plural(turns, "turn")}, ${plural(probes, "probe")}); verdicts: ${verdicts}; findings: ${findings}; refused: ${String(refused.length)}; final-pass defects: ${finalState}`,
    ...passes.map(
      (row) =>
        `  ${row.session} pass ${String(row.pass)}: ${row.verdict}, ${plural(row.findings.length, "finding")} (${tallyStrings(row.findings)}), ${plural(row.probes, "probe")}, ${plural(row.turns, "turn")}, $${row.billed.toFixed(2)}`,
    ),
    ...(refused.length === 0 ? [] : [`  refused: ${refusedRulings}`]),
  ];
}

function stagedToolchainSummary(events: readonly LogEvent[], examsDir: string | undefined) {
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
    return {
      origin: text(parsed?.origin) || "unknown",
      hostTools: items(parsed?.tools).filter(isString).length,
      stagedBins,
    };
  } catch {
    return { origin: "unreadable", hostTools: 0, stagedBins };
  }
}

function groundingStats(events: readonly LogEvent[]) {
  const draft = draftOf(events);
  const checks = draft?.checks ?? [];
  const reading = eventsOf(events, "checker.read").at(-1)?.event.data;
  const frozen = eventsOf(events, "contract.frozen").at(-1)?.event.data;
  const faultyVerdicts = eventsOf(events, "verdict").filter(
    ({ event }) => event.data.kind === "faulty",
  ).length;
  const nonResults = eventsOf(events, SOLVE_FINISHED).flatMap(({ event: { data } }) => {
    const ending = asRecord(data.ending);
    const kind = text(ending?.kind);
    return ending?.outcome === "non-result" && VERIFIER_NON_RESULTS.has(kind) ? [kind] : [];
  });
  return {
    hasDraft: draft !== null,
    totalChecks: checks.length,
    checksWithTools: checks.filter(({ tools }) => (tools?.length ?? 0) > 0).length,
    objectiveTools: draft?.objectiveTools?.length ?? 0,
    readRows: items(reading?.rows).length,
    authored: unadmitted(events, []).length,
    admitted: items(frozen?.admitted).filter(isString).length,
    faultyVerdicts,
    nonResults,
  };
}

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
    `  verifier faults: ${plural(stats.faultyVerdicts, "faulty verdict")}, ${plural(stats.nonResults.length, "verifier non-result")} (${tallyStrings(stats.nonResults)})`,
  ];
}

function wallTargetsOf(events: readonly LogEvent[]) {
  const draftChecks = (draftOf(events)?.checks ?? []).map(({ id }) => id);
  const readChecks = items(eventsOf(events, "checker.read").at(-1)?.event.data.rows).map((row) =>
    text(asRecord(row)?.id),
  );
  const checkList = [...new Set([...draftChecks, ...readChecks].filter((id) => CHECK_ID_RE.test(id)))];
  const starter = starterIn(events);
  const releasedAt = new Map<string, number>();
  const proposed: { readonly version: string; readonly taskId: string }[] = [];
  const digests = new Set<string>();
  for (const { index, event } of eventsOf(events, WALL_TARGET_KINDS)) {
    const { kind, data } = event;
    const version = text(data.version);
    if (kind === "task.state") {
      if (data.state === "released" && version !== "" && !releasedAt.has(version)) {
        releasedAt.set(version, index);
      }
    } else if (kind === "task.proposed") {
      const taskId = text(data.taskId) || text(asRecord(data.task)?.taskId);
      if (version !== "" && taskId.length >= MIN_TASK_ID_LEN) proposed.push({ version, taskId });
    } else {
      const digest = text(data.harness);
      if (digest.length === FULL_DIGEST_LEN && digest !== starter) digests.add(digest);
    }
  }
  const digestList = [...digests];
  return {
    checkList,
    heldTasks: proposed.map(({ version, taskId }) => ({
      taskId,
      releasedAt: releasedAt.get(version) ?? Number.POSITIVE_INFINITY,
    })),
    digestList,
    shortDigests: [...new Set(digestList.map((digest) => digest.slice(0, SHORT_DIGEST_LEN)))],
  };
}

function wallScanOf(events: readonly LogEvent[]) {
  const { checkList, heldTasks, digestList, shortDigests } = wallTargetsOf(events);
  let [buildCheckIds, buildHeldTasks, buildInternalKinds, examHarnessDigests, examInternalKinds] = [
    0, 0, 0, 0, 0,
  ];
  for (const { index, event } of eventsOf(events, ["build.call", "exam.call"])) {
    const body = text(event.data.text);
    if (event.kind === "build.call") {
      if (body.includes("check-") && checkList.some((id) => hasWholeToken(body, id))) buildCheckIds += 1;
      if (heldTasks.some(({ taskId, releasedAt: at }) => index < at && hasWholeToken(body, taskId))) {
        buildHeldTasks += 1;
      }
      if (INTERNAL_KIND_RE.test(body)) buildInternalKinds += 1;
    } else {
      if (
        digestList.some((digest) => body.includes(digest)) ||
        shortDigests.some((short) => hasWholeToken(body, short))
      ) {
        examHarnessDigests += 1;
      }
      if (body.includes("campaign.word")) examInternalKinds += 1;
    }
  }
  const comparisonBySolve = new Map<string, string>();
  const networks: string[] = [];
  const byComparison = new Map<string, Set<string>>();
  for (const { event } of eventsOf(events, ["solve.started", SOLVE_FINISHED])) {
    const { kind, data } = event;
    if (kind === "solve.started") {
      const comparison = text(data.comparison);
      if (comparison !== "") comparisonBySolve.set(text(data.solve), comparison);
    } else {
      const network = isString(data.network) ? data.network : "absent";
      networks.push(network);
      const comparison = comparisonBySolve.get(text(data.solve));
      if (comparison !== undefined) {
        byComparison.set(comparison, (byComparison.get(comparison) ?? new Set()).add(network));
      }
    }
  }
  const networkCounts = countBy(networks, (value) => value);
  const recorded = networks.length - (networkCounts.absent ?? 0);
  return {
    buildCheckIds,
    buildHeldTasks,
    buildInternalKinds,
    examHarnessDigests,
    examInternalKinds,
    wallHits: buildCheckIds + buildHeldTasks + buildInternalKinds + examHarnessDigests + examInternalKinds,
    networkCounts,
    networkMismatches: [...byComparison].flatMap(([comparison, seen]) =>
      seen.size > 1 ? [`${comparison} (${[...seen].toSorted().join(" vs ")})`] : [],
    ),
    mixedNetworkPresence: recorded > 0 && recorded < networks.length,
  };
}

export function wallAuditRows(events: readonly LogEvent[]): string[] {
  const scan = wallScanOf(events);
  const unobserved = Object.keys(scan.networkCounts).length === 1 && scan.networkCounts.absent !== undefined;
  const netState = unobserved
    ? "unobserved"
    : scan.networkMismatches.length === 0 && !scan.mixedNetworkPresence
      ? "clean"
      : `mismatched (${scan.networkMismatches.join("; ") || "mixed present/absent"})`;
  return [
    `wall-audit: ${plural(scan.wallHits, "boundary signal")} (build: check-ids ${String(scan.buildCheckIds)}, held-tasks ${String(scan.buildHeldTasks)}, internal-kinds ${String(scan.buildInternalKinds)}; exam: harness-digests ${String(scan.examHarnessDigests)}, internal-kinds ${String(scan.examInternalKinds)})`,
    `network-parity: ${netState}; solve.finished.network: ${tally(scan.networkCounts)}`,
  ];
}

function pauseOvershoots(events: readonly LogEvent[]): string[] {
  const overshoots: string[] = [];
  for (const { index: wordIndex, event } of eventsOf(events, "campaign.word")) {
    if (event.data.word !== PAUSE) continue;
    const { after, base } = event.data;
    if (!isString(after) || after === "next" || !isNumber(base)) continue;
    let kinds: readonly EventKind[];
    try {
      kinds = pauseKindsOf(after);
    } catch {
      continue;
    }
    const scan: EventKind[] = after === "reported" ? [...kinds, "harness.promoted"] : [...kinds];
    const candidates = [
      ...(wordIndex + 1 < events.length ? [wordIndex + 1] : []),
      ...eventsOf(events, scan).flatMap(({ index }) => (index > wordIndex + 1 ? [index] : [])),
    ];
    const reachedAt = candidates.find((i) => pausePointReached(events.slice(0, i + 1), after, base));
    if (reachedAt === undefined) continue;
    for (const { index, event: later } of eventsOf(events, ["campaign.opened", "comparison.started"])) {
      if (index <= reachedAt) continue;
      if (later.kind === "campaign.opened") break;
      overshoots.push(`${text(later.data.session) || "g-?"} after pause(${after})`);
    }
  }
  return overshoots;
}

function seatLedger(events: readonly LogEvent[], traces: readonly Traced[] = tracesIn(events)) {
  const counts = new Map<
    string,
    { runs: number; turns: number; calls: number; errors: number; anomalies: number }
  >();
  const rowOf = (role: string) => {
    const held = counts.get(role) ?? { runs: 0, turns: 0, calls: 0, errors: 0, anomalies: 0 };
    counts.set(role, held);
    return held;
  };
  for (const trace of traces) {
    const role =
      trace.seat === "referee" && trace.id.startsWith("draft-") ? REFEREE_DRAFT : SEAT_ROLES[trace.seat];
    const entry = rowOf(role);
    if (trace.part === "turn") entry.turns += 1;
    else if (trace.part === "call") {
      entry.calls += 1;
      if (trace.isError) entry.errors += 1;
    }
  }
  const auditPasses = draftAuditPasses(events);
  const auditBilled = auditPasses.reduce((sum, row) => sum + row.billed, 0);
  const draftBilled = eventsOf(events, "draft.finished").reduce(
    (sum, { event: { data } }) => sum + (isNumber(data.billed) ? data.billed : 0),
    0,
  );
  const roleSpecs: readonly [string, EventKind, EventKind, (data: LogEvent["data"]) => boolean][] = [
    ["draft", "draft.started", "draft.finished", (d) => !CLEAN_DRAFT_ENDS.has(text(d.ended))],
    [
      "examiner",
      "exam.started",
      EXAM_END,
      (d) => !CLEAN_EXAM_ENDS.has(text(d.ended)) || items(d.held).length === 0,
    ],
    ["builder", "build.started", "build.finished", (d) => text(d.ended) !== "finished" || isString(d.broken)],
    [
      "solver",
      SOLVE_FINISHED,
      SOLVE_FINISHED,
      (d) => asRecord(d.ending)?.outcome === "fail" && text(asRecord(d.ending)?.kind) === "broken-harness",
    ],
    [
      REFEREE_ADJUDICATE,
      "referee.finding",
      "referee.finding",
      (d) => !isString(d.reusedFrom) && text(d.ruling) === "unclear" && items(d.probes).length === 0,
    ],
  ];
  for (const [role, start, end, bad] of roleSpecs) {
    const entry = rowOf(role);
    entry.runs += eventsOf(events, start).length;
    entry.anomalies += eventsOf(events, end).filter(({ event: { data } }) => bad(data)).length;
  }
  rowOf(REFEREE_DRAFT).errors += eventsOf(events, "referee.draft.refused").length;
  const auditRow = rowOf(REFEREE_DRAFT);
  auditRow.runs = auditPasses.length;
  auditRow.turns = auditPasses.reduce((sum, row) => sum + row.turns, 0);
  auditRow.anomalies = auditPasses.filter(({ verdict }) => verdict === "skipped").length;
  const spend = new Map(spendOf(events));
  const billedBy: readonly (readonly [string, number])[] = [
    ["draft", draftBilled],
    [REFEREE_DRAFT, auditBilled],
    ["examiner", Math.max(0, (spend.get("examiner") ?? 0) - draftBilled)],
    ["builder", spend.get("builder") ?? 0],
    ["solver", spend.get("solver") ?? 0],
    [REFEREE_ADJUDICATE, Math.max(0, (spend.get("referee") ?? 0) - auditBilled)],
  ];
  const rows: RoleRow[] = billedBy.map(([role, billed]) => ({ role, ...rowOf(role), billed }));
  const totalBilled = rows.reduce((sum, row) => sum + row.billed, 0);
  return {
    rows,
    totalBilled,
    nonSolverBilled: Math.max(0, totalBilled - (spend.get("solver") ?? 0)),
    overshoots: pauseOvershoots(events),
  };
}

export function seatSummaryRows(events: readonly LogEvent[]): string[] {
  const ledger = seatLedger(events);
  const pct = (part: number) => (ledger.totalBilled > 0 ? percent(part / ledger.totalBilled) : "0.0%");
  return [
    `seats: $${ledger.totalBilled.toFixed(2)} total, non-solver $${ledger.nonSolverBilled.toFixed(2)} (${pct(ledger.nonSolverBilled)}); pause overshoots: ${ledger.overshoots.length === 0 ? "none" : ledger.overshoots.join("; ")}`,
    ...ledger.rows.map(
      (row) =>
        `  ${row.role}: ${String(row.runs)} runs, ${String(row.turns)} turns, ${String(row.calls)} calls (${String(row.errors)} err), ${String(row.anomalies)} anomalies, $${row.billed.toFixed(2)} (${pct(row.billed)})`,
    ),
  ];
}

/** The component readers' triggers, called from `overview` (`tools/wri/read.ts`). */
export function componentTriggers(log: Index): Trigger[] {
  const audit = draftAuditSummary(log.events);
  const defects = audit.passes.filter(({ verdict }) => verdict === "defects");
  const skipped = audit.passes.filter(({ verdict }) => verdict === "skipped");
  const stats = groundingStats(log.events);
  const scan = wallScanOf(log.events);
  const ledger = seatLedger(log.events, log.traces);
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
    ...emitIf(
      audit.passes.length > 0,
      "DRAFT AUDITED",
      `${passesText(audit.passes.length)}, $${audit.billed.toFixed(2)} billed; verdicts ${audit.verdicts}; findings ${audit.findings}`,
    ),
    ...emitIf(
      defects.length > 0,
      "DRAFT AUDIT DEFECTS",
      `${share(defects.length, audit.passes.length)} passes found defects (${audit.findings})${audit.unverified.length > 0 ? `; ${plural(audit.unverified.length, "unverified final pass")} before freeze` : ""}${audit.replayed.length > 0 ? `; ${plural(audit.replayed.length, "replayed final pass")} before freeze` : ""}`,
    ),
    ...emitIf(
      audit.refused.length > 0,
      "DRAFT AUDIT REFUSED",
      `${plural(audit.refused.length, "refusal")} (${audit.refusedRulings})`,
    ),
    ...emitIf(
      skipped.length > 0,
      "DRAFT AUDIT SKIPPED",
      `${share(skipped.length, audit.passes.length)} passes ended skipped`,
    ),
    ...emitIf(
      stats.hasDraft && (stats.checksWithTools > 0 || stats.objectiveTools > 0 || stats.readRows > 0),
      "VERIFIER TOOL PROVENANCE",
      `${String(stats.checksWithTools)}/${String(stats.totalChecks)} drafted checks declare tools, ${String(stats.objectiveTools)} objective tools; ${String(stats.authored)} author-decided, ${String(stats.admitted)} admitted`,
    ),
    ...emitIf(
      stats.faultyVerdicts > 0 || stats.nonResults.length > 0,
      "VERIFIER FAULTS",
      `${plural(stats.faultyVerdicts, "faulty verdict")}, ${plural(stats.nonResults.length, "verifier non-result")} (${tallyStrings(stats.nonResults)})`,
    ),
    ...emitIf(
      scan.networkMismatches.length > 0 || scan.mixedNetworkPresence,
      "NETWORK PARITY MISMATCH",
      scan.networkMismatches.length > 0
        ? `cross-arm network drift: ${scan.networkMismatches.join("; ")}`
        : `mixed solve.finished.network presence (${tally(scan.networkCounts)})`,
    ),
    ...emitIf(
      scan.wallHits > 0,
      "WALL BOUNDARY SIGNAL",
      `${plural(scan.wallHits, "signal")} (build check-ids ${String(scan.buildCheckIds)}, held-tasks ${String(scan.buildHeldTasks)}, internal ${String(scan.buildInternalKinds)}; exam digests ${String(scan.examHarnessDigests)}, internal ${String(scan.examInternalKinds)})`,
    ),
    ...emitIf(anomalyParts.length > 0, "SEAT BOUNDARY ANOMALY", anomalyParts.join("; ")),
    ...emitIf(
      skewed,
      "ROLE YIELD SKEW",
      `non-solver roles spent $${ledger.nonSolverBilled.toFixed(2)} of $${ledger.totalBilled.toFixed(2)} (${percent(ledger.nonSolverBilled / ledger.totalBilled)})`,
    ),
  ];
}
