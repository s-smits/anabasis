import { Badge, NoSignal } from "../components/primitives.tsx";
import { type Column, Table } from "../components/table.tsx";
import type { CampaignReading, Move, Promotion } from "../models.ts";
import { harnessLabel, type Toned } from "./drill.tsx";
import { duration, money, time } from "./format.ts";
import { plural } from "../../../../src/meta/text.ts";

/*
 * Every move of a campaign in the order it started, one row each, with what it handed over in the
 * handover's own fields (`Handover`, `src/campaign/handover.ts`): what it is, how it stands, what it
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
  ["examiner", "Examiner sessions"],
  ["builder", "Builder sessions"],
  ["comparison", "Comparisons"],
]);
/** Why a move was made, in words, by the code of the table's row that named it (`ROWS`,
 *  `src/campaign/decide.ts`), or of who chose it: a Builder that leads its campaign asked for it,
 *  or it is that Builder's conversation. Until 30 October the list printed "row" and the code, a
 *  name only the table's source explains; the code stays in the row's title. */
const ROW_WORD = new Map([
  ["stop", "the operator stopped it"],
  ["exam", "the exam does not stand"],
  ["bound", "a bound is spent"],
  ["tasks", "the tasks are not set up"],
  ["unfinished", "a comparison goes on"],
  ["step", "a step promotes"],
  ["no-room", "no room left to gain"],
  ["short", "too few tasks to compare"],
  ["unread", "a harness no comparison read"],
  ["build", "room to gain"],
  ["practice", "practice is owed"],
  ["unshown", "the last session had nothing to work on"],
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

/** The session endings that broke off. Until 30 October every ending but `finished` read as a
 *  warning, so an Examiner session that `supplied` its tasks, its ordinary end, read as a fault. */
const BROKE: ReadonlySet<string> = new Set(["crashed", "killed"]);

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
    return { label: move.ended, tone: BROKE.has(move.ended) ? "warn" : "neutral", detail: turns };
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

/** The list of moves, sorted, searched and narrowed by kind and standing (`Table`). A move is named
 *  by its place in the log, since a round's Builder session and comparison share an id. A
 *  promotion stands before the first move that started after it, in the list as recorded only:
 *  a sorted or narrowed one has lost the order that places it. */
export function MovesList({
  reading,
  onOpen,
}: {
  reading: CampaignReading;
  onOpen: (index: number) => void;
}) {
  const { moves, promotions } = reading;
  if (moves.length === 0) {
    return <NoSignal title="No move yet">The log holds no session and no comparison</NoSignal>;
  }
  const columns: readonly Column<Move>[] = [
    {
      id: "move",
      head: "Move",
      sort: (move) => move.index,
      choice: (move) => move.step,
      chooser: "Kind",
      words: (step) => FILTER_LABELS.get(step) ?? step,
      cell: (move) => (
        <>
          <button
            type="button"
            className="ana-row-select"
            data-row={move.index}
            onClick={() => onOpen(move.index)}
          >
            {move.id}
          </button>
          <small
            className="ana-cell-note"
            title={move.named === null ? undefined : `${move.named.code}: ${move.named.why}`}
          >
            {kindOf(move, reading)}
            {move.named === null ? "" : ` · ${ROW_WORD.get(move.named.code) ?? `row ${move.named.code}`}`}
          </small>
        </>
      ),
    },
    {
      id: "stands",
      head: "Result",
      sort: (move) => standingOf(move).label,
      choice: (move) => standingOf(move).label,
      chooser: "Result",
      cell: (move) => {
        const standing = standingOf(move);
        return (
          <>
            <Badge tone={standing.tone}>{standing.label}</Badge>
            <small className="ana-cell-note">{standing.detail}</small>
          </>
        );
      },
    },
    {
      id: "handed",
      head: "Handed over",
      className: "ana-move-handover",
      cell: (move) => handedOver(move, reading),
    },
    {
      id: "cost",
      head: "Cost",
      numeric: true,
      sort: (move) => move.billed,
      cell: (move) => money(move.billed),
    },
    {
      id: "ran",
      head: "Ran",
      numeric: true,
      sort: (move) => (move.endedAt === null ? null : Date.parse(move.endedAt) - Date.parse(move.startedAt)),
      cell: (move) => duration(move.startedAt, move.endedAt),
    },
    {
      id: "started",
      head: "Started",
      numeric: true,
      sort: (move) => move.index,
      cell: (move) => time(move.startedAt),
    },
  ];
  const promotionsBetween = (from: number, to: number) =>
    promotions
      .filter((promotion) => promotion.index > from && promotion.index < to)
      .map((promotion) => (
        <PromotionRow key={`p${String(promotion.index)}`} promotion={promotion} reading={reading} />
      ));
  return (
    <div className="ana-dense">
      <Table
        label="moves"
        rows={moves}
        columns={columns}
        rowKey={(move) => String(move.index)}
        search={(move) => `${move.id} ${kindOf(move, reading)} ${handedOver(move, reading)}`}
        placeholder="Search moves by id, kind or harness"
        between={(move, previous) => promotionsBetween(previous?.index ?? -1, move.index)}
        after={promotionsBetween(moves.at(-1)?.index ?? -1, Infinity)}
      />
    </div>
  );
}
