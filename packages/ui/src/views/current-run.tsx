import type { OutcomeJudgeReport } from "../../../../tools/outcome/judge.ts";
import { RecordView } from "../components/record.js";
import { useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Check, FileJson, X } from "lucide-react";
import type { JudgeEvidence } from "../../../../src/claim/judge.ts";
import type { OutcomeMetrics, OutcomeReport } from "../../../../tools/outcome/metrics.ts";
import { MetricCard, MetricGrid, Section } from "../components/layout.js";
import { Badge, Button, Card, DataTable, Disclosure, HashValue, NoSignal } from "../components/primitives.js";
import type { RunView } from "../models.js";
import { evaluationLabel, money, time } from "./format.js";
import { hasText } from "../../../../src/meta/text.ts";

function rate(battery: OutcomeMetrics): string {
  const { passed, verified } = battery.cases;
  return verified === 0 ? "No score" : `${Math.round((passed / verified) * 100)}%`;
}

function Decisions({ report, runId }: { report: OutcomeReport; runId?: string }) {
  const promotions = report.promotions.filter((row) => runId === undefined || row.runId === runId);
  return (
    <Section title="Harness decisions">
      {promotions.length === 0 ? (
        <NoSignal title="No adoption decision">
          Whether the candidate replaced the harness is unknown.
        </NoSignal>
      ) : (
        <div className="ana-stack">
          {promotions.map((row) => (
            <Card key={row.runId} className="ana-variant-card">
              <div className="ana-section-head">
                <span>{evaluationLabel(row.runId, Object.keys(report.batteries))}</span>
                <Badge tone={row.decision === "promoted" ? "good" : "warn"}>{row.decision}</Badge>
              </div>
              {row.clauses.length === 0 ? (
                <p className="ana-note">No blockers.</p>
              ) : (
                <ul className="ana-clause-list">
                  {row.clauses.map((clause) => (
                    <li key={clause}>{clause}</li>
                  ))}
                </ul>
              )}
              <Disclosure title="Comparison">
                <RecordView value={row} />
              </Disclosure>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}

function Families({ battery }: { battery: OutcomeMetrics }) {
  return (
    <Section title="Results by family">
      <DataTable>
        <thead>
          <tr>
            <th>Family</th>
            <th>Verified pass rate</th>
            <th>Passed / verified</th>
            <th>No accepted answer</th>
            <th>Runtime issues</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(battery.families).map(([family, c]) => (
            <tr key={family}>
              <td>{family}</td>
              <td>
                <div className="ana-family-rate">
                  {c.verified > 0 ? (
                    <meter
                      aria-label={`${family} verified pass rate`}
                      min={0}
                      max={c.verified}
                      value={c.passed}
                    />
                  ) : null}
                  <span>
                    {c.verified === 0 ? "No score" : `${Math.round((c.passed / c.verified) * 100)}%`}
                  </span>
                </div>
              </td>
              <td className="ana-num">
                {c.passed} / {c.verified}
              </td>
              <td className="ana-num">{c.unaccepted}</td>
              <td className="ana-num">{c.nonResults}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Section>
  );
}

function Evaluations({
  report,
  selected,
  onSelect,
}: {
  report: OutcomeReport;
  selected: string;
  onSelect: (runId: string, button: HTMLButtonElement) => void;
}) {
  return (
    <Section title="Evaluation history">
      <DataTable>
        <thead>
          <tr>
            <th>Evaluation</th>
            <th>Verified pass rate</th>
            <th>Passed / verified</th>
            <th>No accepted answer</th>
            <th>Runtime issues</th>
            <th>Task set</th>
            <th>Recorded at</th>
          </tr>
        </thead>
        <tbody>
          {Object.values(report.batteries).map((battery) => (
            <tr key={battery.runId} className={selected === battery.runId ? "is-selected" : ""}>
              <td>
                <button
                  id={`evaluation-${battery.runId}`}
                  className="ana-row-select"
                  type="button"
                  onClick={(event) => onSelect(battery.runId, event.currentTarget)}
                >
                  {evaluationLabel(battery.runId, Object.keys(report.batteries))}
                </button>
              </td>
              <td>{rate(battery)}</td>
              <td>
                {battery.cases.passed} / {battery.cases.verified}
              </td>
              <td>{battery.cases.unaccepted}</td>
              <td>{battery.cases.nonResults.total}</td>
              <td>
                <HashValue value={battery.claim.taskSetHash} length={9} />
              </td>
              <td>{time(battery.claim.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Section>
  );
}

function Conditions({ run, battery }: { run: RunView; battery: OutcomeMetrics | null }) {
  const cost = battery?.telemetry.costUsd;
  return (
    <Section title="Run condition">
      <div className="ana-trust-strip">
        {(run.story.request?.slots ?? []).map((slot) => (
          <Card className="ana-trust" key={slot.slot}>
            <span className="ana-metric-label">
              {slot.slot === "built" ? "Solver" : slot.slot === "builder" ? "Builder" : "Review"}
            </span>
            <strong>{slot.enabled ? (slot.model ?? "Not recorded") : "Disabled"}</strong>
            <small>
              {slot.kind} · {slot.effort ?? "effort not recorded"}
            </small>
          </Card>
        ))}
      </div>
      <Disclosure title="Source and cost">
        <dl className="ana-key-values">
          <div>
            <span>Run ID</span>
            <HashValue value={run.title} length={32} />
          </div>
          <div>
            <span>Source</span>
            <strong>
              <HashValue value={run.sourceIdentity} length={12} />
              {run.story.request?.dirty === true ? " · uncommitted changes" : ""}
            </strong>
          </div>
          <div>
            <span>Task set</span>
            <HashValue value={battery?.claim.taskSetHash} />
          </div>
          <div>
            <span>Solver cost</span>
            <strong>{money(cost?.value ?? null)}</strong>
          </div>
        </dl>
        <p className="ana-note">
          {cost == null
            ? "Cost not reported."
            : `Solver only: ${cost.of} of ${cost.from} usage records report cost; ${battery?.telemetry.recorded} task traces are readable.`}
        </p>
        <RecordView value={battery?.identity} />
      </Disclosure>
    </Section>
  );
}

function ReviewStatus({ review }: { review: OutcomeJudgeReport }) {
  const [open, setOpen] = useState(false);
  // The Judge has no control census, so what a review can show is whether its comparison was complete.
  const status =
    review.available && review.census !== null && "evidence" in review.census
      ? review.census.evidence.decision
      : "unavailable";
  const label = `Judge review: ${status}`;
  return (
    <span
      className="ana-review-status"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="ana-status-trigger"
        aria-label={label}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <span
          className={`ana-status-dot ${status === "advisory-comparison" ? "is-good" : "is-warn"}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <span role="tooltip" className="ana-status-tooltip">
          {label}
        </span>
      ) : null}
    </span>
  );
}

export function ReviewCounts({
  evidence,
}: {
  evidence:
    | Pick<Exclude<JudgeEvidence, { judge: "off" }>, "judge" | "disagreements" | "disagreementDenominator">
    | { judge: "off" }
    | null;
}) {
  const counts = evidence === null || evidence.judge === "off" ? null : evidence;
  const agreements = counts === null ? null : counts.disagreementDenominator - counts.disagreements;
  const disagreements = counts?.disagreements ?? null;
  return (
    <div className="ana-review-counts">
      <span title="Agreements" aria-label={`Agreements: ${agreements ?? "unavailable"}`}>
        <Check size={16} aria-hidden="true" />
        {agreements ?? "—"}
      </span>
      <span title="Disagreements" aria-label={`Disagreements: ${disagreements ?? "unavailable"}`}>
        <X size={16} aria-hidden="true" />
        {disagreements ?? "—"}
      </span>
    </div>
  );
}

function Reviews({ run, runId }: { run: RunView; runId?: string }) {
  const reviews = (run.reviews ?? []).filter((review) => runId === undefined || review.selector === runId);
  if (reviews.length === 0) return null;
  return (
    <Section title="Evaluation review">
      <div className="ana-stack">
        {reviews.map((review) => (
          <Card className="ana-variant-card" key={review.selector}>
            <div className="ana-review-title">
              <span>{evaluationLabel(review.selector, Object.keys(run.outcome?.batteries ?? {}))}</span>
              <ReviewStatus review={review} />
            </div>
            {review.available ? (
              <>
                <ReviewCounts
                  evidence={review.census && "evidence" in review.census ? review.census.evidence : null}
                />
                <Disclosure title="Evidence and coverage">
                  <RecordView value={review} />
                </Disclosure>
              </>
            ) : (
              <>
                <p className="ana-note">Review unavailable.</p>
                <Disclosure title="Reason">
                  <p className="ana-note">{review.reason}</p>
                </Disclosure>
              </>
            )}
          </Card>
        ))}
      </div>
    </Section>
  );
}

export function CurrentRunView({
  run,
  view,
  onOpen,
}: {
  run: RunView;
  view: "overview" | "decision";
  onOpen: (path: string) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const detail = useRef<HTMLDivElement>(null);
  const origin = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (selectedId) {
      detail.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    } else if (hasText(origin.current)) document.getElementById(origin.current)?.focus();
  }, [selectedId]);
  const report = run.outcome;
  if (report === undefined) return null;
  const batteries = Object.values(report.batteries);
  const battery = batteries.find((item) => item.runId === selectedId) ?? batteries.at(-1) ?? null;
  if (view === "overview" && selectedId && battery !== null) {
    return (
      <div className="ana-evaluation-detail" ref={detail} tabIndex={-1} aria-label="Evaluation details">
        <header className="ana-run-head">
          <div className="ana-task-title">
            <Button aria-label="Back to Evals" title="Back to Evals" onClick={() => setSelectedId("")}>
              <ArrowLeft size={18} aria-hidden="true" />
            </Button>
            <h1>{evaluationLabel(battery.runId, Object.keys(report.batteries))}</h1>
          </div>
        </header>
        <MetricGrid>
          <MetricCard
            label="Verified pass rate"
            value={rate(battery)}
            detail={`${battery.cases.passed} / ${battery.cases.verified} passed`}
          />
          <MetricCard label="No accepted answer" value={battery.cases.unaccepted} />
          <MetricCard label="Runtime issues" value={battery.cases.nonResults.total} />
        </MetricGrid>
        <Families battery={battery} />
        <Reviews run={run} runId={battery.runId} />
        <Decisions report={report} runId={battery.runId} />
        <Conditions run={run} battery={battery} />
        <Section>
          <Disclosure title="Evaluation record">
            <RecordView value={battery} />
          </Disclosure>
        </Section>
      </div>
    );
  }
  return (
    <>
      <header className="ana-run-head">
        <div>
          <h1>{view === "overview" ? "Evals" : "Evidence"}</h1>
        </div>
      </header>
      {view === "decision" ? (
        <>
          <Reviews run={run} />
          <Decisions report={report} />
          <Conditions run={run} battery={battery} />
        </>
      ) : (
        <>
          <Evaluations
            report={report}
            selected={battery?.runId ?? ""}
            onSelect={(id, button) => {
              origin.current = button.id;
              setSelectedId(id);
            }}
          />
          {battery === null ? (
            <NoSignal title="No evaluation yet">No measured tasks recorded.</NoSignal>
          ) : (
            <>
              <Families battery={battery} />
            </>
          )}
        </>
      )}
      {run.story.request === null ? null : (
        <Section>
          <Button className="ana-record-action" onClick={() => onOpen(run.story.request!.source)}>
            <FileJson size={15} aria-hidden="true" />
            Open run record
          </Button>
        </Section>
      )}
    </>
  );
}
