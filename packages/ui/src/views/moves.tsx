import { Section } from "../components/layout.tsx";
import { detailsOf, useMove } from "../live.ts";
import type { CampaignReading } from "../models.ts";
import type { Navigation, PaneProps } from "../route.ts";
import { enter, Pending, useDrill } from "./drill.tsx";
import { ComparisonDetailView } from "./moves-comparison.tsx";
import { MovesList } from "./moves-list.tsx";
import { SessionDetailView } from "./moves-session.tsx";
import { SolveView } from "./solve.tsx";

/*
 * The Moves pane (the brief of 11 October, section 7): every Examiner session, Builder session and
 * comparison in order, one row each (`moves-list.tsx`); a row opens its detail in place through the
 * route's `move`, its place in the log (`moves-session.tsx`, `moves-comparison.tsx`), and a solve in
 * that detail opens
 * through the route's `solve` (`solve.tsx`). Each level hides the one above it rather than pushing
 * it down, and stays mounted while hidden, so that going back finds its filters and its focus where
 * they were.
 */

/** The move the route names, read and shown. */
function MoveView({ reading, navigation }: { reading: CampaignReading; navigation: Navigation }) {
  const { route } = navigation;
  const live = useMove(detailsOf(reading), route.move);
  if (live.data === null || !live.current) {
    const named = reading.moves.find((move) => move.index === route.move)?.id ?? "";
    return <Pending live={live} what={`move ${named}`} />;
  }
  if (live.data.kind === "session") {
    return <SessionDetailView detail={live.data} reading={reading} navigation={navigation} />;
  }
  return <ComparisonDetailView detail={live.data} reading={reading} navigation={navigation} />;
}

export function MovesPane({ reading, navigation }: PaneProps) {
  const { move, solve } = navigation.route;
  // A row is keyed by its move's place, as a solve opened from no move is by its own id.
  const solveKey = solve === null ? null : `solve:${solve}`;
  const outer = useDrill(move === null ? solveKey : String(move));
  const inner = useDrill(solve);
  const named = reading.moves.find((each) => each.index === move)?.id ?? "the move";
  return (
    <Section title="Moves">
      <div ref={outer.list} hidden={move !== null || solve !== null}>
        <MovesList reading={reading} onOpen={(index) => enter(navigation, { move: index })} />
      </div>
      {move === null ? null : (
        <div
          ref={outer.detail}
          className="ana-drill"
          tabIndex={-1}
          aria-label={`Move ${named}`}
          hidden={solve !== null}
        >
          <div ref={inner.list}>
            <MoveView reading={reading} navigation={navigation} />
          </div>
        </div>
      )}
      {solve === null ? null : (
        <div ref={inner.detail} className="ana-drill" tabIndex={-1} aria-label={`Solve ${solve}`}>
          <SolveView
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
