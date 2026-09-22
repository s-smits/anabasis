/** Durable evidence for the climb readout an authoring round consumes. */
import { mkdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { readJsonFile, writeCompleted } from "../meta/completed-json.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import type { ClimbReadout } from "./climb-readout.ts";
import { FRAME_REVISION } from "./climb-readout-frame.ts";

export type DifficultyDecisionEvidence = {
  /** Consumers read `difficulty.decision`, `admitted` and `excluded`. */
  schema: "difficulty-decision/v5";
  runId: string;
  slug: string;
  digest: string;
  /** The frame revision the round's sentences were rendered from: a reworded sentence is a new
   *  recorded condition. */
  frame: string;
  difficulty: ClimbReadout;
};

export interface RecordedDifficultyDecision {
  path: string;
  evidence: DifficultyDecisionEvidence;
}

const DIRECTORY = "difficulty-decisions";

/**
 * Record the replayable readout before authoring starts. The filename binds the run and
 * digest, while the record carries every battery content address the decision used. Reopening the
 * completed bytes before returning keeps the Builder's diagnosis digest joined to an existing file.
 */
export function recordDifficultyDecision(input: {
  campaignRoot: string;
  runId: string;
  slug: string;
  difficulty: ClimbReadout;
}): RecordedDifficultyDecision {
  const digest = hashJsonValue(input.difficulty);
  const persisted: DifficultyDecisionEvidence = {
    schema: "difficulty-decision/v5",
    runId: input.runId,
    slug: input.slug,
    digest,
    frame: FRAME_REVISION,
    difficulty: input.difficulty,
  };
  const dir = join(input.campaignRoot, DIRECTORY);
  const path = join(dir, `${input.runId}-${digest}.json`);
  mkdirSync(dir, { recursive: true });
  writeCompleted(path, persisted);
  const reopened = readJsonFile(path);
  if (hashJsonValue(reopened) !== hashJsonValue(persisted)) {
    throw new Error(`${path}: completed difficulty decision differs from the selected evidence`);
  }
  return { path, evidence: persisted };
}
