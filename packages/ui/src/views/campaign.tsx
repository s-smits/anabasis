import { type KeyboardEvent, type ReactNode, useCallback } from "react";
import { type ScheduledAction, short } from "../../../../src/campaign/move.ts";
import { plural } from "../../../../src/meta/text.ts";
import { ComparisonsChart } from "../components/charts/comparisons.tsx";
import { CarriedChart, CarriedKey, SpendChart } from "../components/charts/small.tsx";
import { MetricCard, MetricGrid, Section } from "../components/layout.tsx";
import { Badge, Button, Card, Disclosure, HashValue, NoSignal } from "../components/primitives.tsx";
import { matchesTerms } from "../components/tool-call.tsx";
import { detailsOf, type Of } from "../live.ts";
import type { CampaignReading, HarnessCard, Tone } from "../models.ts";
import { type Navigation, type PaneProps, useKept } from "../route.ts";
import { carriedText, digestText, pText, STARTER_NAME, tallyText } from "./campaign-data.ts";
import { Search } from "./controls.tsx";
import { AnswerIssues } from "./drill.tsx";
import { money, percent, time } from "./format.ts";
import { PART_NAMES, partOf, useHarnessFiles } from "./harness-parts.tsx";

const KEYS = { ArrowLeft: -1, ArrowRight: 1 } as const;
const STARTER = "starter";
const PANEL_ID = "ana-harness-panel";
const SEARCHED_FROM = 12;
type Names = CampaignReading["names"];

const MOVE_WORD = {
  draft: "Draft the exam",
  accept: "Read the exam",
  prepare: "Set tasks apart",
  examine: "Examiner session",
  build: "Builder session",
  compare: "Comparison",
  promote: "Promotion",
  revert: "Revert reference",
  end: "End",
} as const satisfies Record<ScheduledAction["move"], string>;

const HOSTS_OWN: ReadonlySet<ScheduledAction["move"]> = new Set([
  "draft",
  "accept",
  "prepare",
  "revert",
  "end",
]);

const ATTENDED_WAITS = new Map<ScheduledAction["move"], string>([
  ["accept", "; under --hitl the exam is read and its freeze waits for the operator's word"],
  ["promote", "; under --hitl the promotion waits for the operator's word (promote.ts)"],
]);

const READING_TONE = new Map<string, Tone>([
  ["step", "good"],
  ["no-step", "neutral"],
  ["not-scored", "warn"],
  ["check-defects", "bad"],
  ["no-change", "neutral"],
]);

const routeName = (card: HarnessCard): string => (card.by === "starter" ? STARTER : (card.digest ?? STARTER));

function revealInStrip(button: HTMLButtonElement | null): void {
  const item = button?.parentElement;
  const strip = item?.parentElement;
  if (item == null || strip == null) return;
  const end = item.offsetLeft + item.offsetWidth - strip.clientWidth;
  if (item.offsetLeft < strip.scrollLeft) strip.scrollLeft = item.offsetLeft;
  else if (end > strip.scrollLeft) strip.scrollLeft = end;
}

function selectedIndex(cards: readonly HarnessCard[], harness: string | null): number {
  const named = cards.findIndex(
    (card) =>
      (harness === STARTER && card.by === "starter") || (card.digest !== null && card.digest === harness),
  );
  if (named !== -1) return named;
  const latest = cards.findIndex((card) => card.latest);
  return latest === -1 ? cards.length - 1 : latest;
}

function Files({ of, digest, navigation }: { of: Of; digest: string; navigation: Navigation }) {
  const { files, view, stale, slow, listed, toggle } = useHarnessFiles(of, digest);
  const [query, setQuery] = useKept("harness-files.search", "");
  if (files.error !== null) return <span className="ana-harness-note">{files.error}</span>;
  const shown = listed.filter(({ path, about }) => matchesTerms(`${path} ${about ?? ""}`, query));
  return (
    <div className="ana-harness-files" aria-busy={stale} inert={stale}>
      {slow ? <span className="ana-harness-note">Reading its files</span> : null}
      {view === null ? null : <AnswerIssues answer={view} />}
      {listed.length > SEARCHED_FROM ? (
        <Search value={query} onChange={setQuery} placeholder={`Search ${plural(listed.length, "file")}`} />
      ) : null}
      {shown.length === 0 && query !== "" ? <span className="ana-harness-note">No file matches</span> : null}
      <div className="ana-harness-file-list">
        {PART_NAMES.map((part) => {
          const held = shown.filter(({ path }) => partOf(path) === part);
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
      {toggle}
    </div>
  );
}

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
  const madeBy =
    card.by === "starter"
      ? "pi's coding agent as released"
      : card.by === "imported"
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
        {card.by === "starter" ? null : (
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

function Face({ card, names }: { card: HarnessCard; names: Names }) {
  const last = card.comparedIn.at(-1);
  const letter = card.digest === null ? undefined : names[card.digest];
  const name = card.by === "starter" ? STARTER_NAME : (letter ?? short(card.digest ?? ""));
  const uncompared = card.by === "starter" ? "the first reference" : `kept ${time(card.at)}`;
  const roles = [
    card.reference ? (
      <Badge key="reference" tone="info">
        reference
      </Badge>
    ) : null,
    card.latest ? <Badge key="latest">latest</Badge> : null,
    card.by === "imported" ? <Badge key="imported">imported</Badge> : null,
    card.broken === null ? null : (
      <Badge key="broken" tone="bad">
        does not open
      </Badge>
    ),
  ];
  return (
    <>
      <span
        className={
          letter === undefined && card.by !== "starter" ? "ana-harness-name is-digest" : "ana-harness-name"
        }
      >
        {name}
        {card.digest === null || (letter === undefined && card.by !== "starter") ? null : (
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

function HarnessStrip({ reading, navigation, beside }: PaneProps & { readonly beside: ReactNode }) {
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
      <div className="ana-harness-row">
        {chosen === undefined ? null : (
          <div className="ana-harness-slot">
            <Detail card={chosen} names={reading.names} of={detailsOf(reading)} navigation={navigation} />
          </div>
        )}
        {beside}
      </div>
    </div>
  );
}

function Head({ reading }: { reading: CampaignReading }) {
  const { row } = reading;
  const status = row.ending === null ? row.status : `ended: ${row.ending.ending}`;
  const tone: Tone =
    row.status === "running" ? "info" : row.ending?.ending === "environment" ? "bad" : "neutral";
  return (
    <header className="ana-run-head ana-campaign-head">
      <div className="ana-campaign-title">
        <h1>{row.name}</h1>
      </div>
      <div className="ana-campaign-status">
        <Badge tone={tone}>{status}</Badge>
        {row.status === "running" ? null : (
          <span className="ana-num">last wrote {time(row.lastEventAt)}</span>
        )}
        <span className="ana-num">
          {money(row.billed)}
          {row.budget === null ? " billed" : ` of ${money(row.budget)}`}
        </span>
      </div>
    </header>
  );
}

function reasonOf(line: string) {
  const cut = line.indexOf("; ");
  if (cut === -1) return line;
  return <Disclosure title={line.slice(0, cut)}>{line.slice(cut + 2)}</Disclosure>;
}

function Readouts({ reading }: { reading: CampaignReading }) {
  const { row, promotions, nextMove } = reading;
  const last = promotions.at(-1);
  const lastWay = last?.toStarter === true ? ", the last back to the starter" : ", the last despite the rule";
  const promoted =
    last === undefined
      ? "no promotion yet"
      : `${plural(promotions.length, "promotion")}, ${String(promotions.filter((each) => each.confirmed).length)} confirmed against the starter${last.despite === null && !last.toStarter ? "" : lastWay}`;
  const lastReading = row.lastReading;
  const lastBar = reading.comparisons.find((bar) => bar.id === lastReading?.id);
  const beside = lastBar?.carried == null ? "" : `; won on ${carriedText(lastBar.carried.won)}`;
  const ended = row.ending;
  const advised = nextMove !== null && !HOSTS_OWN.has(nextMove.move);
  const open =
    reading.open.length === 0 ? "" : `, on the log as it stands with ${reading.open.join(", ")} open`;
  return (
    <MetricGrid>
      <MetricCard
        label="Reference harness"
        value={
          reading.reference === null ? (
            "Starter"
          ) : (
            <code className="ana-campaign-digest">{digestText(reading.reference, reading.names)}</code>
          )
        }
        detail={promoted}
        tone={promotions.length > 0 ? "info" : "neutral"}
      />
      <MetricCard
        label="Last reading"
        value={lastReading === null ? "None" : tallyText(lastReading.tally)}
        detail={
          lastReading === null
            ? "no comparison has reported"
            : `${lastReading.reading} in ${lastReading.id}, won–lost–tied, ${pText(lastBar?.p ?? null)}${beside}`
        }
        tone={lastReading === null ? "neutral" : (READING_TONE.get(lastReading.reading) ?? "neutral")}
      />
      {ended === null ? (
        <MetricCard
          label={advised ? "Table advises" : "Next move"}
          value={
            nextMove === null ? (
              "Not known"
            ) : (
              <span title={`${nextMove.code} · ${nextMove.line}`}>{MOVE_WORD[nextMove.move]}</span>
            )
          }
          detail={
            nextMove === null
              ? "the decision table could not be asked"
              : reasonOf(
                  `${nextMove.why}${open}${reading.attended ? (ATTENDED_WAITS.get(nextMove.move) ?? "") : ""}${advised ? "; the Builder leads this campaign and may make another move" : ""}`,
                )
          }
          tone={nextMove?.move === "end" ? "warn" : "neutral"}
        />
      ) : (
        <MetricCard
          label="Ending"
          value={ended.ending}
          detail={ended.why ?? "its reason is the error that ended it, which the default tier leaves out"}
          tone="warn"
        />
      )}
    </MetricGrid>
  );
}

function NoComparison({ reading }: { reading: CampaignReading }) {
  const { supply } = reading;
  const target = reading.target === null ? "" : ` A comparison scores ${String(reading.target)}.`;
  const waiting = supply.awaiting === 0 ? "" : `, ${String(supply.awaiting)} waiting for a label`;
  const doubted = supply.doubted === 0 ? "" : `, ${String(supply.doubted)} doubted`;
  return (
    <NoSignal title="No comparison yet">
      {`${plural(supply.held, "held-out task")} can be scored, ${String(supply.released)} released for practice${waiting}${doubted}.${target}`}
    </NoSignal>
  );
}

function SetUp({ reading }: { reading: CampaignReading }) {
  const { prompt, supply, seats, terms, attended } = reading;
  const checker =
    supply.faults === null
      ? "checker never read"
      : `checker read, ${plural(supply.faults, "fault")}, ${supply.frozen ? "frozen" : "not frozen"}`;
  const seated = (["builder", "examiner", "reviewer", "solver"] as const).flatMap((seat) => {
    const sat = seats[seat];
    return sat === null ? [] : [[seat, `${sat.model} at ${sat.effort}`] as const];
  });
  return (
    <Disclosure title="Set-up">
      {prompt === null ? null : <p className="ana-campaign-prompt">{prompt}</p>}
      <p className="ana-campaign-setup">
        {`${String(supply.held)} held out on the frontier · ${String(supply.released)} released for practice · ${String(supply.awaiting)} wait for a label · ${String(supply.doubted)} doubted, out of the draw · ${String(supply.exhausted)} exhausted, scored as retained · ${checker}`}
      </p>
      <dl className="ana-facts ana-facts--row">
        {seated.map(([seat, said]) => (
          <div key={seat}>
            <dt>{seat}</dt>
            <dd>{said}</dd>
          </div>
        ))}
        {Object.entries(terms).map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd className="ana-num">{value}</dd>
          </div>
        ))}
        {attended ? (
          <div>
            <dt>attended</dt>
            <dd>the freeze and a promotion wait for the operator's word</dd>
          </div>
        ) : null}
      </dl>
    </Disclosure>
  );
}

function rateSource(risk: NonNullable<CampaignReading["counters"]["risk"]>): string {
  const controls =
    risk.controls === 0
      ? "no A/A control with enough untied tasks to read a step"
      : `${String(risk.errors)} of ${plural(risk.controls, "A/A control")} with enough untied tasks to read a step read one`;
  const incapable =
    risk.incapable === 0 ? "" : `, and ${String(risk.incapable)} too small to read one at their level`;
  return `${controls}${incapable}`;
}

function Counters({ reading }: { reading: CampaignReading }) {
  const { withoutGain, patience, labels, controls, controlSteps, risk, runway } = reading.counters;
  const { promotions, row } = reading;
  const affords =
    runway === null || runway.each <= 0 ? null : Math.floor(Math.max(0, runway.left) / runway.each);
  return (
    <p className="ana-campaign-counters">
      <span>
        Moves without a gain{" "}
        <b className="ana-num">
          {withoutGain} of {patience}
        </b>
      </span>
      <span>
        Waiting for a label: tasks <b className="ana-num">{labels.tasks}</b>, rejections set aside in
        unsettled comparisons <b className="ana-num">{labels.rejections}</b>
      </span>
      <span>
        A/A controls <b className="ana-num">{controls}</b>
        {controls === 0 ? "" : `, ${String(controlSteps)} read a step`}
      </span>
      {risk === null || risk.attempts === 0 ? null : (
        <span title={rateSource(risk)}>
          False promotion under this reference estimated at <b className="ana-num">{percent(risk.union)}</b>{" "}
          over {plural(risk.attempts, "attempt")}
        </span>
      )}
      {promotions.length === 0 ? null : (
        <span title="Everything billed so far over the promotions made: how fast the reference moves for its price">
          Billed a promotion <b className="ana-num">{money(row.billed / promotions.length)}</b>
        </span>
      )}
      {runway === null || affords === null ? null : (
        <span
          title={`${money(runway.left)} left; comparison ${runway.comparison} billed ${money(runway.each)}, which the table prices the next one by`}
        >
          Comparisons left at the last one's price <b className="ana-num">{affords}</b>
        </span>
      )}
    </p>
  );
}

export function CampaignPane({ reading, navigation }: PaneProps) {
  const { push } = navigation;
  const open = useCallback((index: number) => push({ pane: "moves", move: index }), [push]);
  const { comparisons, spend, row } = reading;
  const carried = comparisons.some((bar) => bar.carried !== null);
  return (
    <div className="ana-campaign">
      <Head reading={reading} />
      <Readouts reading={reading} />
      <SetUp reading={reading} />
      <Card className="ana-campaign-chart">
        <div className="ana-section-head">
          <h2>Comparisons</h2>
          <span className="ana-campaign-qualifier">Scored tasks by outcome for the new harness</span>
        </div>
        {comparisons.length === 0 ? (
          <NoComparison reading={reading} />
        ) : (
          <ComparisonsChart
            bars={comparisons}
            promotions={reading.promotions}
            names={reading.names}
            onOpen={open}
          />
        )}
      </Card>
      <Section
        title="Harnesses"
        aside={<span className="ana-campaign-qualifier">{plural(reading.harnesses.length, "version")}</span>}
      >
        <HarnessStrip
          reading={reading}
          navigation={navigation}
          beside={
            carried || spend.length > 0 ? (
              <div className="ana-campaign-pair">
                {carried ? (
                  <Card className="ana-campaign-small">
                    <div className="ana-section-head">
                      <h2>Wins by measure</h2>
                      <CarriedKey />
                    </div>
                    <CarriedChart bars={comparisons} />
                  </Card>
                ) : null}
                {spend.length > 0 ? (
                  <Card className="ana-campaign-small">
                    <div className="ana-section-head">
                      <h2>Dollars billed</h2>
                      <span className="ana-campaign-qualifier">
                        {plural(spend.length, "move")}
                        {row.budget === null ? "" : `, budget ${money(row.budget)}`}
                      </span>
                    </div>
                    <SpendChart spend={spend} />
                  </Card>
                ) : null}
              </div>
            ) : null
          }
        />
      </Section>
      <Counters reading={reading} />
    </div>
  );
}
