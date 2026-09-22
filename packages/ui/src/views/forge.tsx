import { runLabel } from "./format.js";
import { useMemo } from "react";
import { MetricCard, MetricGrid } from "../components/layout.js";
import { Badge, Button, Card, Disclosure } from "../components/primitives.js";
import type { RunView } from "../models.js";
import { statusTone } from "../models.js";
import { ImprovementChart } from "./climb.js";
import { climbPoints } from "./climb-data.js";

/** Forge's original hierarchy: hero, three readouts, the climb, then collapsed evidence. */
export function ForgeView({ run, onOpen }: { run: RunView; onOpen: (path: string) => void }) {
  const points = useMemo(() => climbPoints(Object.values(run.outcome?.batteries ?? {})), [run]);
  const latest = points.at(-1);
  const { difficulty } = run.story;
  const model = run.story.request?.slots.find((slot) => slot.slot === "built");
  const undated = Object.values(run.outcome?.batteries ?? {}).filter(
    (b) => b.claim.createdAt === null,
  ).length;
  return (
    <>
      <header className="ana-run-head">
        <div>
          <p className="ana-eyebrow">anabasis · build & improve</p>
          <h1>Forge</h1>
        </div>
        <div className="ana-record-meta">
          <Badge tone={statusTone(run.status)}>{run.status}</Badge>
          <span>{runLabel(run)}</span>
        </div>
      </header>
      {run.status === "failed" || run.status === "blocked" ? (
        <Disclosure title="Run stopped" defaultOpen>
          <p>{run.currentPhase}</p>
        </Disclosure>
      ) : null}
      <MetricGrid>
        <MetricCard
          label="Latest result"
          value={latest === undefined || latest.rate === null ? "—" : `${latest.passed} / ${latest.verified}`}
          detail={
            latest === undefined
              ? "No dated evaluation"
              : `${latest.unaccepted} unaccepted · ${latest.nonResults} non-results`
          }
        />
        <MetricCard
          label="Difficulty"
          value={difficulty?.standing ?? "—"}
          detail={difficulty?.action ?? "No difficulty decision recorded"}
        />
        <MetricCard
          label="Built on"
          value={model?.model ?? "—"}
          detail={model?.kind ?? "No model recorded"}
        />
      </MetricGrid>
      <Card className="ana-forge-climb">
        <div className="ana-section-head">
          <h2>The climb</h2>
          <span className="ana-note">Verified pass rate</span>
        </div>
        <ImprovementChart points={points} />
        <div className="ana-chart-caption">
          <span>
            {points.length} evaluations{undated > 0 ? ` · ${undated} undated in Evals` : ""}
          </span>
          <span>Dashed line: task set changed</span>
        </div>
      </Card>
      {run.status === "complete" ? (
        <Disclosure title="Run ending">
          <p>{run.currentPhase}</p>
        </Disclosure>
      ) : null}
      {difficulty === null ? null : (
        <Disclosure title="Difficulty decision">
          <p>{difficulty.rationale}</p>
          <Button onClick={() => onOpen(difficulty.source)}>Open evidence</Button>
        </Disclosure>
      )}
    </>
  );
}
