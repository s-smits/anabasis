import type { OutcomeReport } from "../../../tools/outcome/metrics.ts";
import type { OutcomeJudgeReport } from "../../../tools/outcome/judge.ts";
import { hasText } from "../../../src/meta/text.ts";

/** The one route that writes: the client posts to it and the server matches it. */
export const PROJECT_BACKEND_ROUTE = "/api/project-backend";

export type Tone = "good" | "bad" | "warn" | "info" | "neutral";
type EvidenceStatus = "active" | "complete" | "failed" | "blocked" | "partial" | "absent" | "unknown";
export interface EvidenceIssue {
  level: "warning" | "error";
  source: string;
  message: string;
}

export interface FileRef {
  path: string;
  category:
    | "observation"
    | "iteration"
    | "gate"
    | "case"
    | "trace"
    | "judge"
    | "claim"
    | "analysis"
    | "promotion"
    | "harness"
    | "log"
    | "other";
  bytes: number;
  modifiedAt: string;
  content: "json" | "jsonl" | "text" | "typescript" | "other";
  protected: boolean;
}

export interface ToolCallSummary {
  seq: number;
  turn: number;
  toolName: string;
  toolCallId: string | null;
  isError: boolean | null;
  argsExcerpt: string | null;
  resultExcerpt: string | null;
  resultPreview: string | null;
  timingMs: number | null;
}

export interface CaseSummary {
  id: string;
  variant: string;
  runId: string;
  family: string;
  publicTask?: { input: unknown; resources: Array<{ name: string; content: unknown }> };
  status: EvidenceStatus | "unaccepted";
  acceptedSubmit: boolean | null;
  truthOk: boolean | null;
  pass: boolean | null;
  nonResult: string | null;
  solverErrors: string[];
  turns: number | null;
  toolCalls: number | null;
  backend: string | null;
  assistantPreview: string | null;
  tools: ToolCallSummary[];
  traceState: "recorded" | "no-trace-pointer" | "trace-missing" | "trace-drifted" | null;
  files: FileRef[];
  updatedAt: string;
}

export interface VariantSummary {
  runId: string;
  cases: CaseSummary[];
  files: FileRef[];
}

export interface RunRequest {
  runId: string;
  command: string | null;
  openedAt: string | null;
  requestDigest: string | null;
  origin: string | null;
  slots: Array<{
    slot: string;
    enabled: boolean;
    kind: string | null;
    model: string | null;
    effort: string | null;
  }>;
  host: string | null;
  commit: string | null;
  dirty: boolean | null;
  continuedFrom: string | null;
  source: string;
}

export interface DifficultyDecision {
  action: string | null;
  /** Where the battery stood: the band zone of a placed record, or `L<n>` for an earlier record
   *  that carried levels. Null for a set-aside. */
  standing: string | null;
  rationale: string | null;
  admitted: number | null;
  excluded: string[];
  source: string;
}

export interface RunStory {
  request: RunRequest | null;
  difficulty: DifficultyDecision | null;
}

export interface RunView {
  outcome?: OutcomeReport;
  reviews?: OutcomeJudgeReport[];
  id: string;
  projectId: string;
  title: string;
  status: EvidenceStatus;
  currentPhase: string;
  startedAt: string | null;
  updatedAt: string | null;
  sourceIdentity: string | null;
  variants: VariantSummary[];
  story: RunStory;
  files: FileRef[];
  issues: EvidenceIssue[];
}

export type ProjectBackendSlot = "builder" | "built" | "review";
export type ProjectBackendSelection = "codex" | "openrouter" | "claude" | "disabled" | "inherit";

interface ProjectBackendChoiceView {
  value: ProjectBackendSelection;
  label: string;
  supported: boolean;
}

export interface ProjectBackendSlotView {
  slot: ProjectBackendSlot;
  label: string;
  enabled: boolean;
  selection: ProjectBackendSelection;
  kind: "codex" | "openrouter" | "claude" | null;
  model: string | null;
  reasoningEffort: string | null;
  source: "operator" | "env" | "default" | "inherited-explicit" | "unconfigured";
  choices: ProjectBackendChoiceView[];
}

export interface ProjectBackendsView {
  path: string;
  slots: ProjectBackendSlotView[];
  error: string | null;
}

export interface ProjectView {
  id: string;
  adopted: boolean;
  backends: ProjectBackendsView;
  runs: RunView[];
  issues: EvidenceIssue[];
}

export interface WorkspaceSnapshot {
  schema: "ana-observatory/v2";
  generatedAt: string;
  repository: string;
  repositoryPath: string;
  state: "ready" | "partial" | "empty" | "invalid";
  projects: ProjectView[];
  issues: EvidenceIssue[];
}

export interface FilePayload {
  path: string;
  contentType: FileRef["content"];
  protected: boolean;
  value: unknown;
  truncated: boolean;
  bytes: number;
}

export const EVIDENCE_PAGE_SIZE = 100;
export interface EvidencePage {
  files: FileRef[];
  offset: number;
  hasMore: boolean;
}
export function shortHash(value: string | null | undefined, length = 12): string {
  if (!hasText(value)) return "not recorded";
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

export function statusTone(status: string): Tone {
  if (
    status === "complete" ||
    status === "active" ||
    status === "pass" ||
    status === "fingerprinted" ||
    status === "stamped"
  ) {
    return status === "active" ? "info" : "good";
  }
  if (status === "failed" || status === "blocked" || status.includes("failed")) return "bad";
  if (status === "partial" || status === "unknown" || status.includes("blocked")) return "warn";
  return "neutral";
}
