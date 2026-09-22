/**
 * Derived facts over one Builder session's execution evidence — the authoring-side counterpart to
 * trace-facts.ts, which does the same job for a solve trace.
 *
 * The evidence already carries the counts. What a reader has to work out by eye is whether the
 * session was making progress: a Builder that resubmits a tree it has already submitted, or that is
 * handed a refusal it has already been handed, is repeating itself. Run 35 did both 141 times and
 * nothing said so.
 *
 * Comparisons use recorded counts. This reader applies no policy threshold or success rate,
 * and makes no controller decision; like the anomaly scan, it reports facts for inspection.
 */
import { existsSync, readFileSync, readdirSync } from "../../src/meta/filesystem.ts";
import { dirname, join } from "../../src/meta/path.ts";
import {
  BUILDER_EXECUTION_EVIDENCE_FILE,
  BUILDER_EXECUTION_SCHEMA,
  type BuilderExecutionEvidence,
} from "../../src/author/builder-execution.ts";
import { plainRecord } from "../../src/meta/json-evidence.ts";
import { isString } from "../../src/meta/json-shape.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { isCurrentExecutionRecord } from "./builder-execution-current.ts";
import {
  type BuilderExecutionInvocation,
  latestClosedInvocation,
} from "../../src/run/builder-execution-closure.ts";
import { errorMessage } from "../../src/meta/runtime-values.ts";

interface ExecutionEvidenceRead {
  records: BuilderExecutionEvidence[];
  /** Session numbers from the on-disk filenames, aligned with `records`. */
  sessions: number[];
  /** Recognised execution files that are not a current record. */
  unavailable: string[];
}

/** Missing or unusable evidence, before formatting it for the report. */
type ExecutionEvidenceUnavailable =
  | { kind: "gap"; path: string; session: number; through: number }
  | { kind: "malformed-json"; path: string; session: number; error: string }
  | { kind: "duplicate"; path: string; session: number; selected: string }
  | { kind: "record"; path: string; session: number; reason: string }
  | { kind: "unclosed"; path: string; session: number; invocation: BuilderExecutionInvocation };

interface PresentExecutionFile {
  path: string;
  session: number;
}

interface PresentExecutionFiles {
  files: Map<number, PresentExecutionFile[]>;
  unavailable: ExecutionEvidenceUnavailable[];
}

const NUMBERED_EXECUTION_FILE = /^builder-execution-(\d+)\.json$/;

function unavailableMessage(fact: ExecutionEvidenceUnavailable): string {
  switch (fact.kind) {
    case "gap":
      return `${fact.path}: execution evidence gap at session ${fact.session}${fact.through === fact.session ? "" : ` through ${fact.through}`}; later numbered records are present`;
    case "malformed-json":
      return `${fact.path}: malformed JSON (${fact.error})`;
    case "duplicate":
      return `${fact.path}: duplicate execution evidence for session ${fact.session}; ${fact.selected} is the selected record`;
    case "record":
      return `${fact.path}: ${fact.reason}`;
    case "unclosed":
      return `${fact.path}: session ${String(fact.session)} still reads in-flight after controller run ${fact.invocation.runId} recorded its terminal at ${fact.invocation.closedAt}`;
  }
}

function readRecord(
  parsed: unknown,
  path: string,
  session: number,
): { record: BuilderExecutionEvidence } | { unavailable: ExecutionEvidenceUnavailable } {
  const plain = plainRecord(parsed);
  const schema = isString(plain?.schema) ? plain.schema : "";
  if (schema !== BUILDER_EXECUTION_SCHEMA) {
    return {
      unavailable: {
        kind: "record",
        path,
        session,
        reason: `malformed execution record with unknown schema ${JSON.stringify(schema)}`,
      },
    };
  }
  if (!isCurrentExecutionRecord(parsed)) {
    return {
      unavailable: {
        kind: "record",
        path,
        session,
        reason: `${BUILDER_EXECUTION_SCHEMA} record has an incomplete or invalid shape`,
      },
    };
  }
  return { record: parsed };
}

function executionFilePath(epochDir: string, session: number): string {
  return join(
    epochDir,
    session === 1
      ? BUILDER_EXECUTION_EVIDENCE_FILE
      : `builder-execution-${String(session).padStart(2, "0")}.json`,
  );
}

function presentExecutionFiles(epochDir: string): PresentExecutionFiles {
  const files = new Map<number, PresentExecutionFile[]>();
  const unavailable: ExecutionEvidenceUnavailable[] = [];
  const add = (file: PresentExecutionFile): void => {
    const rows = files.get(file.session) ?? [];
    rows.push(file);
    files.set(file.session, rows);
  };
  const bare = join(epochDir, BUILDER_EXECUTION_EVIDENCE_FILE);
  if (existsSync(bare)) add({ path: bare, session: 1 });
  if (!existsSync(epochDir)) return { files, unavailable };
  for (const name of readdirSync(epochDir)) {
    const match = NUMBERED_EXECUTION_FILE.exec(name);
    if (match === null) continue;
    const session = Number(match[1]);
    if (!Number.isSafeInteger(session) || session < 1) {
      unavailable.push({
        kind: "record",
        path: join(epochDir, name),
        session: 0,
        reason: "malformed execution record filename; session number must be a positive integer",
      });
      continue;
    }
    add({ path: join(epochDir, name), session });
  }
  return { files, unavailable };
}

/** Every session's execution evidence for one epoch, in write order: the bare file is session 1,
 *  `builder-execution-NN.json` the later sessions. Numbered files are enumerated before reading,
 *  so a missing middle record and a damaged record do not hide later valid sessions. Malformed
 *  JSON and records the current writer did not write are reported unavailable instead of throwing
 *  or silently reading as a candidate. */
export function readExecutionEvidenceDetails(epochDir: string): ExecutionEvidenceRead {
  const out: BuilderExecutionEvidence[] = [];
  const sessionNumbers: number[] = [];
  const listed = presentExecutionFiles(epochDir);
  const unavailable: string[] = listed.unavailable.map(unavailableMessage);
  const sessions = [...listed.files.keys()].sort((left, right) => left - right);
  const closed = latestClosedInvocation(dirname(epochDir));
  let previousSession = 0;
  for (const session of sessions) {
    if (session > previousSession + 1) {
      const missingSession = previousSession + 1;
      unavailable.push(
        unavailableMessage({
          kind: "gap",
          path: executionFilePath(epochDir, missingSession),
          session: missingSession,
          through: session - 1,
        }),
      );
    }
    const files = listed.files.get(session);
    if (files === undefined) continue;
    previousSession = session;
    files.sort((left, right) => left.path.localeCompare(right.path));
    const [file] = files;
    if (file === undefined) continue;
    for (const duplicate of files.slice(1)) {
      unavailable.push(
        unavailableMessage({ kind: "duplicate", path: duplicate.path, session, selected: file.path }),
      );
    }
    let parsed: unknown;
    try {
      parsed = parseJsonAs<unknown>(readFileSync(file.path, "utf8"));
    } catch (error) {
      unavailable.push(
        unavailableMessage({
          kind: "malformed-json",
          path: file.path,
          session,
          error: errorMessage(error),
        }),
      );
      continue;
    }
    const result = readRecord(parsed, file.path, session);
    if ("record" in result) {
      out.push(result.record);
      sessionNumbers.push(session);
      // An in-flight record is a checkpoint of a session that was still running. Once the campaign's
      // closing record exists, this checkpoint should have a recorded ending too. The existing
      // rows remain available, and the report names the missing ending so later analysis does
      // not mistake the checkpoint's totals for a completed result.
      if (result.record.outcome === "in-flight" && closed !== null) {
        unavailable.push(
          unavailableMessage({ kind: "unclosed", path: file.path, session, invocation: closed }),
        );
      }
    } else unavailable.push(unavailableMessage(result.unavailable));
  }
  return { records: out, sessions: sessionNumbers, unavailable };
}

export function readExecutionEvidence(epochDir: string): BuilderExecutionEvidence[] {
  return readExecutionEvidenceDetails(epochDir).records;
}
