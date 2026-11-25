/**
 * The harnesses of a campaign as the page lays them out: the promotions between the bars, every
 * version from the starter on, and the dollars billed as moves ended. A promotion is where an epoch
 * begins (`epochsOf`); what the operator saw before it is `comparedAs` up to its place, as
 * `tools/d2/promote.ts` showed, and its confirmation is its epoch's (`confirmed`). Its divider
 * stands after the last comparison begun before it (`barsIn`), so a cut comparison stands on the
 * side it ran on. A version is one a Builder session left, one its conversation froze
 * (`build.checkpoint`), or one the operator imported; frozen ones are kept, or a harness compared
 * and promoted inside one conversation would have no card.
 */
import { comparedAs } from "../../../../src/kernel/reports.ts";
import { billedAll } from "../../../../src/kernel/meter.ts";
import { passed } from "../../../../src/kernel/solves.ts";
import { isString } from "../../../../src/meta/json-shape.ts";
import type { HarnessCard, Promotion, SpendPoint } from "../models.ts";
import { campaignIn, epochsIn, type Log, once, practiceIn, ranIn } from "./folds.ts";
import { barsIn, endOf, movesIn, starterIn } from "./moves.ts";

interface Kept {
  readonly digest: string;
  readonly parent: string | null;
  readonly session: string | null;
  readonly at: string | null;
  readonly index: number;
  /** Left by its session's end, frozen by its conversation for a comparison before the session
   *  ended, or imported by the operator. */
  readonly by: "session" | "frozen" | "imported";
}

export const promotionsIn = once((log): Promotion[] => {
  const { events } = log;
  const starter = starterIn(log);
  const bars = barsIn(log);
  return epochsIn(log)
    .slice(1)
    .map(({ reference: harness, from: index, starter_tally: againstStarter, confirmed }) => {
      // The reference before it and the operator's reason are fields of the event alone, which no fold
      // reads.
      const data = events[index]?.data ?? {};
      return {
        harness,
        from: isString(data.from) ? data.from : null,
        rests: comparedAs(events.slice(0, index), harness),
        despite: isString(data.despite) ? data.despite : null,
        toStarter: harness === starter,
        againstStarter,
        confirmed: confirmed === true,
        at: events[index]?.at ?? "",
        index,
        afterComparison: bars.findLast((bar) => bar.move < index)?.id ?? null,
      };
    });
});

/** The harnesses kept, in the order kept, each once: a Builder session's from its handover, a
 *  frozen one from `build.checkpoint` and an imported one from `harness.imported`, which no fold
 *  reads. */
function savedHarnessesIn(log: Log): Kept[] {
  const { events } = log;
  const sessions = movesIn(log).filter((move) => move.step === "builder");
  const built = sessions.flatMap((move): Kept[] =>
    move.step === "builder" && move.changed && move.harness !== null
      ? [
          {
            digest: move.harness,
            parent: move.parent,
            session: move.id,
            at: move.endedAt,
            index: endOf(log, move),
            by: "session",
          },
        ]
      : [],
  );
  const imported = events.flatMap(({ kind, data, at }, index): Kept[] =>
    kind === "harness.imported" && isString(data.harness)
      ? [{ digest: data.harness, parent: null, session: null, at, index, by: "imported" }]
      : [],
  );
  const frozen = events.flatMap(({ kind, data, at }, index): Kept[] => {
    if (kind !== "build.checkpoint" || !isString(data.harness) || !isString(data.session)) return [];
    const parent = sessions.find((move) => move.id === data.session)?.parent ?? null;
    return [{ digest: data.harness, parent, session: data.session, at, index, by: "frozen" }];
  });
  const first = new Map<string, Kept>();
  for (const each of [...built, ...frozen, ...imported].toSorted((one, other) => one.index - other.index)) {
    if (!first.has(each.digest)) first.set(each.digest, each);
  }
  return [...first.values()];
}

export const harnessesIn = once((log): HarnessCard[] => {
  const campaign = campaignIn(log);
  const starter = starterIn(log);
  const reference = campaign.reference ?? starter;
  const practice = practiceIn(log);
  const bars = barsIn(log);
  const card = (kept: Kept | null, digest: string | null): HarnessCard => {
    const practised = ranIn(log).filter(
      (solve) => practice.has(solve.id) && solve.under.harness === digest && passed(solve) !== null,
    );
    const finished =
      kept?.session == null || kept.by === "frozen"
        ? undefined
        : log.events.findLast(({ kind, data }) => kind === "build.finished" && data.session === kept.session)
            ?.data;
    return {
      digest,
      parent: kept?.parent ?? null,
      session: kept?.session ?? null,
      at: kept?.at ?? null,
      by: kept === null ? "starter" : kept.by,
      reference: digest === null ? campaign.reference === null : digest === reference,
      latest: digest !== null && digest === campaign.latest,
      broken: isString(finished?.broken) ? finished.broken : null,
      practice: {
        passed: practised.filter((solve) => passed(solve) === true).length,
        solves: practised.length,
      },
      comparedIn: bars.flatMap((bar) =>
        digest !== null && bar.fresh === digest
          ? [{ id: bar.id, move: bar.move, against: bar.old, tally: bar.tally, reading: bar.reading }]
          : [],
      ),
    };
  };
  return [
    card(null, starter),
    ...savedHarnessesIn(log).flatMap((kept) => (kept.digest === starter ? [] : [card(kept, kept.digest)])),
  ];
});

export const spendIn = once((log): SpendPoint[] => {
  const ended = movesIn(log)
    .map((move) => ({ move: move.id, end: endOf(log, move) }))
    .toSorted((one, other) => one.end - other.end);
  return ended.map(({ move, end }) => ({
    at: log.events[end]?.at ?? "",
    move,
    cumulative: billedAll(log.events.slice(0, end + 1)),
  }));
});
