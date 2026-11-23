/**
 * Cross-cutting run-health and anomaly diagnostics (pulse-first):
 *
 *   bun tools/wri/wri.ts reader diagnostics --log <log>
 *
 * Computes high-signal structural checks that no single-dimension table reports:
 * 1. Dead/unused Builder-written `.toolchain` programs (shipped but 0 test-solve calls).
 * 2. Compaction amnesia (compactions with no `read_opening` within the next 3 seat tool calls).
 * 3. Stop-rule patience burn (eligible no-gain comparisons since the last promotion vs `PATIENCE`).
 * 4. Validity-saturation streak (consecutive reported comparisons with 0 validity differences).
 * 5. Candidate signal-to-noise ratio (median winning `|diff|` vs median `|A/A|` on those tasks).
 * 6. Single-task step fragility (`spareOf === 0` or one task's `|diff|` > sum of all others).
 * 7. Examiner supply efficiency (`$/held-task`, `try_reference/held`, and zero-yield session rate).
 *
 * Wall-safe: emits only counts, ratios, session ids, and 8-char digests — never file names, task
 * text, family names, or hidden values.
 */
import { stateAuditFiles } from "#src/harness/audit.ts";
import { differenceOf, pointsOf, readsStep } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { PATIENCE } from "#src/kernel/reports.ts";
import { isNumber } from "#src/meta/json-shape.ts";
import { basename, join } from "#src/meta/path.ts";
import { median } from "#src/meta/tally.ts";
import { hasWholeToken, plural } from "#src/meta/text.ts";
import { spareOf } from "./clearance.ts";
import { rereadAfter } from "./continuity.ts";
import { EXAM_END, type Index, indexOf, items, TEST, text } from "./folds.ts";
import { testedOf } from "./promotion.ts";

interface Finding {
  readonly level: "WARN" | "INFO";
  readonly factor: string;
  readonly lane: number;
  readonly detail: string;
}

const MIN_SOLVES_FOR_DEAD_CODE = 4;
const LOW_SNR = 1.5;
const HIGH_TRY_PER_HELD = 5;
const DEFAULT_LEVEL = 0.02;

/** 1. Compare Builder-written executable names in `states/<digest>/.toolchain/bin/` against comparison solves. */
function deadProgramFindings(log: Index, statesDir: string): Finding[] {
  const checked = new Set<string>();
  for (const { own } of log.compared) {
    const fresh = text(own.fresh);
    if (fresh !== "" && fresh !== text(own.starter)) checked.add(fresh);
  }
  const findings: Finding[] = [];
  for (const digest of checked) {
    const testSolves = log.solves.filter(
      (solve) => solve.side === TEST && solve.comparison !== null && solve.harness === digest,
    );
    if (testSolves.length < MIN_SOLVES_FOR_DEAD_CODE) continue;
    const binEntries = stateAuditFiles(join(statesDir, digest))
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
      const reached = binEntries.filter(({ name }) => !invoked.has(name) && hasWholeToken(body, name));
      for (const { name } of reached) {
        invoked.add(name);
        queue.push(name);
      }
    }
    const unused = binEntries.filter(({ name }) => !invoked.has(name)).length;
    if (unused > 0) {
      findings.push({
        level: "WARN",
        factor: "climb",
        lane: 9,
        detail: `unused harness bins: ${digest.slice(0, 8)} shipped ${String(binEntries.length)} bin programs, ${String(unused)} never invoked across ${String(testSolves.length)} comparison solves`,
      });
    }
  }
  return findings;
}

/** 2. Compactions on Builder/Examiner/Drafter not followed by `read_opening` within 3 calls. */
function compactionAmnesiaFindings(log: Index): Finding[] {
  const compactions = log.traces.filter((each) => each.part === "compacted" && each.seat !== "solve");
  if (compactions.length === 0) return [];
  const missed = compactions
    .filter((each) => rereadAfter(log.traces, each.seat, each.id, each.index) === "no")
    .map((each) => `${each.seat}:${each.id}`);
  if (missed.length === 0) return [];
  return [
    {
      level: "WARN",
      factor: "climb",
      lane: 15,
      detail: `compaction amnesia: ${String(missed.length)}/${String(compactions.length)} compactions skipped read_opening within 3 calls (${[...new Set(missed)].join(", ")})`,
    },
  ];
}

/** 3–6. Patience burn, validity-saturation streak, signal-to-noise ratio, and single-task fragility. */
function comparisonFindings(log: Index): Finding[] {
  const findings: Finding[] = [];
  const lastPromo = log.events.findLastIndex(({ kind }) => kind === "harness.promoted");
  const sincePromo = log.compared.filter(({ at, own, last }) => {
    if (at <= lastPromo) return false;
    if (own.fresh === own.starter || own.old === own.fresh) return false;
    return text(last.reading) === "no-step";
  });
  if (sincePromo.length >= Math.max(1, PATIENCE - 2)) {
    findings.push({
      level: "WARN",
      factor: "climb",
      lane: 16,
      detail: `patience burn: ${String(sincePromo.length)}/${String(PATIENCE)} candidate no-steps since last promotion (${sincePromo.map(({ session }) => session).join(", ")})`,
    });
  }
  let satStreak = 0;
  const fragile: string[] = [];
  const snrLow: string[] = [];
  for (const comparison of log.compared) {
    const pairs = comparison.pairs();
    if (pairs.length === 0) continue;
    const valUntied = pairs.filter((pair) => pointsOf(pair).validity !== 0).length;
    satStreak = valUntied === 0 ? satStreak + 1 : 0;
    const { differences } = testedOf(comparison.last);
    const level = isNumber(comparison.last.level) ? comparison.last.level : DEFAULT_LEVEL;
    if (readsStep(differences, level)) {
      const spare = spareOf(differences, level);
      const absSorted = differences.map((diff) => Math.abs(diff)).toSorted((a, b) => b - a);
      const [top = 0, ...rest] = absSorted;
      const restSum = rest.reduce((sum, value) => sum + value, 0);
      const dominant = rest.length > 0 && top > restSum;
      if (spare === 0 || dominant) {
        fragile.push(`${comparison.session} (spare ${String(spare)}${dominant ? ", 1-task dominant" : ""})`);
      }
      const aaByTask = new Map(
        comparison.pairs("old").map((pair) => [pair.task, Math.abs(differenceOf(pair))]),
      );
      const winMags = pairs.flatMap((pair) => {
        const diff = differenceOf(pair);
        return diff > 0 ? [diff] : [];
      });
      const aaMags = pairs.flatMap((pair) => {
        const aa = aaByTask.get(pair.task);
        return differenceOf(pair) > 0 && aa !== undefined ? [aa] : [];
      });
      const [medWin, medAa] = [median(winMags), median(aaMags)];
      if (medWin !== null && medAa !== null && medAa > 0 && medWin / medAa <= LOW_SNR) {
        snrLow.push(`${comparison.session} (win/AA ${(medWin / medAa).toFixed(2)}x)`);
      }
    }
  }
  if (satStreak >= 2) {
    findings.push({
      level: "WARN",
      factor: "supply",
      lane: 6,
      detail: `validity saturation streak: last ${String(satStreak)} scored comparisons had 0 validity differences (100% objective-driven)`,
    });
  }
  if (fragile.length > 0) {
    findings.push({
      level: "WARN",
      factor: "honesty",
      lane: 6,
      detail: `fragile step: ${fragile.join("; ")}`,
    });
  }
  if (snrLow.length > 0) {
    findings.push({
      level: "WARN",
      factor: "honesty",
      lane: 6,
      detail: `low signal-to-noise step: ${snrLow.join("; ")}`,
    });
  }
  return findings;
}

/** 7. Examiner supply efficiency: $/held-task, `try_reference` per held task, zero-yield ratio. */
function examinerEfficiencyFindings(log: Index): Finding[] {
  const finished = log.of(EXAM_END);
  if (finished.length === 0) return [];
  const totalHeld = finished.reduce((sum, data) => sum + items(data.held).length, 0);
  const zeroYield = finished.filter((data) => items(data.held).length === 0).length;
  const examBilled = finished.reduce((sum, data) => sum + (isNumber(data.billed) ? data.billed : 0), 0);
  const tries = log.traces.filter(
    (each) => each.part === "call" && each.seat === "exam" && each.tool === "try_reference",
  ).length;
  const tryPerHeld = totalHeld === 0 ? tries : tries / totalHeld;
  const usdPerHeld = totalHeld === 0 ? null : examBilled / totalHeld;
  const badYield = zeroYield * 2 >= finished.length;
  const highTries = tries >= HIGH_TRY_PER_HELD && tryPerHeld > HIGH_TRY_PER_HELD;
  if (!badYield && !highTries) return [];
  const costText = usdPerHeld === null ? `$${examBilled.toFixed(2)} total` : `$${usdPerHeld.toFixed(2)}/held`;
  return [
    {
      level: "WARN",
      factor: "supply",
      lane: 13,
      detail: `examiner inefficiency: ${String(zeroYield)}/${String(finished.length)} zero-yield sessions, ${String(totalHeld)} held, ${String(tries)} try_reference (${tryPerHeld.toFixed(1)}/held), ${costText}`,
    },
  ];
}

/** Cross-cutting structural diagnostics for one campaign log and its `states/` directory. */
export function diagnosticRows(events: readonly LogEvent[], statesDir: string): string[] {
  const log = indexOf(events);
  const findings = [
    ...deadProgramFindings(log, statesDir),
    ...compactionAmnesiaFindings(log),
    ...comparisonFindings(log),
    ...examinerEfficiencyFindings(log),
  ];
  const warns = findings.filter(({ level }) => level === "WARN").length;
  const head = `diagnostics: ${plural(warns, "warning")} across ${String(log.compared.length)} comparisons, ${String(log.builds.length)} Builder and ${String(log.of(EXAM_END).length)} Examiner sessions`;
  if (findings.length === 0) {
    return [
      head,
      "all 7 structural checks clear (dead bins, compaction amnesia, patience burn, validity saturation, step SNR, step fragility, examiner efficiency)",
    ];
  }
  return [
    head,
    ...findings.map(
      ({ level, factor, lane, detail }) => `[${level}] ${factor} (lane ${String(lane)}): ${detail}`,
    ),
  ];
}
