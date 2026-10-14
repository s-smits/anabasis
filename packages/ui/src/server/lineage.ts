/**
 * The harnesses of a campaign as the page lays them out: the promotions between the bars, every
 * harness version from the starter to the latest, and the dollars billed as the moves ended.
 *
 * A promotion is where an epoch begins (`epochsOf`): the harness promoted and the place of its
 * event. What the operator saw before it is `comparedAs` over the log up to that place, which is
 * what `tools/d2/promote.ts` showed and recorded. Its divider stands after the last comparison that
 * began before it, in the chart's order (`barsIn`), so that a comparison cut before its report
 * stands on the side of the divider it ran on. A harness version is one a Builder session left
 * (`campaignOf`), one its conversation froze for a comparison (`build.checkpoint`), or one the
 * operator imported. Until 14 October the strip left the frozen ones out, so a harness compared
 * twice and promoted inside one conversation had no card, and the cards' captions named it by a
 * digest no card held; its practice record is its practice solves
 * (`practiceRan`); its comparisons are the bars it was the new harness of.
 */
import { billedAll, comparedAs } from "../../../../src/kernel/reports.ts";
import { passed } from "../../../../src/kernel/solves.ts";
import { isString } from "../../../../src/meta/json-shape.ts";
import type { HarnessCard, Promotion, SpendPoint } from "../models.ts";
import { campaignIn, epochsIn, indexIn, type Log, once, practiceIn, ranIn } from "./folds.ts";
import { barsIn, endOf, movesIn, starterIn } from "./moves.ts";

/** A harness kept by a session or by the operator's import, where its record ends. */
interface Kept {
  readonly digest: string;
  readonly parent: string | null;
  readonly session: string | null;
  readonly at: string | null;
  readonly index: number;
  readonly imported: boolean;
  /** Frozen by its session's conversation for a comparison, before the session ended. */
  readonly frozen: boolean;
}

/** Every promotion, oldest first: a divider between the bars. */
export const promotionsIn = once((log): Promotion[] => {
  const { events } = log;
  const starter = starterIn(log);
  const bars = barsIn(log);
  return epochsIn(log)
    .slice(1)
    .map(({ reference: harness, from: index }) => {
      // The reference before it and the operator's reason are fields of the event alone, which no
      // fold reads.
      const data = events[index]?.data ?? {};
      return {
        harness,
        from: isString(data.from) ? data.from : null,
        rests: comparedAs(events.slice(0, index), harness),
        despite: isString(data.despite) ? data.despite : null,
        toStarter: harness === starter,
        at: events[index]?.at ?? "",
        index,
        afterComparison: bars.findLast((bar) => bar.move < index)?.id ?? null,
      };
    });
});

/** The harnesses kept, in the order kept, each once. Derived: a Builder session's from its
 *  handover; a frozen one from `build.checkpoint` and an imported one from `harness.imported`,
 *  which no fold reads. */
function keptIn(log: Log): Kept[] {
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
            imported: false,
            frozen: false,
          },
        ]
      : [],
  );
  const imported = events.flatMap(({ kind, data, at }, index): Kept[] =>
    kind === "harness.imported" && isString(data.harness)
      ? [{ digest: data.harness, parent: null, session: null, at, index, imported: true, frozen: false }]
      : [],
  );
  const frozen = events.flatMap(({ kind, data, at }, index): Kept[] => {
    if (kind !== "build.checkpoint" || !isString(data.harness) || !isString(data.session)) return [];
    const parent = sessions.find((move) => move.id === data.session)?.parent ?? null;
    return [
      { digest: data.harness, parent, session: data.session, at, index, imported: false, frozen: true },
    ];
  });
  const first = new Map<string, Kept>();
  for (const each of [...built, ...frozen, ...imported].toSorted((one, other) => one.index - other.index)) {
    if (!first.has(each.digest)) first.set(each.digest, each);
  }
  return [...first.values()];
}

/** The lineage strip: the starter, then every harness kept, in the order kept. */
export const harnessesIn = once((log): HarnessCard[] => {
  const campaign = campaignIn(log);
  const starter = starterIn(log);
  const reference = campaign.reference ?? starter;
  const practice = practiceIn(log);
  const builds = indexIn(log).builds;
  const bars = barsIn(log);
  const card = (kept: Kept | null, digest: string | null): HarnessCard => {
    const practised = ranIn(log).filter(
      (solve) => practice.has(solve.id) && solve.under.harness === digest && passed(solve) !== null,
    );
    const broken =
      kept?.session == null || kept.frozen
        ? undefined
        : builds.find((build) => build.session === kept.session);
    return {
      digest,
      parent: kept?.parent ?? null,
      session: kept?.session ?? null,
      at: kept?.at ?? null,
      starter: kept === null,
      reference: digest === null ? campaign.reference === null : digest === reference,
      latest: digest !== null && digest === campaign.latest,
      imported: kept?.imported === true,
      broken: isString(broken?.finished?.broken) ? broken.finished.broken : null,
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
    ...keptIn(log).flatMap((kept) => (kept.digest === starter ? [] : [card(kept, kept.digest)])),
  ];
});

/** The dollars billed by the end of each move, in the order the moves ended. Derived: `billedAll`
 *  over the log up to the place each move's record ends (`endOf`). */
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
