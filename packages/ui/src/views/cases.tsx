import { memo, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Callout, Section } from "../components/layout.js";
import { Badge, Button, Card, Code, DataTable, Disclosure, NoSignal } from "../components/primitives.js";
import type { CaseSummary, RunView, Tone, ToolCallSummary } from "../models.js";
import { statusTone } from "../models.js";
import { RecordView } from "../components/record.js";
import { Filters, Search, Select } from "./controls.js";
import { evaluationLabel } from "./format.js";
import { asRecord, isString } from "../../../../src/meta/json-shape.ts";

/** What a null field reads as. A case row shows absence, never a zero it did not measure. */
const UNRECORDED = "not recorded";

type TruthLabel = { label: string; tone: Tone };

/** The preview line for a case whose trace cannot be shown, and why. A drifted trace is withheld
 *  rather than rendered, because its bytes no longer match the hash the run recorded. */
function tracePreview(item: CaseSummary): string {
  if (item.traceState === "recorded") return item.assistantPreview ?? "No assistant preview recorded.";
  if (item.traceState === "trace-drifted") {
    return "Trace hidden: its contents no longer match the recorded hash.";
  }
  if (item.traceState === "trace-missing") return "Trace file missing.";
  return "No trace recorded.";
}

/** Whether a case row belongs under the chosen result filter. `scored` is the condition pass and
 *  fail share: an accepted submission the verifier reached a verdict on. */
function matchesResult(item: CaseSummary, result: string): boolean {
  if (result === "all") return true;
  const scored = item.nonResult === null && item.acceptedSubmit !== false && item.truthOk !== null;
  if (result === "pass") return scored && item.pass === true;
  if (result === "fail") return scored && item.pass === false;
  if (result === "non-result") return item.nonResult !== null;
  if (result === "unaccepted") return item.nonResult === null && item.acceptedSubmit === false;
  return item.truthOk === null && item.nonResult === null && item.acceptedSubmit !== false;
}

function truthLabel(item: CaseSummary): TruthLabel {
  if (item.nonResult !== null) return { label: item.nonResult, tone: "warn" };
  if (item.acceptedSubmit === false) return { label: "unaccepted", tone: "warn" };
  if (item.truthOk === null) {
    return { label: "unverified", tone: "warn" };
  }
  if (item.pass === null) return { label: "pending", tone: "neutral" };
  return item.pass ? { label: "pass", tone: "good" } : { label: "fail", tone: "bad" };
}

function SolverTrace({ item }: { item: CaseSummary }) {
  return (
    <div className="ana-case-grid">
      <div>
        <h3>Solver trace</h3>
        <dl className="ana-key-values">
          <div>
            <span>turns</span>
            <strong>{item.turns ?? UNRECORDED}</strong>
          </div>
          <div>
            <span>tool calls</span>
            <strong>{item.toolCalls ?? UNRECORDED}</strong>
          </div>
          <div>
            <span>submission</span>
            <strong>
              {item.acceptedSubmit === null
                ? UNRECORDED
                : item.acceptedSubmit
                  ? "accepted"
                  : "never accepted"}
            </strong>
          </div>
          <div>
            <span>backend</span>
            <strong>{item.backend ?? UNRECORDED}</strong>
          </div>
        </dl>
        <p className="ana-preview">{tracePreview(item)}</p>
        {item.tools.length === 0 ? (
          <p className="ana-note">No tool calls recorded.</p>
        ) : (
          <ol className="ana-tool-list">
            {item.tools.map((tool) => (
              <ToolCallDetail key={`${tool.seq}:${tool.toolCallId ?? tool.toolName}`} tool={tool} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function CaseDetail({
  item,
  onOpen,
  onBack,
}: {
  item: CaseSummary;
  onOpen: (path: string) => void;
  onBack: () => void;
}) {
  const truth = truthLabel(item);
  return (
    <Card className="ana-case-detail">
      <div className="ana-section-head">
        <div className="ana-task-title">
          <Button onClick={onBack} aria-label="Back to tasks" title="Back to tasks">
            <ArrowLeft size={18} aria-hidden="true" />
          </Button>
          <h2>{item.id}</h2>
        </div>
        <div className="ana-record-meta">
          <Badge tone={truth.tone}>{truth.label}</Badge>
          <Badge tone="neutral">{item.family}</Badge>
          <Badge tone={statusTone(item.status)}>{item.status}</Badge>
        </div>
      </div>

      {item.publicTask === undefined ? (
        <p className="ana-preview">Task input unavailable.</p>
      ) : (
        <>
          <RecordView key={`${item.runId}:${item.id}`} value={item.publicTask.input} defaultExpanded />
          <Disclosure title="Public requirements">
            {item.publicTask.resources.map((resource) => (
              <div key={resource.name}>
                <h3>{resource.name.replaceAll("-", " ")}</h3>
                <RecordView value={resource.content} />
              </div>
            ))}
          </Disclosure>
        </>
      )}

      {item.solverErrors.length > 0 ? (
        <Callout tone="warn">
          <strong>Solver error before verification.</strong>
          <ul className="ana-clause-list">
            {item.solverErrors.map((error) => (
              <li key={error}>
                <Code>{error}</Code>
              </li>
            ))}
          </ul>
          {item.truthOk === null && item.nonResult === null ? (
            <p>
              The evidence records no truth verdict and no non-result kind, so this case is unverified while
              still carrying <Code>pass: {String(item.pass)}</Code>. It is outside the capability rate.
              Unaccepted attempts count towards difficulty once the battery has a verified case.
            </p>
          ) : null}
        </Callout>
      ) : null}

      <SolverTrace item={item} />
      <Disclosure title={`Evidence files (${item.files.length})`}>
        <div className="ana-file-mini-list">
          {item.files.map((file) => (
            <button
              type="button"
              className="ana-evidence-link"
              key={file.path}
              onClick={() => onOpen(file.path)}
            >
              {file.path}
            </button>
          ))}
        </div>
      </Disclosure>
    </Card>
  );
}

function CaseTable({
  rows,
  evaluationIds,
  onSelect,
}: {
  rows: CaseSummary[];
  evaluationIds: string[];
  onSelect: (id: string, button: HTMLButtonElement) => void;
}) {
  return (
    <DataTable>
      <thead>
        <tr>
          <th>Tasks ({rows.length})</th>
          <th>evaluation</th>
          <th>family</th>
          <th>result</th>
          <th>submit</th>
          <th>turns</th>
          <th>tools</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((item) => {
          const truth = truthLabel(item);
          return (
            <tr key={`${item.runId}:${item.id}`}>
              <td>
                <button
                  type="button"
                  className="ana-row-select"
                  onClick={(event) => onSelect(`${item.runId}:${item.id}`, event.currentTarget)}
                >
                  {item.id}
                </button>
              </td>
              <td>{evaluationLabel(item.variant, evaluationIds)}</td>
              <td>{item.family}</td>
              <td>
                <Badge tone={truth.tone}>{truth.label}</Badge>
              </td>
              <td>
                {item.acceptedSubmit === null ? UNRECORDED : item.acceptedSubmit ? "accepted" : "absent"}
              </td>
              <td className="ana-num">{item.turns ?? UNRECORDED}</td>
              <td className="ana-num">{item.toolCalls ?? UNRECORDED}</td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}

function CasesViewInner({ run, onOpen }: { run: RunView; onOpen: (path: string) => void }) {
  const detail = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLButtonElement | null>(null);
  const cases = run.variants.flatMap((variant) => variant.cases);
  const [variant, setVariant] = useState("all");
  const [result, setResult] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (selectedId !== null) {
      detail.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    } else if (origin.current?.isConnected === true) origin.current.focus();
  }, [selectedId]);
  const rows = cases.filter(
    (item) =>
      (variant === "all" || item.variant === variant) &&
      matchesResult(item, result) &&
      matchesTask(item, query),
  );
  const selected = rows.find((item) => `${item.runId}:${item.id}` === selectedId) ?? null;
  if (cases.length === 0) {
    return <NoSignal title="No tasks recorded">This run may still be building.</NoSignal>;
  }
  return (
    <Section>
      <div hidden={selected !== null}>
        <Filters>
          <Search value={query} onChange={setQuery} placeholder="Search task content, ID or family" />
          <Select
            label="Evaluation"
            value={variant}
            onChange={setVariant}
            values={["all", ...new Set(cases.map((item) => item.variant))]}
            format={(id) => evaluationLabel(id, Object.keys(run.outcome?.batteries ?? {}))}
          />
          <Select
            label="Result"
            value={result}
            onChange={setResult}
            values={["all", "pass", "fail", "unaccepted", "non-result", "unverified"]}
          />
          {query !== "" || variant !== "all" || result !== "all" ? (
            <Button
              onClick={() => {
                setQuery("");
                setVariant("all");
                setResult("all");
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </Filters>
        {rows.length === 0 ? (
          <NoSignal title="No matching tasks">Change the search or clear filters.</NoSignal>
        ) : null}
        {rows.length > 0 ? (
          <div aria-label="Task results">
            <CaseTable
              rows={rows}
              evaluationIds={Object.keys(run.outcome?.batteries ?? {})}
              onSelect={(id, button) => {
                origin.current = button;
                setSelectedId(id);
              }}
            />
          </div>
        ) : null}
      </div>
      {selected ? (
        <div ref={detail} tabIndex={-1} aria-label="Selected task details">
          <CaseDetail item={selected} onOpen={onOpen} onBack={() => setSelectedId(null)} />
        </div>
      ) : null}
    </Section>
  );
}

/** Skip renders when the run object and callback are unchanged. */
export const CasesView = memo(CasesViewInner);

function recordedArguments(excerpt: string): string {
  try {
    const args: unknown = JSON.parse(excerpt);
    const command = asRecord(args)?.command;
    if (isString(command)) return command;
    return JSON.stringify(args, null, 2);
  } catch {
    return excerpt;
  }
}

export function ToolCallDetail({ tool }: { tool: ToolCallSummary }) {
  const result = tool.resultExcerpt ?? tool.resultPreview;
  return (
    <li>
      <details className="ana-tool-call">
        <summary>
          <span>{tool.seq}</span>
          <strong>{tool.toolName}</strong>
          <small>turn {tool.turn}</small>
          {tool.timingMs === null ? null : <small>{tool.timingMs} ms</small>}
          {tool.isError === true ? <Badge tone="bad">error</Badge> : null}
          <span className="ana-caret" aria-hidden>
            ›
          </span>
        </summary>
        <div className="ana-tool-content">
          <h4>{tool.toolName === "bash" ? "Command" : "Arguments"}</h4>
          {tool.argsExcerpt === null ? (
            <p>Arguments not recorded.</p>
          ) : (
            <pre>{recordedArguments(tool.argsExcerpt)}</pre>
          )}
          <h4>{tool.resultExcerpt === null ? "Result preview" : "Result excerpt"}</h4>
          {result === null ? <p>Result not recorded.</p> : <pre>{result}</pre>}
          <p className="ana-note">Excerpts may be redacted or truncated.</p>
        </div>
      </details>
    </li>
  );
}

export function matchesTask(
  item: Pick<CaseSummary, "id" | "family" | "assistantPreview" | "publicTask">,
  query: string,
): boolean {
  const content =
    `${item.id} ${item.family} ${item.assistantPreview ?? ""} ${JSON.stringify(item.publicTask ?? "")}`.toLowerCase();
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .every((term) => content.includes(term));
}
