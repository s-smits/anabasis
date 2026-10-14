import { useState } from "react";
import { Section } from "../components/layout.tsx";
import { detailsOf, type Live, useMove, useSolve } from "../live.ts";
import type { CampaignReading, MoveDetail } from "../models.ts";
import type { Navigation, PaneProps } from "../route.ts";
import { enter, Pending, useDrill } from "./drill.tsx";
import { useLateFor } from "./late.ts";
import { ComparisonDetailView } from "./moves-comparison.tsx";
import { MovesList } from "./moves-list.tsx";
import { SessionDetailView } from "./moves-session.tsx";
import { SolveAnswerView } from "./solve.tsx";

/*
 * The Moves pane (the brief of 11 October, section 7): every Examiner session, Builder session and
 * comparison in order, one row each (`moves-list.tsx`); a row opens its detail in place through the
 * route's `move`, its place in the log (`moves-session.tsx`, `moves-comparison.tsx`), and a solve in
 * that detail opens
 * through the route's `solve` (`solve.tsx`). Each level hides the one above it rather than pushing
 * it down, and stays mounted while hidden, so that going back finds its filters and its focus where
 * they were.
 *
 * The pane reads the move and the solve itself, so that the level shown changes only once the
 * level asked for has its answer: until then the one before stays on screen, and only past the
 * patience (`late.ts`) does the asked level say that it is read. Until 14 October the list hid
 * itself on a click and each opening painted "Reading move" before its detail.
 */

/** The list, a move, or a solve. */
type Level = 0 | 1 | 2;

function levelOf(move: number | null, solve: string | null): Level {
  if (solve !== null) return 2;
  return move === null ? 0 : 1;
}

/** The move the route names, as its answer stands: the previous move's while the next is read and
 *  not yet `late`. */
function MoveView({
  live,
  late,
  reading,
  navigation,
}: {
  live: Live<MoveDetail>;
  late: boolean;
  reading: CampaignReading;
  navigation: Navigation;
}) {
  if (live.data === null || (!live.current && late)) {
    const named = reading.moves.find((move) => move.index === navigation.route.move)?.id ?? "";
    return <Pending live={live} what={`move ${named}`} />;
  }
  if (live.data.kind === "session") {
    return <SessionDetailView detail={live.data} reading={reading} navigation={navigation} />;
  }
  return <ComparisonDetailView detail={live.data} reading={reading} navigation={navigation} />;
}

export function MovesPane({ reading, navigation }: PaneProps) {
  const { move, solve } = navigation.route;
  const of = detailsOf(reading);
  const moveLive = useMove(of, move);
  const solveLive = useSolve(of, solve);
  const asked = levelOf(move, solve);
  const arrived = asked === 0 || (asked === 1 ? moveLive.current : solveLive.current);
  const late = useLateFor(arrived ? null : `${String(move)} ${solve ?? ""}`);
  // The level shown last, kept as state adjusted during render: what stays while the next is read.
  const [before, setBefore] = useState<Level | null>(null);
  const kept = before === null || before >= asked ? asked : before;
  // A solve opened by its link alone has no move to keep on screen.
  const shown = arrived || late || (kept === 1 && move === null) ? asked : kept;
  if (shown !== before) setBefore(shown);
  // A row is keyed by its move's place, as a solve opened from no move is by its own id.
  const solveKey = solve === null ? null : `solve:${solve}`;
  const outer = useDrill(shown === 0 ? null : move === null ? solveKey : String(move));
  const inner = useDrill(shown === 2 ? solve : null);
  const named = reading.moves.find((each) => each.index === move)?.id ?? "the move";
  const busy = arrived ? undefined : true;
  return (
    <Section title="Moves">
      <div ref={outer.list} hidden={shown !== 0} aria-busy={busy}>
        <MovesList reading={reading} onOpen={(index) => enter(navigation, { move: index })} />
      </div>
      {move === null ? null : (
        <div
          ref={outer.detail}
          className="ana-drill"
          tabIndex={-1}
          aria-label={`Move ${named}`}
          aria-busy={busy}
          hidden={shown !== 1}
        >
          <div ref={inner.list}>
            <MoveView live={moveLive} late={late} reading={reading} navigation={navigation} />
          </div>
        </div>
      )}
      {solve === null ? null : (
        <div
          ref={inner.detail}
          className="ana-drill"
          tabIndex={-1}
          aria-label={`Solve ${solve}`}
          aria-busy={busy}
          hidden={shown !== 2}
        >
          <SolveAnswerView
            live={solveLive}
            late={late}
            reading={reading}
            navigation={navigation}
            back={{ solve: null }}
            backLabel={move === null ? "Back to moves" : `Back to ${named}`}
          />
        </div>
      )}
    </Section>
  );
}
