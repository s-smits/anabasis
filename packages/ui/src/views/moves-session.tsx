import { ExamSide } from "../components/exam-side.tsx";
import { Section } from "../components/layout.tsx";
import { Badge, Button, Card, HashValue } from "../components/primitives.tsx";
import { Trace } from "../components/trace.tsx";
import type { ReactNode } from "react";
import type { CampaignReading, SessionDetail } from "../models.ts";
import type { Navigation } from "../route.ts";
import { detailsOf } from "../live.ts";
import { AnswerIssues, DetailHead, enter, harnessLabel } from "./drill.tsx";
import { duration, money, time } from "./format.ts";
import { HarnessFiles } from "./inspector.tsx";
import { standingOf } from "./moves-list.tsx";
import { SolveTable } from "./solve-rows.tsx";

/*
 * One Builder or Examiner session: what it handed over, the harness a Builder session left with the
 * way to its files and its diff, its practice solves, and its own turns and calls. An Examiner
 * session's turns are the exam side's (the brief of 11 October, section 8): it reads the checks
 * through `try_answer`, so the default tier says where they are instead.
 */

const NO_AWAITING: ReadonlySet<string> = new Set();
/** The one fact in prose, which takes half the row: in a sixth it ran to eleven lines (operator,
 *  30 October). */
const WIDE = "Table row";

/** The handover's fields, as facts in a row. */
function factsOf(detail: SessionDetail, reading: CampaignReading): (readonly [string, ReactNode])[] {
  const { move } = detail;
  const common = [
    ["Turns", String(move.turns)],
    ["Last wrote", time(move.last)],
    [WIDE, move.named === null ? "not recorded" : `${move.named.code} · ${move.named.why}`],
  ] as const;
  if (move.step === "examiner") {
    return [
      ["Proposed", String(move.proposed)],
      ["Held out", String(move.held)],
      ["Refused", String(move.refused)],
      ...common,
    ];
  }
  const harness = (digest: string | null) =>
    digest !== null && digest in reading.names ? (
      harnessLabel(reading, digest)
    ) : (
      <HashValue value={digest} length={8} />
    );
  const left = move.changed ? harness(move.harness) : "the harness as it was";
  return [
    ["Parent", harness(move.parent)],
    ["Left", move.ended === null ? "nothing yet" : left],
    ["Practice solves", String(move.practiceSolves)],
    ["Failed", String(move.fails)],
    ...common,
  ];
}

export function SessionDetailView({
  detail,
  reading,
  navigation,
}: {
  detail: SessionDetail;
  reading: CampaignReading;
  navigation: Navigation;
}) {
  const { move } = detail;
  const standing = standingOf(move);
  const kind = move.step === "builder" ? "Builder session" : "Examiner session";
  const left = move.step === "builder" && move.changed ? move.harness : null;
  const parent = move.step === "builder" ? move.parent : null;
  return (
    <div className="ana-detail">
      <DetailHead
        navigation={navigation}
        back={{ move: null }}
        backLabel="Back to moves"
        title={move.id}
        kind={kind}
        badges={<Badge tone={standing.tone}>{standing.label}</Badge>}
      >
        started {time(move.startedAt)} · ran {duration(move.startedAt, move.endedAt)} · {money(move.billed)}
      </DetailHead>
      <AnswerIssues answer={detail} />
      <dl className="ana-facts ana-facts--row">
        {factsOf(detail, reading).map(([label, value]) => (
          <div key={label} className={label === WIDE ? "is-wide" : undefined}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {left === null ? null : (
        <Section
          title="The harness it left"
          aside={
            parent === null ? null : (
              <Button
                onClick={() => navigation.push({ harness: left, diff: parent, file: null, event: null })}
              >
                Compare with {harnessLabel(reading, parent)}
              </Button>
            )
          }
        >
          <Card>
            <HarnessFiles
              of={detailsOf(reading)}
              digest={left}
              current={navigation.route.file}
              navigation={navigation}
            />
          </Card>
        </Section>
      )}
      {move.step === "builder" ? (
        <Section title={`Practice solves (${String(detail.solves.length)})`}>
          {detail.solves.length === 0 ? (
            <p className="ana-faint">No practice solve on record</p>
          ) : (
            <SolveTable
              rows={detail.solves}
              reading={reading}
              tier={detail.tier}
              awaiting={NO_AWAITING}
              show={["task"]}
              onOpen={(id) => enter(navigation, { solve: id })}
            />
          )}
        </Section>
      ) : null}
      <Section
        title={
          detail.turns === undefined
            ? "Turns and calls"
            : `Turns and calls · ${String(detail.turns.length)} turns`
        }
      >
        {detail.turns === undefined ? (
          <ExamSide what="an Examiner session's turns and calls" />
        ) : (
          <Trace turns={detail.turns} calls={detail.calls ?? []} />
        )}
      </Section>
    </div>
  );
}
