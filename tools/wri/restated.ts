/**
 * Groups a log's Referee rationales by embedding cosine similarity (`SAME_COMPLAINT`) to surface
 * recurring check complaints and rulings that went two ways:
 *
 *   bun tools/wri/restated.ts <log> [--store <dir>]
 *
 * Where `REFUSALS BY CHECK` tallies rulings by check name alone, this names groups of at least
 * `NAMED_FROM` and any group ruled two ways. A diagnostic lead only; it prints counts, rulings and
 * check names, never the rationale text.
 */
import { read, TRACE_KINDS } from "#src/kernel/log.ts";
import { blockingOf } from "#src/kernel/verify.ts";
import { countBy } from "#src/meta/tally.ts";
import { type EmbedWays, groupsOf, runVectorReader, vectorLines } from "./embed.ts";
import { indexOf, text } from "./folds.ts";

const SAME_COMPLAINT = 0.93;
/** Two can be chance wording; a pair ruled two ways is named whatever its size. */
const NAMED_FROM = 3;
const NAMED_CHECKS = 2;

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

function rowOf(ruled: readonly Ruled[]): string {
  const tasks = new Set(ruled.map(({ task }) => task)).size;
  const head = twoWays(ruled) ? "ruled two ways" : "restated";
  const rulings = Object.entries(countBy(ruled, ({ ruling }) => ruling))
    .toSorted(([one], [other]) => one.localeCompare(other))
    .map(([ruling, n]) => `${ruling} ${String(n)}`)
    .join(", ");
  return `${head}: ${String(ruled.length)} rulings on ${String(tasks)} tasks, ${rulings}; ${checksIn(ruled)}`;
}

async function restatedOf(log: string, ways: EmbedWays): Promise<string[]> {
  const index = indexOf(read(log, TRACE_KINDS));
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
