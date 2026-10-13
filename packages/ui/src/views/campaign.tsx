import { useCallback } from "react";
import { type Decided, short } from "../../../../src/builder/move.ts";
import { plural } from "../../../../src/meta/text.ts";
import { ComparisonsChart } from "../components/charts/comparisons.tsx";
import { ShareKey, SpendChart, ValidShareChart } from "../components/charts/small.tsx";
import { MetricCard, MetricGrid, Section } from "../components/layout.tsx";
import { Badge, Card, Disclosure, NoSignal } from "../components/primitives.tsx";
import type { CampaignReading, Tone } from "../models.ts";
import type { PaneProps } from "../route.ts";
import { digestText, pText, tallyText } from "./campaign-data.ts";
import { HarnessStrip } from "./campaign-harnesses.tsx";
import { money, time } from "./format.ts";

/*
 * The Campaign pane, the main page (the brief of 11 October, section 6), top to bottom: the
 * campaign's line, three readouts, the comparisons chart, the harness strip, the two small charts
 * and the counters. Each block has one title and at most one qualifying line; what explains a
 * number is one click away, in the chart's tooltip, a card of the strip or the Moves pane a column
 * opens. The page works with no promotion, which is most campaigns, and before any comparison,
 * where the chart's place says what the campaign holds to compare.
 *
 * What `bun run runs view` prints and the readouts do not stands one click or one line away: the
 * set-up line with the seats and the terms in one collapsed disclosure, the steps open at the log's
 * end in the next move's detail as the view words it, the regression reading beside the counters,
 * and when the log was last written beside the status, since an open campaign that last wrote long
 * ago is probably a process stopped with no ending, which the log cannot say.
 */

const MOVE_WORD = {
  draft: "Draft the exam",
  accept: "Read the exam",
  prepare: "Set tasks apart",
  examine: "Examiner session",
  build: "Builder session",
  compare: "Comparison",
  promote: "Promotion",
  end: "End",
} as const satisfies Record<Decided["move"], string>;

/** What the campaign command does with a move the table names where the opening is attended, which
 *  the table does not read (`tools/d2/harness-builder.ts`). */
const ATTENDED_WAITS = new Map<Decided["move"], string>([
  ["accept", "; under --attended the exam is read and its freeze waits for the operator's word"],
  ["promote", "; under --attended the promotion waits for the operator's word (promote.ts)"],
]);

/** A reading's tone; a reading the page does not know is neutral. */
const READING_TONE = new Map<string, Tone>([
  ["step", "good"],
  ["no-step", "neutral"],
  ["not-scored", "warn"],
  ["check-defects", "bad"],
  ["no-change", "neutral"],
]);

function Head({ reading }: { reading: CampaignReading }) {
  const { row } = reading;
  const status = row.ending === null ? row.status : `ended: ${row.ending.ending}`;
  const tone: Tone =
    row.status === "running" ? "info" : row.ending?.ending === "environment" ? "bad" : "neutral";
  return (
    <header className="ana-run-head ana-campaign-head">
      <div className="ana-campaign-title">
        <p className="ana-eyebrow" title={row.project}>
          {row.project}
        </p>
        <h1>{row.name}</h1>
      </div>
      <div className="ana-campaign-status">
        <Badge tone={tone}>{status}</Badge>
        <span className="ana-num">last wrote {time(row.lastEventAt)}</span>
        <span className="ana-num">
          {money(row.billed)}
          {row.budget === null ? " billed" : ` of ${money(row.budget)}`}
        </span>
      </div>
    </header>
  );
}

function Readouts({ reading }: { reading: CampaignReading }) {
  const { row, promotions, nextMove } = reading;
  const last = promotions.at(-1);
  const lastWay = last?.toStarter === true ? ", the last back to the starter" : ", the last despite the rule";
  const promoted =
    last === undefined
      ? "no promotion yet"
      : `${plural(promotions.length, "promotion")}${last.despite === null && !last.toStarter ? "" : lastWay}`;
  const lastReading = row.lastReading;
  const lastBar = reading.comparisons.find((bar) => bar.id === lastReading?.id);
  const ended = row.ending;
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
            <code className="ana-campaign-digest">{digestText(reading.reference, reading.starter)}</code>
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
            : `${lastReading.reading} in ${lastReading.id}, won–lost–tied, ${pText(lastBar?.p ?? null)}`
        }
        tone={lastReading === null ? "neutral" : (READING_TONE.get(lastReading.reading) ?? "neutral")}
      />
      {ended === null ? (
        <MetricCard
          label="Next move"
          value={
            nextMove === null ? (
              "Not known"
            ) : (
              <span
                title={
                  nextMove.row === undefined
                    ? nextMove.line
                    : `row ${String(nextMove.row)} · ${nextMove.line}`
                }
              >
                {MOVE_WORD[nextMove.move]}
              </span>
            )
          }
          detail={
            nextMove === null
              ? "the decision table could not be asked"
              : `${nextMove.why}${open}${reading.attended ? (ATTENDED_WAITS.get(nextMove.move) ?? "") : ""}`
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

/** What stands in the chart's place before a first comparison: the tasks there are to compare. */
function NoComparison({ reading }: { reading: CampaignReading }) {
  const { supply, terms } = reading;
  const target = terms.target === undefined ? "" : ` A comparison scores ${terms.target}.`;
  const waiting = supply.awaiting === 0 ? "" : `, ${String(supply.awaiting)} waiting for a label`;
  return (
    <NoSignal title="No comparison yet">
      {`${plural(supply.held, "held-out task")} can be scored, ${String(supply.released)} released for practice${waiting}.${target}`}
    </NoSignal>
  );
}

/** The set-up as the view's first line says it, with the prompt the campaign opened from, who sits
 *  in each seat and the terms the opening keeps, one click away. */
function SetUp({ reading }: { reading: CampaignReading }) {
  const { prompt, supply, seats, terms, attended, bars } = reading;
  const points = (share: number) => String(Math.round(100 * share));
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
        {`${String(supply.held)} held out · ${String(supply.released)} released for practice · ${String(supply.awaiting)} wait for a label · ${String(supply.exhausted)} exhausted · ${checker}`}
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
        <div>
          <dt>bars</dt>
          <dd>{`effect ${points(bars.effect)} points · transfer within ${points(bars.transfer)} points · cost ${String(bars.cost)} attempts, gating nothing`}</dd>
        </div>
      </dl>
    </Disclosure>
  );
}

function Counters({ reading }: { reading: CampaignReading }) {
  const { withoutGain, patience, labels, controls, controlSteps } = reading.counters;
  const { regression } = reading;
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
      {regression === null ? null : (
        <span title="A reading beside the test: it decides nothing">
          Regression check {short(regression.newest)} ({regression.comparisons[0]}) against{" "}
          {short(regression.previous)} ({regression.comparisons[1]}) on {plural(regression.shared, "task")}{" "}
          <b className="ana-num">
            {regression.wins}–{regression.losses}–{regression.ties}
          </b>
        </span>
      )}
    </p>
  );
}

export function CampaignPane({ reading, navigation }: PaneProps) {
  const { push } = navigation;
  const open = useCallback((index: number) => push({ pane: "moves", move: index }), [push]);
  const { comparisons, spend, row } = reading;
  const shares = comparisons.some((bar) => bar.valid !== null);
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
            starter={reading.starter}
            onOpen={open}
          />
        )}
      </Card>
      <Section
        title="Harnesses"
        aside={<span className="ana-campaign-qualifier">{plural(reading.harnesses.length, "version")}</span>}
      >
        <HarnessStrip reading={reading} navigation={navigation} />
      </Section>
      {shares || spend.length > 0 ? (
        <div className="ana-campaign-pair">
          {shares ? (
            <Card className="ana-campaign-small">
              <div className="ana-section-head">
                <h2>Valid share</h2>
                <ShareKey />
              </div>
              <ValidShareChart bars={comparisons} />
            </Card>
          ) : null}
          {spend.length > 0 ? (
            <Card className="ana-campaign-small">
              <div className="ana-section-head">
                <h2>Dollars billed</h2>
                <span className="ana-campaign-qualifier">{plural(spend.length, "move")}</span>
              </div>
              <SpendChart spend={spend} budget={row.budget} />
            </Card>
          ) : null}
        </div>
      ) : null}
      <Counters reading={reading} />
    </div>
  );
}
