#!/usr/bin/env bun

/**
 * Score M2's labels against a frozen truth file and its pass bar. M2 rules on a comparison only
 * when its labels pass P1–P5 on the primary calibration cases:
 *
 * - P1, limit recall: every recorded limit is read as `limit`.
 * - P2, limit precision: at most one case without a limit label is read as `limit`, because a false
 *   limit inflates the outcome directly.
 * - P3, three-way agreement (limit / check-side, which is check-defect or under-specified /
 *   wall-ended) on at least 65 of every 68 cases, rounded up, which beats the 64 of 68 a rule
 *   reading only the domain gets.
 * - P4: every case the truth flags as breaking that domain rule is right on the three-way reading.
 * - P5: at most three cases read `unclassified`.
 *
 * `unclassified`, and a case the labels miss, count as misses everywhere. The truth file is JSON lines
 * `{"caseKey","caseId","label","stratum","domainRuleBreaker"?}`; the bar is scored over the
 * `primary` stratum, and again over `primary` plus `added` when a case was added to the scored set
 * after the bar froze, and M2 rules only if both readings pass. Every other stratum is reported.
 *
 *   bun m2-calibrate.ts --truth <abs truth.jsonl> --labels <abs labels.jsonl> [--json]
 */
import { type CommandArgs, runCommand } from "../../main/cli.ts";
import { readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { FAIL_LABELS, type FailLabel, parseLabels } from "./climb-outcome.ts";

export interface TruthRow {
  caseKey: string;
  caseId: string;
  label: FailLabel;
  stratum: "primary" | "added" | "contested" | "no-output" | "no-answer";
  /** The three-way class a domain-only rule gets wrong for this case, where it does. */
  domainRuleBreaker?: ThreeWay;
}

type ThreeWay = "limit" | "check-side" | "wall-ended" | "unclassified";

const BAR = { p3Hits: 65, p3Of: 68, falseLimits: 1, unclassified: 3 } as const;
/** z for a two-sided 95% interval. */
const Z = 1.959_963_985;

const USAGE = `usage: m2-calibrate.ts --truth <abs truth.jsonl> --labels <abs labels.jsonl> [--json]

Prints P1–P5 over the primary cases (and over primary plus added cases when any exist), the
confusion table, per-class agreement with Wilson intervals, and the other strata.`;

export function threeWay(label: FailLabel): ThreeWay {
  return label === "check-defect" || label === "under-specified" ? "check-side" : label;
}

/** The Wilson score interval for `hits` of `n`, as [low, high]. */
export function wilson(hits: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const p = hits / n;
  const centre = p + (Z * Z) / (2 * n);
  const spread = Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n));
  const scale = 1 + (Z * Z) / n;
  return [(centre - spread) / scale, (centre + spread) / scale];
}

/** P1–P5 over `rows`, each case's label read from `labels` (a missing one is `unclassified`). */
export function scoreBar(rows: readonly TruthRow[], labels: ReadonlyMap<string, FailLabel>) {
  const read = (row: TruthRow): FailLabel => labels.get(row.caseKey) ?? "unclassified";
  const limits = rows.filter((row) => row.label === "limit");
  const recalled = limits.filter((row) => read(row) === "limit").length;
  const falseLimits = rows.filter((row) => row.label !== "limit" && read(row) === "limit");
  const agreeing = rows.filter((row) => threeWay(read(row)) === threeWay(row.label)).length;
  const needed = Math.ceil((rows.length * BAR.p3Hits) / BAR.p3Of);
  const breakers = rows.filter((row) => row.domainRuleBreaker !== undefined);
  const brokenRight = breakers.filter((row) => threeWay(read(row)) === row.domainRuleBreaker).length;
  const unclassified = rows.filter((row) => read(row) === "unclassified").length;
  const bar = {
    P1: { pass: recalled === limits.length, value: `${recalled}/${limits.length}` },
    P2: {
      pass: falseLimits.length <= BAR.falseLimits,
      value: `${falseLimits.length} (at most ${BAR.falseLimits})`,
    },
    P3: { pass: agreeing >= needed, value: `${agreeing}/${rows.length} (at least ${needed})` },
    P4: { pass: brokenRight === breakers.length, value: `${brokenRight}/${breakers.length}` },
    P5: { pass: unclassified <= BAR.unclassified, value: `${unclassified} (at most ${BAR.unclassified})` },
  };
  const misses = rows.flatMap((row) =>
    threeWay(read(row)) === threeWay(row.label)
      ? []
      : [{ caseId: row.caseId, truth: row.label, read: read(row) }],
  );
  return { cases: rows.length, pass: Object.values(bar).every((part) => part.pass), bar, misses };
}

/** Counts of truth label (rows) against read label (columns), with each truth class's four-way
 *  agreement and its interval. */
export function confusion(rows: readonly TruthRow[], labels: ReadonlyMap<string, FailLabel>) {
  const read = (row: TruthRow): FailLabel => labels.get(row.caseKey) ?? "unclassified";
  return FAIL_LABELS.flatMap((truth) => {
    const ofClass = rows.filter((row) => row.label === truth);
    if (ofClass.length === 0) return [];
    const cells = Object.fromEntries(
      FAIL_LABELS.map((label) => [label, ofClass.filter((row) => read(row) === label).length]),
    );
    const hits = cells[truth] ?? 0;
    return [
      {
        truth,
        n: ofClass.length,
        cells,
        agreement: hits / ofClass.length,
        wilson95: wilson(hits, ofClass.length),
      },
    ];
  });
}

export function parseTruth(text: string): TruthRow[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => parseJsonAs<TruthRow>(line));
}

function render(report: ReturnType<typeof calibrate>): string {
  const lines: string[] = [];
  for (const [name, result] of report.bars) {
    lines.push(`${name} (${result.cases} cases): ${result.pass ? "PASS" : "FAIL"}`);
    for (const [part, value] of Object.entries(result.bar)) {
      lines.push(`  ${part} ${value.pass ? "pass" : "FAIL"} ${value.value}`);
    }
    for (const miss of result.misses) {
      lines.push(`  miss ${miss.caseId}: truth ${miss.truth}, read ${miss.read}`);
    }
  }
  lines.push("", `truth \\ read\t${FAIL_LABELS.join("\t")}\tagreement (95% Wilson)`);
  for (const row of report.confusion) {
    const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
    const interval = `${pct(row.wilson95[0])}–${pct(row.wilson95[1])}`;
    lines.push(
      `${row.truth}\t${FAIL_LABELS.map((label) => row.cells[label]).join("\t")}\t${pct(row.agreement)} (${interval})`,
    );
  }
  for (const [stratum, rows] of Object.entries(report.reported)) {
    lines.push("", `${stratum}: ${rows.map((row) => `${row.caseId} ${row.truth}→${row.read}`).join("; ")}`);
  }
  return lines.join("\n");
}

export function calibrate(truth: readonly TruthRow[], labels: ReadonlyMap<string, FailLabel>) {
  const primary = truth.filter((row) => row.stratum === "primary");
  const added = truth.filter((row) => row.stratum === "added");
  const bars = new Map([["primary", scoreBar(primary, labels)]]);
  if (added.length > 0) bars.set("primary+added", scoreBar([...primary, ...added], labels));
  const reported = Object.groupBy(
    truth.flatMap((row) =>
      row.stratum === "primary" || row.stratum === "added"
        ? []
        : [
            {
              stratum: row.stratum,
              caseId: row.caseId,
              truth: row.label,
              read: labels.get(row.caseKey) ?? "unlabelled",
            },
          ],
    ),
    (row) => row.stratum,
  );
  return {
    rules: [...bars.values()].every((bar) => bar.pass),
    bars,
    confusion: confusion([...primary, ...added], labels),
    reported,
  };
}

function main(args: CommandArgs): number {
  const truth = parseTruth(readFileSync(args.required("truth"), "utf8"));
  const labels = parseLabels(readFileSync(args.required("labels"), "utf8"));
  const report = calibrate(truth, labels);
  console.log(args.flag("json") ? capturedJsonStringify(report, null, 2) : render(report));
  return report.rules ? 0 : 1;
}

if (import.meta.main) {
  await runCommand(
    { name: "m2-calibrate.ts", usage: USAGE, options: { truth: "abs", labels: "abs", json: "flag" } },
    main,
  );
}
