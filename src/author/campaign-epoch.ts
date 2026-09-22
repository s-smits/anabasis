/**
 * Selects the campaign epoch. Each combination of request digest, Builder condition and authoring
 * pass identifies one epoch: reusing it resumes that epoch, and a changed one creates a successor
 * that points to its predecessor and keeps its files. The root's epochs.json records the entries
 * in append order and the current pointer.
 */
import { mkdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { BackendKind } from "../backends/backend-kinds.ts";
import { readCompleted, writeCompleted } from "../meta/completed-json.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
export { readCompleted, writeCompleted } from "../meta/completed-json.ts";

export type CampaignBuilderCondition = {
  kind: BackendKind;
  model: string | null;
  reasoningEffort: string;
  /** Ordered exclusive upstream route when the Builder uses OpenRouter. */
  providerPin?: string[];
};

/** An epoch is one authoring workspace: one Builder condition, on one prompt, for one authoring
 *  pass. The campaign root already names the domain, so the domain is not part of the binding. */
export interface CampaignBindingInput {
  /** The operator's ask, verbatim; its content hash keys the epoch. */
  kickoff: string;
  /** Every condition that shapes Builder output. Null is reserved for injected test sessions. */
  builder?: CampaignBuilderCondition | null;
  /** The evidence identity of a reopening authoring pass, so it opens its own epoch. Absent for
   *  the initial build and pre-adoption continuations, leaving the key unchanged. */
  pass?: string;
}

export interface CampaignEpochEvidence {
  key: string;
  /** Absolute epoch directory — the climb's campaignDir. */
  dir: string;
  /** The epoch this one superseded: a prior epoch key, or null for a fresh campaign. */
  supersedes: string | null;
}

type EpochRecordEntry = {
  key: string;
  supersedes: string | null;
  createdAt: string;
  /** Lookup compares these fields, not a recomputed key. */
  binding: {
    kickoffHash: string;
    builder: CampaignBuilderCondition | null;
    /** Present only on an epoch a reopening authoring pass created; see CampaignBindingInput. */
    pass?: string;
  };
};

interface EpochRecord {
  schema: "campaign-epochs/v1";
  current: string;
  epochs: EpochRecordEntry[];
}

/** The supersession record, or null before the first epoch. A damaged record refuses rather than
 *  reading as absent. */
function readEpochRecord(campaignRoot: string): EpochRecord | null {
  return readCompleted<EpochRecord>(
    join(campaignRoot, "epochs.json"),
    "campaign-epochs/v1",
    "epochs",
    "the controller owns supersession; repair this record instead of deleting epochs",
  );
}

/** Epoch chronology is the append order of the controller-owned record. */
export function campaignEpochOrder(campaignRoot: string): string[] {
  return readEpochRecord(campaignRoot)?.epochs.map(({ key }) => key) ?? [];
}

function bindingOf(input: CampaignBindingInput): EpochRecordEntry["binding"] {
  return {
    kickoffHash: hashJsonValue(input.kickoff),
    builder: input.builder ?? null,
    ...keyIfDefined("pass", input.pass),
  };
}

/** The recorded entry for a binding, by its fields: the same prompt, Builder condition and pass. */
function entryFor(
  record: EpochRecord | null,
  binding: EpochRecordEntry["binding"],
): EpochRecordEntry | undefined {
  return record?.epochs.find((entry) => sameCondition(entry, binding) && entry.binding.pass === binding.pass);
}

function sameCondition(entry: EpochRecordEntry, binding: EpochRecordEntry["binding"]): boolean {
  return (
    entry.binding.kickoffHash === binding.kickoffHash &&
    hashJsonValue(entry.binding.builder) === hashJsonValue(binding.builder)
  );
}

function evidenceOf(campaignRoot: string, entry: EpochRecordEntry): CampaignEpochEvidence {
  return { key: entry.key, dir: join(campaignRoot, entry.key), supersedes: entry.supersedes };
}

/** The epoch a reopening pass would supersede: its own when it has already opened, otherwise
 *  the latest pass on the same prompt and Builder condition. */
export function latestCampaignEpochForBinding(
  campaignRoot: string,
  input: CampaignBindingInput,
): CampaignEpochEvidence | null {
  const binding = bindingOf(input);
  const latest = readEpochRecord(campaignRoot)?.epochs.findLast((row) => sameCondition(row, binding));
  return (
    campaignEpochForBinding(campaignRoot, input) ??
    (latest === undefined ? null : evidenceOf(campaignRoot, latest))
  );
}

/** The epoch for this exact binding, read without moving the current pointer. */
export function campaignEpochForBinding(
  campaignRoot: string,
  input: CampaignBindingInput,
): CampaignEpochEvidence | null {
  const existing = entryFor(readEpochRecord(campaignRoot), bindingOf(input));
  return existing === undefined ? null : evidenceOf(campaignRoot, existing);
}

/**
 * Selects, or records, the epoch for a binding and points `current` at it. An existing binding
 * reuses its epoch; a new one, including every reopening pass, supersedes the current epoch.
 */
export function selectCampaignEpoch(
  campaignRoot: string,
  input: CampaignBindingInput,
): CampaignEpochEvidence {
  const binding = bindingOf(input);
  const record = readEpochRecord(campaignRoot);
  const existing = entryFor(record, binding);
  if (record !== null && existing !== undefined) {
    if (record.current !== existing.key) {
      writeCompleted(join(campaignRoot, "epochs.json"), { ...record, current: existing.key });
    }
    return evidenceOf(campaignRoot, existing);
  }
  const key = `epoch-${hashJsonValue(binding).slice(0, 12)}`;
  const dir = join(campaignRoot, key);
  const entry: EpochRecordEntry = {
    key,
    supersedes: record?.current ?? null,
    createdAt: new Date().toISOString(),
    binding,
  };
  mkdirSync(dir, { recursive: true });
  writeCompleted(join(campaignRoot, "epochs.json"), {
    schema: "campaign-epochs/v1",
    current: key,
    epochs: [...(record?.epochs ?? []), entry],
  });
  return { key, dir, supersedes: entry.supersedes };
}
