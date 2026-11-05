/**
 * Which of a log's Referee reasons say one thing, for an investigator who would otherwise read each:
 *
 *   bun tools/wri/restated.ts <log> [--store <dir>]
 *
 * `REFUSALS BY CHECK` counts rulings under a check's name, and nothing says whether they are one
 * complaint. v1's `reviewSlot` (`5bc9988`, `classifier/run-narrative.ts`) grouped restated defects at
 * cosine 0.93, a line it set on 1,264 pairs of 54 claims, where it caught six restated defects and
 * admitted 12 pairs. Changed from v1: it read a reviewer's claims, a seat v2 does not have, so this
 * reads the Referee's reasons, and it prints groups instead of a slot in a narrative.
 *
 * Over 32 recorded logs with at least 10 rulings (1,889 rulings), two rulings under one check got one
 * ruling in 1,703 of 1,722 pairs inside a group and 17,746 of 22,289 pairs across groups, and a group
 * stood higher in 14 of 14 logs that could say. So a group reads as one complaint, and the 13 of 134
 * groups ruled two ways, in 7 of the 32 logs, are where the Referee may have differed with itself: that
 * is the row to read first. Of 56 groups of three or more, 41 held several tasks under one check, 11
 * spanned checks, and 12 of 91 checks held two such groups, which a tally by check cannot say. The share
 * of a log's rulings in such a group ran from 0 to 0.95 (median 0.14). A ruling is a model's output
 * (`AGENTS.md`, section 9), so this is a lead and decides nothing. It counts rulings and names checks,
 * and prints no reason.
 */
import { type LogEvent, read } from "#src/kernel/log.ts";
import { SEATS, traceKind } from "#src/kernel/trace.ts";
import { blockingOf } from "#src/kernel/verify.ts";
import { countBy } from "#src/meta/tally.ts";
import { type EmbedWays, groupsOf, runVectorReader, vectorLines } from "./embed.ts";
import { indexOf, text } from "./folds.ts";

/** v1's line, kept for the reason above. */
const SAME_COMPLAINT = 0.93;
/** Two can be chance wording, and a pair ruled two ways is named whatever its size. */
const NAMED_FROM = 3;
const NAMED_CHECKS = 2;
const NO_TRACES: ReadonlySet<LogEvent["kind"]> = new Set(
  SEATS.flatMap((seat) => [traceKind(seat, "call"), traceKind(seat, "turn")]),
);

interface Ruled {
  readonly words: string;
  readonly ruling: string;
  readonly task: string;
  readonly checks: readonly string[];
}

function checksIn(ruled: readonly Ruled[]): string {
  const names = [...new Set(ruled.flatMap(({ checks }) => checks))].toSorted();
  if (names.length === 0) return "no check named";
  const past = names.length - NAMED_CHECKS;
  return `check ${names.slice(0, NAMED_CHECKS).join(", ")}${past > 0 ? ` and ${String(past)} more` : ""}`;
}

const twoWays = (ruled: readonly Ruled[]) => new Set(ruled.map(({ ruling }) => ruling)).size > 1;

/** One group's row, with its size and rulings before its checks, as a look cuts a line (`short`). */
function rowOf(ruled: readonly Ruled[]): string {
  const tasks = new Set(ruled.map(({ task }) => task)).size;
  const head = twoWays(ruled) ? "ruled two ways" : "restated";
  const rulings = Object.entries(countBy(ruled, ({ ruling }) => ruling))
    .toSorted(([one], [other]) => one.localeCompare(other))
    .map(([ruling, n]) => `${ruling} ${String(n)}`)
    .join(", ");
  return `${head}: ${String(ruled.length)} rulings on ${String(tasks)} tasks, ${rulings}; ${checksIn(ruled)}`;
}

/** One read of `log`: a head line and the groups worth naming, or one line where there is nothing. */
export async function restatedOf(log: string, ways: EmbedWays): Promise<string[]> {
  const index = indexOf(read(log, NO_TRACES));
  const said = [...index.rulings].flatMap(([solve, data]): Ruled[] => {
    const words = text(data.reason).trim();
    return words === ""
      ? []
      : [
          {
            words,
            ruling: text(data.ruling),
            task: text(data.task),
            checks: blockingOf(index.verdicts.get(solve)?.checker),
          },
        ];
  });
  if (said.length === 0) return ["restated: no ruling on record holds a reason"];
  const { vectorOf, embedded, unkept, stopped } = await vectorLines(
    "restated",
    log,
    said.map(({ words }) => words),
    ways,
  );
  if (stopped !== null) return [stopped];
  const roots = groupsOf(
    said.map(({ words }) => vectorOf(words)),
    SAME_COMPLAINT,
  );
  const groups = [...Map.groupBy(said, (_, at) => roots[at]).values()];
  const named = groups
    .filter((ruled) => ruled.length >= NAMED_FROM || twoWays(ruled))
    .toSorted((one, other) => Number(twoWays(other)) - Number(twoWays(one)) || other.length - one.length);
  const large = groups.filter((ruled) => ruled.length >= NAMED_FROM).flat().length;
  return [
    `restated: ${String(said.length)} rulings in ${String(groups.length)} groups at ${String(SAME_COMPLAINT)}; ${String(large)} in a group of ${String(NAMED_FROM)} or more; ${String(groups.filter(twoWays).length)} groups ruled two ways; embedded ${String(embedded)} this read`,
    ...unkept,
    ...named.map(rowOf),
  ];
}

if (import.meta.main) await runVectorReader("restated", restatedOf);
