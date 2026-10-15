import { Fragment, useState } from "react";
import { Badge, Button, DataTable, NoSignal } from "../components/primitives.tsx";
import { matchesTerms } from "../components/tool-call.tsx";
import type { CampaignReading, Move, Promotion } from "../models.ts";
import { Filters, Search, Select } from "./controls.tsx";
import { harnessLabel, type Toned } from "./drill.tsx";
import { duration, money, time } from "./format.ts";
import { plural } from "../../../../src/meta/text.ts";

/*
 * Every move of a campaign in the order it started, one row each, with what it handed over in the
 * handover's own fields (`Handover`, `src/builder/handover.ts`): what it is, how it stands, what it
 * left, its cost and how long it ran. A promotion is no move, but the reference changes there, so
 * it stands between the rows as a divider, as it does between the Campaign pane's bars.
 */

type Kind = Move["step"];

const KINDS: Readonly<Record<Kind, string>> = {
  examiner: "Examiner session",
  builder: "Builder session",
  comparison: "Comparison",
};
const FILTER_LABELS = new Map([
  ["all", "All moves"],
  ["examiner", "Examiner sessions"],
  ["builder", "Builder sessions"],
  ["comparison", "Comparisons"],
]);
/** A move's table row in the list, where its code says who chose the move and not which row named
 *  it: a Builder that leads its campaign asked for it, or it is that Builder's conversation. */
const ROW_WORD = new Map([
  ["asked", "the Builder asked"],
  ["led", "the Builder leads"],
]);

const READING_TONES = new Map<string, Toned["tone"]>([
  ["step", "info"],
  ["no-step", "neutral"],
  ["not-scored", "warn"],
  ["check-defects", "bad"],
  ["no-change", "neutral"],
]);

/** How a move stands: its ending or reading; cut, where the campaign went past it; or open. */
export function standingOf(move: Move): Toned & { readonly detail: string } {
  if (move.step === "comparison") {
    const solves = `${String(move.solved)} of ${plural(move.begun, "solve")} ended`;
    if (move.reading !== null) {
      return { label: move.reading, tone: READING_TONES.get(move.reading) ?? "neutral", detail: solves };
    }
    return move.cut
      ? { label: "cut", tone: "warn", detail: solves }
      : { label: "open", tone: "info", detail: solves };
  }
  const turns = plural(move.turns, "turn");
  if (move.ended !== null) {
    return { label: move.ended, tone: move.ended === "finished" ? "neutral" : "warn", detail: turns };
  }
  return move.cut
    ? { label: "cut", tone: "warn", detail: turns }
    : { label: "open", tone: "info", detail: `${turns} so far` };
}

/** What a move handed over, in one line. */
function handedOver(move: Move, reading: CampaignReading): string {
  if (move.step === "examiner") {
    return `${String(move.proposed)} proposed · ${String(move.held)} held out · ${String(move.refused)} refused`;
  }
  if (move.step === "builder") {
    const from = `from ${harnessLabel(reading, move.parent)}`;
    if (move.ended === null) return `${from} · ${plural(move.practiceSolves, "practice solve")} so far`;
    const left = move.changed ? `left ${harnessLabel(reading, move.harness)}` : "left the harness as it was";
    return `${from}, ${left} · ${plural(move.practiceSolves, "practice solve")}, ${String(move.fails)} failed`;
  }
  const sides = `${harnessLabel(reading, move.fresh)} against ${harnessLabel(reading, move.old)}`;
  const size = `${plural(move.tasks, "task")} × ${String(move.solves)}`;
  const tally =
    move.tally === null
      ? "no task tallied"
      : `${String(move.tally.wins)} won, ${String(move.tally.losses)} lost, ${String(move.tally.ties)} tied`;
  const aside = move.aside > 0 ? ` · ${String(move.aside)} set aside` : "";
  return `${sides} · ${size} · ${tally}${aside}`;
}

/** The kind of a move as its row names it; a comparison says which of the three it is. */
export function kindOf(move: Move, reading: CampaignReading): string {
  if (move.step !== "comparison") return KINDS[move.step];
  const bar = reading.comparisons.find((each) => each.id === move.id);
  return bar === undefined || bar.kind === "candidate"
    ? KINDS.comparison
    : `${KINDS.comparison}, ${bar.kind}`;
}

function PromotionRow({ promotion, reading }: { promotion: Promotion; reading: CampaignReading }) {
  const rests = promotion.rests.map((each) => each.comparison).join(", ");
  const said = promotion.toStarter
    ? "Returned the reference to the starter"
    : `Promoted ${harnessLabel(reading, promotion.harness)} to reference`;
  return (
    <tr className="ana-move-divider">
      <td colSpan={6}>
        {/* The spaces keep the parts apart for a screen reader and a copy, as the margins do on
            screen: without them the row read "to referenceon b-1, r-1". */}
        <span>{said}</span> {rests === "" ? null : <span>on {rests}</span>}{" "}
        {promotion.despite === null ? null : (
          <Badge tone="warn" title={promotion.despite}>
            despite the rule
          </Badge>
        )}{" "}
        <time>{time(promotion.at)}</time>
      </td>
    </tr>
  );
}

function MoveRow({
  move,
  reading,
  onOpen,
}: {
  move: Move;
  reading: CampaignReading;
  onOpen: (index: number) => void;
}) {
  const standing = standingOf(move);
  return (
    <tr>
      <td>
        <button
          type="button"
          className="ana-row-select"
          data-row={move.index}
          onClick={() => onOpen(move.index)}
        >
          {move.id}
        </button>
        <small className="ana-cell-note" title={move.named?.why}>
          {kindOf(move, reading)}
          {move.named === null ? "" : ` · ${ROW_WORD.get(move.named.code) ?? `row ${move.named.code}`}`}
        </small>
      </td>
      <td>
        <Badge tone={standing.tone}>{standing.label}</Badge>
        <small className="ana-cell-note">{standing.detail}</small>
      </td>
      <td className="ana-move-handover">{handedOver(move, reading)}</td>
      <td className="ana-num">{money(move.billed)}</td>
      <td className="ana-num">{duration(move.startedAt, move.endedAt)}</td>
      <td className="ana-num">{time(move.startedAt)}</td>
    </tr>
  );
}

/** The list of moves, with its two filters. A move is named by its place in the log, since a
 *  round's Builder session and comparison share an id. */
export function MovesList({
  reading,
  onOpen,
}: {
  reading: CampaignReading;
  onOpen: (index: number) => void;
}) {
  const [kind, setKind] = useState<string>("all");
  const [query, setQuery] = useState("");
  const { moves, promotions } = reading;
  if (moves.length === 0) {
    return <NoSignal title="No move yet">The log holds no session and no comparison.</NoSignal>;
  }
  const filtered = kind !== "all" || query.trim() !== "";
  const rows = moves.filter(
    (move) =>
      (kind === "all" || move.step === kind) &&
      matchesTerms(`${move.id} ${kindOf(move, reading)} ${handedOver(move, reading)}`, query),
  );
  // A divider stands before the first move that started after its promotion, and only in the
  // whole list: a filtered one has lost the order that places it.
  const before = (move: Move, at: number) =>
    filtered
      ? []
      : promotions.filter((p) => p.index < move.index && (at === 0 || p.index > (rows[at - 1]?.index ?? -1)));
  const trailing = filtered ? [] : promotions.filter((p) => p.index > (rows.at(-1)?.index ?? -1));
  return (
    <>
      <Filters>
        <Search value={query} onChange={setQuery} placeholder="Search moves by id, kind or harness" />
        <Select
          label="Kind"
          value={kind}
          onChange={setKind}
          values={["all", "examiner", "builder", "comparison"]}
          format={(value) => FILTER_LABELS.get(value) ?? value}
        />
        {filtered ? (
          <Button
            onClick={() => {
              setKind("all");
              setQuery("");
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </Filters>
      {rows.length === 0 ? (
        <NoSignal title="No matching move">Change the search or clear the filters.</NoSignal>
      ) : (
        <div className="ana-dense">
          <DataTable>
            <thead>
              <tr>
                <th>Moves ({rows.length})</th>
                <th>Stands</th>
                <th>Handed over</th>
                <th className="ana-num">Cost</th>
                <th className="ana-num">Ran</th>
                <th className="ana-num">Started</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((move, at) => (
                <Fragment key={move.index}>
                  {before(move, at).map((promotion) => (
                    <PromotionRow
                      key={`p${String(promotion.index)}`}
                      promotion={promotion}
                      reading={reading}
                    />
                  ))}
                  <MoveRow move={move} reading={reading} onOpen={onOpen} />
                </Fragment>
              ))}
              {trailing.map((promotion) => (
                <PromotionRow key={`p${String(promotion.index)}`} promotion={promotion} reading={reading} />
              ))}
            </tbody>
          </DataTable>
        </div>
      )}
    </>
  );
}
