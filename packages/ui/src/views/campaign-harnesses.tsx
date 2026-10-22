import type { KeyboardEvent } from "react";
import { Badge, Button, HashValue } from "../components/primitives.tsx";
import { detailsOf, type Of, useHarness } from "../live.ts";
import type { CampaignReading, HarnessCard } from "../models.ts";
import type { Navigation, PaneProps } from "../route.ts";
import { short } from "../../../../src/campaign/move.ts";
import {
  AGENT_DIR,
  GENERATED_TOOLS_FILE,
  GUIDE_FILE,
  TOOL_TREE_DIR,
  TOOLS_SPEC_FILE,
} from "../../../../src/meta/bundle-layout.ts";
import { digestText, STARTER_NAME, tallyText } from "./campaign-data.ts";
import { AnswerIssues } from "./drill.tsx";
import { time } from "./format.ts";
import { useHeld } from "./held.ts";

/*
 * The lineage strip (the brief of 11 October, section 6): every harness version in the order kept,
 * starter first, at one size in one row that scrolls sideways when it outgrows the page. The card
 * the route names is marked, and its detail stands in one panel under the row at the row's width:
 * who made it, its parent, its practice and the comparisons it was the new harness of. Every card
 * keeps its closed height, with no scaling, no perspective and no motion, since the strip is read
 * and not browsed; a card that opened inside the row made the row as tall as its detail and left
 * empty space under the others. Each card's figure names its own comparison, so two cards' tallies
 * never stand as if measured together.
 *
 * The route names a card by its digest, or the starter by `starter`, which holds before any
 * comparison has named the starter's digest. Left and right move the selection and replace the
 * history entry, so that walking the strip with the keys leaves one entry for the back button; a
 * click pushes one. The key that moves the selection moves focus with it, in its own handler; the
 * selected card brings itself into the strip's view through its ref as it becomes selected, which
 * a poll that keeps the selection does not repeat.
 */

const KEYS = { ArrowLeft: -1, ArrowRight: 1 } as const;

/** A harness's parts as `HARNESS.md` names them, each by its paths; a file of none is `Other`. A
 *  Builder gives the solver its tools as programs under `.toolchain/` or as tools in
 *  `agent/tools.ts`; on 19 October 0 of 193 kept harnesses declared one in `tools.ts`, so a flat
 *  list of paths read as a guide and an empty tool file. A program stands with its own account of
 *  itself, the comment at its head (`server/harness.ts`). */
const PARTS: readonly (readonly [string, (path: string) => boolean])[] = [
  ["Guide", (path) => path === `${AGENT_DIR}${GUIDE_FILE}`],
  ["Tools", (path) => path === TOOLS_SPEC_FILE || path === GENERATED_TOOLS_FILE],
  ["Programs", (path) => path.startsWith(`${TOOL_TREE_DIR}/`)],
];
const OTHER = "Other";
const STARTER = "starter";
const PANEL_ID = "ana-harness-panel";
type Names = CampaignReading["names"];

/** How the route names a card. */
const routeName = (card: HarnessCard): string => (card.starter ? STARTER : (card.digest ?? STARTER));

/** The selected card scrolled into its strip's view, sideways only: the page never moves for it. */
function revealInStrip(button: HTMLButtonElement | null): void {
  const item = button?.parentElement;
  const strip = item?.parentElement;
  if (item === null || item === undefined || strip === null || strip === undefined) return;
  const end = item.offsetLeft + item.offsetWidth - strip.clientWidth;
  if (item.offsetLeft < strip.scrollLeft) strip.scrollLeft = item.offsetLeft;
  else if (end > strip.scrollLeft) strip.scrollLeft = end;
}

/** The card shown as selected: the route's, else the latest, else the last. */
function selectedIndex(cards: readonly HarnessCard[], harness: string | null): number {
  const named = cards.findIndex(
    (card) => (harness === STARTER && card.starter) || (card.digest !== null && card.digest === harness),
  );
  if (named >= 0) return named;
  const latest = cards.findIndex((card) => card.latest);
  return latest >= 0 ? latest : cards.length - 1;
}

function partOf(path: string): string {
  return PARTS.find(([, holds]) => holds(path))?.[0] ?? OTHER;
}

/** The kept files of the selected harness, each opening the inspector, and what the server
 *  could not read of them. The previous card's files stay, closed to the pointer, while the next
 *  card's are read (`held.ts`). */
function Files({ of, digest, navigation }: { of: Of; digest: string; navigation: Navigation }) {
  const files = useHarness(of, digest);
  const { view, stale, slow } = useHeld(digest, files.current ? files.data : null);
  if (files.error !== null) return <span className="ana-harness-note">{files.error}</span>;
  return (
    <div className="ana-harness-files" aria-busy={stale} inert={stale}>
      {slow ? <span className="ana-harness-note">Reading its files</span> : null}
      {view === null ? null : <AnswerIssues answer={view} />}
      {[...PARTS.map(([part]) => part), OTHER].map((part) => {
        const held = (view?.files ?? []).filter(({ path }) => partOf(path) === part);
        return held.length === 0 ? null : (
          <section key={part} className="ana-harness-part" aria-label={part}>
            <small>{part}</small>
            {held.map(({ path, about }) => (
              <div key={path} className="ana-harness-entry">
                <button
                  type="button"
                  className="ana-evidence-link"
                  onClick={() => navigation.push({ harness: digest, file: path, diff: null, event: null })}
                >
                  {path}
                </button>
                {about === null ? null : <p className="ana-harness-about">{about}</p>}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** The selected card's detail, in the panel under the row. */
function Detail({
  card,
  names,
  of,
  navigation,
}: {
  card: HarnessCard;
  names: Names;
  of: Of;
  navigation: Navigation;
}) {
  const madeBy = card.starter
    ? "pi's coding agent as released"
    : card.imported
      ? "imported"
      : `Builder session ${card.session ?? "not recorded"}`;
  const { digest, parent } = card;
  return (
    <div className="ana-harness-detail" id={PANEL_ID} aria-label="The selected harness">
      <dl className="ana-harness-facts">
        <div>
          <dt>Digest</dt>
          <dd>
            {digest === null ? "named at the first comparison" : <HashValue value={digest} length={12} />}
          </dd>
        </div>
        <div>
          <dt>Made by</dt>
          <dd>{madeBy}</dd>
        </div>
        {card.starter ? null : (
          <div>
            <dt>Parent</dt>
            <dd>{parent === null ? "none recorded" : digestText(parent, names)}</dd>
          </div>
        )}
        {card.at === null ? null : (
          <div>
            <dt>Kept</dt>
            <dd>{time(card.at)}</dd>
          </div>
        )}
        <div>
          <dt>Practice</dt>
          <dd className="ana-num">
            {card.practice.solves === 0
              ? "no practice solve"
              : `${String(card.practice.passed)} of ${String(card.practice.solves)} valid`}
          </dd>
        </div>
        {card.broken === null ? null : (
          <div>
            <dt>Opens</dt>
            <dd>no: {card.broken}</dd>
          </div>
        )}
      </dl>
      {card.comparedIn.length === 0 ? null : (
        <ul className="ana-harness-comparisons" aria-label="Comparisons it was the new harness of">
          {card.comparedIn.map((each) => (
            <li key={each.id}>
              <button
                type="button"
                className="ana-evidence-link"
                onClick={() => navigation.push({ pane: "moves", move: each.move })}
              >
                {each.id}
              </button>
              <span className="ana-num">{tallyText(each.tally)}</span>
              <span>{each.reading ?? "no reading"}</span>
              <span className="ana-harness-against">against {digestText(each.against, names)}</span>
            </li>
          ))}
        </ul>
      )}
      {digest === null ? null : (
        <div className="ana-harness-actions">
          {parent === null ? null : (
            <Button
              onClick={() => navigation.push({ harness: digest, diff: parent, file: null, event: null })}
            >
              Compare with previous
            </Button>
          )}
          <Files of={of} digest={digest} navigation={navigation} />
        </div>
      )}
    </div>
  );
}

/** One card's closed face: its name, the letter the log gives it with its digest's head beneath,
 *  its roles, and the tally of the last comparison it was in. */
function Face({ card, names }: { card: HarnessCard; names: Names }) {
  const last = card.comparedIn.at(-1);
  const letter = card.digest === null ? undefined : names[card.digest];
  const name = card.starter ? STARTER_NAME : (letter ?? short(card.digest ?? ""));
  const uncompared = card.starter ? "the first reference" : `kept ${time(card.at)}`;
  const roles = [
    card.reference ? (
      <Badge key="reference" tone="info">
        reference
      </Badge>
    ) : null,
    card.latest ? <Badge key="latest">latest</Badge> : null,
    card.imported ? <Badge key="imported">imported</Badge> : null,
    card.broken === null ? null : (
      <Badge key="broken" tone="bad">
        does not open
      </Badge>
    ),
  ];
  return (
    <>
      <span
        className={letter === undefined && !card.starter ? "ana-harness-name is-digest" : "ana-harness-name"}
      >
        {name}
        {card.digest === null || (letter === undefined && !card.starter) ? null : (
          <span className="ana-harness-hash">{short(card.digest)}</span>
        )}
      </span>
      <span className="ana-harness-roles">{roles}</span>
      <span className="ana-harness-figure ana-num">
        {last === undefined ? "not compared" : `${tallyText(last.tally)} ${last.reading ?? ""}`}
      </span>
      <span className="ana-harness-caption">
        {last === undefined ? uncompared : `in ${last.id}, against ${digestText(last.against, names)}`}
      </span>
    </>
  );
}

export function HarnessStrip({ reading, navigation }: PaneProps) {
  const cards = reading.harnesses;
  const selected = selectedIndex(cards, navigation.route.harness);
  const chosen = cards[selected];
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const step = event.key === "ArrowLeft" || event.key === "ArrowRight" ? KEYS[event.key] : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = cards[selected + step];
    if (next === undefined) return;
    event.currentTarget.children[selected + step]?.querySelector("button")?.focus();
    navigation.replace({ harness: routeName(next), file: null, diff: null, event: null });
  };
  return (
    <div className="ana-harness-lineage">
      <ul
        className="ana-harness-strip"
        aria-label="Harness versions; left and right move the selection"
        onKeyDown={onKeyDown}
      >
        {cards.map((card, at) => {
          const isSelected = at === selected;
          return (
            <li key={routeName(card)} className={isSelected ? "ana-harness is-selected" : "ana-harness"}>
              <button
                type="button"
                ref={isSelected ? revealInStrip : undefined}
                className="ana-harness-select"
                aria-current={isSelected ? "true" : undefined}
                aria-controls={PANEL_ID}
                tabIndex={isSelected ? 0 : -1}
                onClick={() =>
                  navigation.push({ harness: routeName(card), file: null, diff: null, event: null })
                }
              >
                <Face card={card} names={reading.names} />
              </button>
            </li>
          );
        })}
      </ul>
      {chosen === undefined ? null : (
        <Detail card={chosen} names={reading.names} of={detailsOf(reading)} navigation={navigation} />
      )}
    </div>
  );
}
