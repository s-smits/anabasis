/**
 * Run-health checks no single table reports:
 *
 *   bun tools/wri/wri.ts reader diagnostics --log <log>
 *
 * 1. Builder-written `.toolchain` programs no test solve called.
 * 2. Compactions with no `read_opening` within the next 3 seat calls.
 * 3. Stop-rule patience burnt since the last promotion, against `PATIENCE`.
 * 4. Consecutive comparisons with no validity difference.
 * 5. Median winning `|diff|` against median `|A/A|` on those tasks.
 * 6. Steps resting on one task (`spareOf` 0, or one `|diff|` above all others summed).
 * 7. Examiner supply: dollars and `try_reference` calls per held task, and zero-yield sessions.
 * 8. Model degradations and unserved error turns across every seat (including `referee`).
 * 9. Drafting sessions that failed to freeze after reaching draft-audit pass 2 or final defects.
 * 10. Judged objective items declared on the frozen/drafted exam with zero `referee.pair` votes.
 * 11. Solves hitting OS permission refusals (`EPERM`/`EACCES`) on `write`/`edit` tool calls.
 *
 * It prints counts, ratios, session ids and 8-character digests, never names, task text or values.
 */
import { starterIn } from "#src/campaign/climb.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { writtenFiles } from "#src/harness/files.ts";
import { differenceOf, pointsOf, isSignificant } from "#src/kernel/compare.ts";
import { hasJudge } from "#src/kernel/contract.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { INTERRUPTED, PATIENCE } from "#src/kernel/reports.ts";
import { degradations, unservedTurns } from "#src/kernel/trace.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { basename, join } from "#src/meta/path.ts";
import { countBy, median } from "#src/meta/tally.ts";
import { hasWholeToken, plural } from "#src/meta/text.ts";
import { spareOf } from "./clearance.ts";
import { rereadAfter } from "./continuity.ts";
import { EXAM_END, type Index, indexOf, items, percent, TEST, text } from "./folds.ts";
import { testedOf } from "./promotion.ts";

const MIN_SOLVES_FOR_DEAD_CODE = 4;
const LOW_SNR = 1.5;
const HIGH_TRY_PER_HELD = 5;
const DEFAULT_LEVEL = 0.02;
const MIN_WRITE_REFUSAL_SOLVES = 2;
const MIN_WRITE_REFUSAL_RATE = 0.05;
const WRITE_REFUSAL = /\b(?:EPERM|EACCES)\b|operation not permitted|permission denied/iu;
const PROBE_CONTENT_MAX = 12;
const AUDIT_VERDICTS = new Set(["sound", "defects", "skipped"]);

const warn = (factor: string, lane: number, detail: string): string =>
  `[WARN] ${factor} (lane ${String(lane)}): ${detail}`;

/** 1. Compare Builder-written executable names in `states/<digest>/.toolchain/bin/` against comparison solves. */
function deadProgramFindings(log: Index, statesDir: string): string[] {
  const checked = new Set(
    log.compared.flatMap(({ own }) => {
      const fresh = text(own.fresh);
      return fresh !== "" && fresh !== text(own.starter) ? [fresh] : [];
    }),
  );
  const findings: string[] = [];
  for (const digest of checked) {
    const testSolves = log.solves.filter(
      (solve) => solve.side === TEST && solve.comparison !== null && solve.harness === digest,
    );
    if (testSolves.length < MIN_SOLVES_FOR_DEAD_CODE) continue;
    const binEntries = writtenFiles(join(statesDir, digest), "own")
      .written.filter(({ path }) => path.startsWith("bin/"))
      .map(({ path, text: body }) => ({ name: basename(path), text: body }));
    if (binEntries.length === 0) continue;
    const invoked = new Set(testSolves.flatMap((solve) => solve.programs));
    // Propagate intra-`.toolchain/bin` invocations (e.g. a CLI importing or execing a sibling bin).
    const queue = [...invoked];
    while (queue.length > 0) {
      const caller = queue.pop();
      const body = binEntries.find(({ name }) => name === caller)?.text;
      if (body === undefined) continue;
      for (const { name } of binEntries.filter(({ name: n }) => !invoked.has(n) && hasWholeToken(body, n))) {
        invoked.add(name);
        queue.push(name);
      }
    }
    const unused = binEntries.filter(({ name }) => !invoked.has(name)).length;
    if (unused > 0) {
      findings.push(
        warn(
          "climb",
          8,
          `unused harness bins: ${digest.slice(0, 8)} shipped ${String(binEntries.length)} bin programs, ${String(unused)} never invoked across ${String(testSolves.length)} comparison solves`,
        ),
      );
    }
  }
  return findings;
}

/** 2. Compactions on Builder/Examiner/Drafter not followed by `read_opening` within 3 calls. */
function compactionAmnesiaFindings(log: Index): string[] {
  const compactions = log.traces.filter((each) => each.part === "compacted" && each.seat !== "solve");
  const missed = compactions
    .filter((each) => rereadAfter(log.traces, each.seat, each.id, each.index) === "no")
    .map((each) => `${each.seat}:${each.id}`);
  return missed.length === 0
    ? []
    : [
        warn(
          "climb",
          13,
          `compaction amnesia: ${String(missed.length)}/${String(compactions.length)} compactions skipped read_opening within 3 calls (${[...new Set(missed)].join(", ")})`,
        ),
      ];
}

/** 3–6. Patience burn, validity-saturation streak, signal-to-noise ratio, and single-task fragility. */
function comparisonFindings(log: Index): string[] {
  const lastPromo = log.events.findLastIndex(({ kind }) => kind === "harness.promoted");
  const sincePromo = log.compared.filter(
    ({ at, own, last }) =>
      at > lastPromo &&
      own.fresh !== own.starter &&
      own.old !== own.fresh &&
      text(last.reading) === "no-step",
  );
  let satStreak = 0;
  const [fragile, snrLow]: [string[], string[]] = [[], []];
  for (const comparison of log.compared) {
    const pairs = comparison.pairs();
    if (pairs.length === 0) continue;
    satStreak = pairs.some((pair) => pointsOf(pair).validity !== 0) ? 0 : satStreak + 1;
    const { differences } = testedOf(comparison.last);
    const level = isNumber(comparison.last.level) ? comparison.last.level : DEFAULT_LEVEL;
    if (!isSignificant(differences, level)) continue;
    const spare = spareOf(differences, level);
    const [top = 0, ...rest] = differences.map((diff) => Math.abs(diff)).toSorted((a, b) => b - a);
    const dominant = rest.length > 0 && top > rest.reduce((sum, value) => sum + value, 0);
    if (spare === 0 || dominant) {
      fragile.push(`${comparison.session} (spare ${String(spare)}${dominant ? ", 1-task dominant" : ""})`);
    }
    const aaByTask = new Map(
      comparison.pairs("old").map((pair) => [pair.task, Math.abs(differenceOf(pair))]),
    );
    const wins = pairs.filter((pair) => differenceOf(pair) > 0);
    const [medWin, medAa] = [
      median(wins.map((pair) => differenceOf(pair))),
      median(wins.flatMap((pair) => aaByTask.get(pair.task) ?? [])),
    ];
    if (medWin !== null && medAa !== null && medAa > 0 && medWin / medAa <= LOW_SNR) {
      snrLow.push(`${comparison.session} (win/AA ${(medWin / medAa).toFixed(2)}x)`);
    }
  }
  return [
    ...(sincePromo.length >= Math.max(1, PATIENCE - 2)
      ? [
          warn(
            "climb",
            13,
            `patience burn: ${String(sincePromo.length)}/${String(PATIENCE)} candidate no-steps since last promotion (${sincePromo.map(({ session }) => session).join(", ")})`,
          ),
        ]
      : []),
    ...(satStreak >= 2
      ? [
          warn(
            "honesty",
            5,
            `validity saturation streak: last ${String(satStreak)} scored comparisons had 0 validity differences (100% objective-driven)`,
          ),
        ]
      : []),
    ...(fragile.length > 0 ? [warn("honesty", 5, `fragile step: ${fragile.join("; ")}`)] : []),
    ...(snrLow.length > 0 ? [warn("honesty", 5, `low signal-to-noise step: ${snrLow.join("; ")}`)] : []),
  ];
}

/** 7. Examiner supply efficiency: $/held-task, `try_reference` per held task, zero-yield ratio. */
function examinerEfficiencyFindings(log: Index): string[] {
  const finished = log.of(EXAM_END);
  if (finished.length === 0) return [];
  const totalHeld = finished.reduce((sum, data) => sum + items(data.held).length, 0);
  const zeroYield = finished.filter((data) => items(data.held).length === 0).length;
  const examBilled = finished.reduce((sum, data) => sum + (isNumber(data.billed) ? data.billed : 0), 0);
  const tries = log.traces.filter(
    (each) => each.part === "call" && each.seat === "exam" && each.tool === "try_reference",
  ).length;
  const tryPerHeld = totalHeld === 0 ? tries : tries / totalHeld;
  if (zeroYield * 2 < finished.length && (tries < HIGH_TRY_PER_HELD || tryPerHeld <= HIGH_TRY_PER_HELD)) {
    return [];
  }
  const costText =
    totalHeld === 0 ? `$${examBilled.toFixed(2)} total` : `$${(examBilled / totalHeld).toFixed(2)}/held`;
  return [
    warn(
      "supply",
      7,
      `examiner inefficiency: ${String(zeroYield)}/${String(finished.length)} zero-yield sessions, ${String(totalHeld)} held, ${String(tries)} try_reference (${tryPerHeld.toFixed(1)}/held), ${costText}`,
    ),
  ];
}

function seatServingFindings(log: Index): string[] {
  const [swapped, unserved] = [degradations(log.events), unservedTurns(log.events)];
  const parts = [
    ...(swapped.length > 0
      ? [
          `${plural(
            swapped.reduce((sum, row) => sum + row.turns, 0),
            "degraded turn",
          )} (${[...new Set(swapped.map((row) => row.seat))].join(", ")})`,
        ]
      : []),
    ...(unserved.length > 0
      ? [
          `${plural(unserved.length, "unserved error turn")} (${Object.entries(
            countBy(unserved, (turn) => turn.seat),
          )
            .map(([seat, count]) => `${seat} ${String(count)}`)
            .join(", ")})`,
        ]
      : []),
  ];
  return parts.length === 0 ? [] : [warn("honesty", 9, `seat serving gap: ${parts.join("; ")}`)];
}

function draftFreezeFindings(log: Index): string[] {
  if (log.of("contract.frozen").length > 0) return [];
  const audits = log.of("referee.draft");
  const maxPass = Math.max(0, ...audits.map((data) => (isNumber(data.pass) ? data.pass : 0)));
  const rawVerdict = text(audits.at(-1)?.verdict);
  const lastVerdict = AUDIT_VERDICTS.has(rawVerdict) ? rawVerdict : "other";
  const endedExam = log.of("campaign.ended").some((data) => text(data.ending) === "exam");
  const cleanDraftEnd = log.of("draft.finished").some((data) => !INTERRUPTED.has(data.ended));
  if (
    (!endedExam && (draftOf(log.events) !== null || !cleanDraftEnd)) ||
    (maxPass < 2 && lastVerdict !== "defects")
  ) {
    return [];
  }
  return [
    warn(
      "verdicts",
      18,
      `drafting failed to freeze: ${String(audits.length)} draft-audit pass(es) (max pass ${String(maxPass)}, last ${lastVerdict}) without contract.frozen`,
    ),
  ];
}

function judgedLaneFindings(log: Index): string[] {
  const draft = draftOf(log.events);
  if (draft === null || !hasJudge(draft.objective)) return [];
  if (log.of("referee.pair").some((data) => isNumber(data.judge) && isNumber(data.holistic))) return [];
  const reported = log.compared.filter((comparison) => text(comparison.last.reading) !== "").length;
  const started = log.of("comparison.started").filter((data) => data.ladder !== true).length;
  const endedEnv = log.of("campaign.ended").some((data) => text(data.ending) === "environment");
  if (reported === 0 && (started === 0 || !endedEnv)) return [];
  const scope =
    reported > 0
      ? `across ${String(reported)} reported comparisons`
      : `across ${plural(started, "started comparison")} before ending environment`;
  return [
    warn(
      "verdicts",
      11,
      `unexercised judged lane: exam declared judge items yet 0 referee.pair votes completed ${scope}`,
    ),
  ];
}

function writeRefusalFindings(log: Index): string[] {
  const totalSolves = Math.max(
    log.solves.length,
    new Set(log.traces.filter((each) => each.seat === "solve").map((each) => each.id)).size,
  );
  const refusedCalls = log.traces.flatMap((each) =>
    each.part === "call" &&
    each.seat === "solve" &&
    (each.tool === "write" || each.tool === "edit") &&
    each.isError &&
    WRITE_REFUSAL.test(each.text)
      ? [each]
      : [],
  );
  const refused = new Set(refusedCalls.map((each) => each.id));
  const substantive = new Set(
    refusedCalls.flatMap(({ id, tool, args }) => {
      const content = tool === "write" ? asRecord(args)?.content : undefined;
      return !isString(content) || content.length > PROBE_CONTENT_MAX ? [id] : [];
    }),
  );
  const overallHit =
    refused.size >= MIN_WRITE_REFUSAL_SOLVES &&
    totalSolves > 0 &&
    refused.size / totalSolves >= MIN_WRITE_REFUSAL_RATE;
  const hot = [
    ...Map.groupBy(
      log.solves.filter(({ harness }) => harness !== ""),
      ({ harness }) => harness,
    ),
  ]
    .map(([harness, solves]) => ({
      harness,
      refused: solves.filter((solve) => refused.has(solve.id)).length,
      total: solves.length,
    }))
    .filter(
      (row) => row.refused >= MIN_WRITE_REFUSAL_SOLVES && row.refused / row.total >= MIN_WRITE_REFUSAL_RATE,
    )
    .toSorted(
      (a, b) =>
        b.refused / b.total - a.refused / a.total ||
        b.refused - a.refused ||
        a.harness.localeCompare(b.harness),
    );
  if (!overallHit && hot.length === 0) return [];
  const starter = starterIn(log.events);
  const suffix =
    hot.length === 0
      ? ""
      : `; by harness: ${hot
          .map(
            (row) =>
              `${row.harness === starter ? `starter ${row.harness.slice(0, 8)}` : row.harness.slice(0, 8)} ${String(row.refused)}/${String(row.total)} (${percent(row.refused / row.total)})`,
          )
          .join(", ")}`;
  const probeNote =
    substantive.size < refused.size
      ? ` (${String(substantive.size)}/${String(refused.size)} with content >${String(PROBE_CONTENT_MAX)} chars)`
      : "";
  return [
    warn(
      "honesty",
      19,
      `solver write/edit permission refusals: ${String(refused.size)}/${String(totalSolves)} solves hit EPERM/EACCES${probeNote}${suffix}`,
    ),
  ];
}

export function diagnosticRows(events: readonly LogEvent[], statesDir: string): string[] {
  const log = indexOf(events);
  const findings = [
    ...deadProgramFindings(log, statesDir),
    ...compactionAmnesiaFindings(log),
    ...comparisonFindings(log),
    ...examinerEfficiencyFindings(log),
    ...seatServingFindings(log),
    ...draftFreezeFindings(log),
    ...judgedLaneFindings(log),
    ...writeRefusalFindings(log),
  ];
  const head = `diagnostics: ${plural(findings.length, "warning")} across ${String(log.compared.length)} comparisons, ${String(log.builds.length)} Builder and ${String(log.of(EXAM_END).length)} Examiner sessions`;
  return findings.length === 0
    ? [
        head,
        "all 11 structural checks clear (dead bins, compaction amnesia, patience burn, validity saturation, step SNR, step fragility, examiner efficiency, seat serving, draft freeze, judged lane, write refusals)",
      ]
    : [head, ...findings];
}
