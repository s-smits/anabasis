import { useState } from "react";
import { Section } from "../components/layout.tsx";
import { detailsOf, type Live, useMove, useSolve } from "../live.ts";
import type { CampaignReading, MoveDetail } from "../models.ts";
import type { Navigation, PaneProps } from "../route.ts";
import { enter, Pending, useDrill } from "./drill.tsx";
import { useWaited } from "../waited.ts";
import { ComparisonDetailView } from "./moves-comparison.tsx";
import { MovesList } from "./moves-list.tsx";
import { SessionDetailView } from "./moves-session.tsx";
import { SolveAnswerView } from "./solve.tsx";

/*
 * The Moves pane: every Examiner session, Builder session and comparison in order (`moves-list.tsx`); a
 * row opens its detail in place through the route's `move`, and a solve in it through `solve`. Each
 * level hides the one above rather than pushing it down and stays mounted, so going back finds its
 * filters and focus. The pane reads the move and solve itself, so the level shown changes only once the
 * asked one has its answer, and only past the patience (`late.ts`) does it say it is read.
 */

type Level = 0 | 1 | 2;

function levelOf(move: number | null, solve: string | null): Level {
  if (solve !== null) return 2;
  return move === null ? 0 : 1;
}

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
  const late = useWaited(arrived ? null : `${String(move)} ${solve ?? ""}`);
  // The level shown last, kept as state adjusted during render: what stays while the next is read.
  const [before, setBefore] = useState<Level | null>(null);
  const kept = before === null || before >= asked ? asked : before;
  // A solve opened by its link alone has no move to keep on screen.
  const shown = arrived || late || (kept === 1 && move === null) ? asked : kept;
  if (shown !== before) setBefore(shown);
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
      {outer.marker}
      {inner.marker}
    </Section>
  );
}
