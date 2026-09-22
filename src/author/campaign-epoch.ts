/**
 * Select the campaign epoch (production restart audit, 2026-07-26). Each combination of request
 * digest, Builder condition and authoring pass identifies one epoch. Reusing that combination resumes
 * the same epoch after an interruption. A changed combination creates a successor that points
 * to the previous epoch while preserving its files. A corrected request can therefore restart
 * without hand-editing state or deleting a directory, resolving fullrun-live-01's restart
 * defect #2. The controller records successors and selects the current epoch in the root's
 * epochs.json; it appends new entries and updates the current pointer.
 *
 * A reopened authoring pass also changes the identity through `pass`. A rebuild therefore opens
 * its own epoch, preserving the directory that recorded the first build and its history.
 * Without this distinction, run52-opus-0903 finished with `current` pointing back to its initial
 * build epoch even though four later epochs had been created.
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
  /** The evidence identity of a reopening authoring pass, when this selection is one. Absent for
   *  pre-adoption continuations and the initial build. An evaluation correction carries its
   *  own pass so it cannot resume an older generation's workspace. Absent leaves the key
   *  byte-identical to what the binding alone produced, so every epoch written before this field
   *  still resolves to its own directory. */
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
  /** Entries written before 2026-09-15 also carry `domain` and `engines: null` inside the hashed
   *  binding; they still resolve because lookup compares these fields, not a recomputed key. */
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

/** The supersession record, or null before the first epoch. A guessed-at lineage would let two
 *  epochs both believe they are current, so damage refuses instead of reading as absent. */
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
 *  the latest pass on the same prompt and Builder condition. The next-move reader used to fall
 *  back to the pass-less initial build, which in 22 recorded campaigns with three or more passes
 *  skipped the pass that had actually just refused or repaired the product. */
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

/** Find the epoch for this exact binding without changing the controller's current pointer.
 * Evidence selection uses this read-only check: following `current` would cross a corrected ask,
 * and selecting by kickoff alone could select a different Builder condition or authoring pass. */
export function campaignEpochForBinding(
  campaignRoot: string,
  input: CampaignBindingInput,
): CampaignEpochEvidence | null {
  const existing = entryFor(readEpochRecord(campaignRoot), bindingOf(input));
  return existing === undefined ? null : evidenceOf(campaignRoot, existing);
}

/**
 * Select (or write) the epoch for a binding. Re-running an older binding re-points `current` at
 * its EXISTING epoch instead of creating a duplicate — completed iterations under it stay valid
 * memory because the binding they were built under is byte-identical. `current` therefore names
 * the epoch the last authoring pass wrote, which is what every later reader of this record means
 * by "current".
 *
 * A reopening pass carries `pass`, so it never lands in an epoch an earlier pass recorded: it creates
 * its own, supersedes whatever was current, and inherits that predecessor's memory the same way a
 * corrected ask does.
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
