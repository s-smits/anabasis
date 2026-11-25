/**
 * Every answer a check refused, one row a rejected solve: where it was asked for, its side and
 * harness, the checks that refused it, the Referee's last ruling and the probes it cited, a person's
 * label, and what stands of it. With `--solve` it prints that one rejection's finding and probe rows.
 *
 *   bun tools/wri/rejections.ts <log | campaign folder | name> [--solve <id>]
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { type LogEvent, read, TRACE_KINDS } from "#src/kernel/log.ts";
import {
  checkerVerdict,
  examinerSessions,
  labelsIn,
  rejected,
  rejectionAside,
  solvesIn,
} from "#src/kernel/solves.ts";
import { blockingOf, spelled } from "#src/kernel/verify.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { countBy } from "#src/meta/tally.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import {
  type Index,
  indexOf,
  items,
  refusals,
  type Solve,
  strings,
  tally,
  text,
  unprobedEarned,
} from "./folds.ts";

export type Asked = "scored" | "examiner" | "practice";

const USAGE = "usage: bun tools/wri/rejections.ts <log | campaign folder | name> [--solve <id>]";
const NOT_RECORDED = "not recorded";

const said = (value: JsonValue | undefined, fallback: string): string => (isString(value) ? value : fallback);
const shown = (value: JsonValue | undefined): string =>
  value === undefined ? NOT_RECORDED : capturedJsonStringify(value);

/** Who asked for each solve. A comparison's solve in an older log names none in its start, so a
 *  solve a comparison counted (`Compared.scoring`) is scored whatever its start names. */
export function askedOf(log: Index): (solve: Solve) => Asked {
  const examiner = examinerSessions(log.events);
  const counted = new Set(log.compared.flatMap(({ scoring }) => scoring.map(({ id }) => id)));
  return (solve) => {
    if (counted.has(solve.id)) return "scored";
    if (solve.comparison === null) return "practice";
    return examiner.has(solve.comparison) ? "examiner" : "scored";
  };
}

export function sideOf(log: Index): (solve: Solve) => string {
  const sides = new Map<string, JsonObject>(log.compared.map(({ session, own }) => [session, own]));
  for (const data of log.of("comparison.started")) if (isString(data.session)) sides.set(data.session, data);
  const comparisonOf = new Map(
    log.compared.flatMap(({ session, scoring }) => scoring.map(({ id }) => [id, session] as const)),
  );
  return (solve) => {
    const own = sides.get(comparisonOf.get(solve.id) ?? solve.comparison ?? "");
    if (own === undefined) return "-";
    if (solve.harness === own.fresh) return "new";
    return solve.harness === own.old ? "reference" : "other";
  };
}

function probesOf(finding: JsonObject | undefined): string {
  if (finding === undefined) return "-";
  const cited = new Set(items(finding.probes).filter(isNumber));
  if (!Array.isArray(finding.probeRows)) return `${String(cited.size)}/${NOT_RECORDED}`;
  const moved = items(finding.probeRows).filter((row) => {
    const probe = asRecord(row);
    return isNumber(probe?.id) && cited.has(probe.id) && items(probe.moved).length > 0;
  }).length;
  return `${String(cited.size)}/${String(moved)}`;
}

export function rejectionRows(events: readonly LogEvent[]): string[] {
  const log = indexOf(events);
  const [asked, side, labels] = [askedOf(log), sideOf(log), labelsIn(events)];
  const kernel = new Map(solvesIn(events).map((solve) => [solve.id, solve] as const));
  const rows = log.solves.filter((solve) => rejected(kernel.get(solve.id)?.ending));
  const ending = new Set(rows.map(({ id }) => id));
  const lines = rows.map((solve) => {
    const finding = log.rulings.get(solve.id);
    const ruling = finding === undefined ? "unread" : said(finding.ruling, "no ruling");
    const stands = log.stands.get(solve.id) ?? "unread";
    const scored = asked(solve) === "scored";
    const own = kernel.get(solve.id);
    const answer = own !== undefined && rejectionAside(events, own) ? "yes" : "no";
    const aside = scored && own !== undefined ? answer : "-";
    const blocking = blockingOf(log.verdicts.get(solve.id)?.checker);
    return [
      solve.id,
      log.verdicts.get(solve.id)?.task ?? solve.version.slice(0, 8),
      asked(solve),
      solve.comparison ?? "-",
      scored ? side(solve) : "-",
      solve.harness.slice(0, 8),
      blocking.length === 0 ? "no check named" : blocking.join(","),
      ruling,
      probesOf(finding),
      labels.get(solve.id) ?? "-",
      stands,
      aside,
      ...(finding !== undefined && unprobedEarned(finding) ? ["earned, no probe cited"] : []),
    ].join("  ");
  });
  const byAsked = Map.groupBy(rows, asked);
  const totals = (["scored", "examiner", "practice"] as const).map((each) => {
    const of = byAsked.get(each) ?? [];
    const stood =
      each === "scored" ? ` (${tally(countBy(of, (solve) => log.stands.get(solve.id) ?? "unread"))})` : "";
    return `${each} ${String(of.length)}${stood}`;
  });
  const otherwise = refusals(log).filter((solve) => !ending.has(solve.id));
  return [
    `rejections: one row a solve whose ending is a rejection, ${String(rows.length)} of ${String(log.solves.length)} solves`,
    "solve  task  asked  comparison  side  harness  blocking  ruling  probes cited/moved  label  stands  aside",
    ...lines,
    `totals: ${totals.join(", ")}; labelled ${String(rows.filter((solve) => labels.has(solve.id)).length)}`,
    `refused verdicts on solves that ended otherwise, no rejection: ${String(otherwise.length)}${otherwise.length === 0 ? "" : ` (${tally(countBy(otherwise, (solve) => solve.kind ?? solve.outcome ?? "no ending"))})`}`,
  ];
}

function verdictText(value: JsonValue | undefined): string {
  const record = asRecord(value);
  const verdict = record === null ? null : checkerVerdict(record);
  return verdict === null ? NOT_RECORDED : spelled(verdict);
}

function probeLines(events: readonly LogEvent[], wanted: string): string[] {
  const log = indexOf(events);
  const solve = log.solves.find(({ id }) => id === wanted || id.endsWith(`-${wanted}`));
  if (solve === undefined) return [`no solve ${wanted} in the log`];
  const finding = log.rulings.get(solve.id);
  const head = `${solve.id}: blocking ${blockingOf(log.verdicts.get(solve.id)?.checker).join(",") || "none"}; stands ${log.stands.get(solve.id) ?? "unread"}`;
  if (finding === undefined) return [head, "no referee.finding for this solve"];
  const cited = new Set(items(finding.probes).filter(isNumber));
  const rows = Array.isArray(finding.probeRows)
    ? items(finding.probeRows).flatMap((row) => {
        const probe = asRecord(row);
        if (probe === null) return [];
        const changes = items(probe.changes).map((change) => {
          const { path, value, edit } = asRecord(change) ?? {};
          const how = asRecord(edit);
          return how === null
            ? `    ${text(path)} = ${said(value, "null")}`
            : `    ${text(path)} edited: ${String(text(how.find).length)} characters rewritten as ${String(text(how.replace).length)}`;
        });
        const sizes = items(probe.texts).map((size) => {
          const { path, was, now } = asRecord(size) ?? {};
          return `    ${text(path)}: was ${shown(was)}, now ${shown(now)}`;
        });
        return [
          `  probe ${shown(probe.id)}${isNumber(probe.id) && cited.has(probe.id) ? " (cited)" : ""}: original ${verdictText(probe.original)}; changed ${verdictText(probe.changed)}; moved ${strings(probe.moved).join(",") || "none"}`,
          ...changes,
          ...sizes,
        ];
      })
    : [`  probe rows ${NOT_RECORDED}: the finding predates them`];
  return [
    head,
    `ruling ${said(finding.ruling, "none")}; check ${said(finding.check, "-")}; rule ${said(finding.rule, "-")}; field ${said(finding.field, "-")}; replay ${verdictText(finding.replay)}; walled ${shown(finding.walled)}; turns ${shown(finding.turns)}`,
    `reason: ${said(finding.reason, NOT_RECORDED)}`,
    `probes cited: ${[...cited].join(",") || "none"}`,
    ...rows,
  ];
}

async function main(args: CommandArgs): Promise<number> {
  const named = args.positionals[0] ?? args.required("log");
  const events = read(await logAcross(named, "record"), TRACE_KINDS);
  const solve = args.value("solve");
  console.log((solve === null ? rejectionRows(events) : probeLines(events, solve)).join("\n"));
  return 0;
}

if (import.meta.main) {
  await runCommand(
    { name: "rejections", usage: USAGE, options: { log: "text", solve: "text" }, positionals: [0, 1] },
    main,
  );
}
