/**
 * Selects the campaign epoch. Each combination of request digest, Builder condition and authoring
 * pass identifies one epoch, so reusing that combination resumes the same epoch after an
 * interruption, and changing it creates a successor that points back to the previous epoch while
 * preserving its files. That is what lets a corrected request restart a campaign without
 * hand-editing state or deleting a directory. The controller records successors and selects the
 * current epoch in the root's epochs.json, appending new entries and moving the current pointer.
 *
 * A reopened authoring pass changes the identity too, through `pass`, so a rebuild opens its own
 * epoch and the directory that recorded the first build survives with its history intact. Without
 * that distinction the pointer follows the binding rather than the work, and a run that opened four
 * later epochs still finishes with `current` naming its initial build.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "../meta/filesystem.ts";
import { listIterationDirs } from "../builder/campaign-iterations.ts";
import { join } from "../meta/path.ts";
import type { BackendKind } from "../backends/resolve.ts";
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
  /** The evidence identity of a reopening authoring pass, when this selection is one, so that pass
   *  opens its own epoch. Absent for the initial build and for pre-adoption continuations, which
   *  belong in the epoch they are continuing. An evaluation correction carries its own pass and so
   *  cannot resume an older generation's workspace. Absent leaves the binding byte-identical to
   *  what the kickoff and Builder condition alone produce. */
  pass?: string;
}

export interface CampaignEpochEvidence {
  key: string;
  /** Absolute epoch directory — the climb's campaignDir. */
  dir: string;
  /** The epoch this one superseded: a prior epoch key, or null for a fresh campaign. */
  supersedes: string | null;
}

/** What changed between an epoch and the one it superseded: only the authoring `pass`, on the same
 *  request and Builder condition, or the `binding` itself. Null for a first epoch, or when either
 *  epoch is missing from the record, since then nothing says what the two had in common. */
export type EpochSuccession = "pass" | "binding";

type EpochRecordEntry = {
  key: string;
  supersedes: string | null;
  createdAt: string;
  /** Lookup compares these fields rather than recomputing the key from them (`entryFor`), so an
   *  epoch stays findable by the binding it was written under instead of by a hash recipe a later
   *  version of this file might spell differently. */
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

/** One authoring iteration's directory, `<epoch>/NN-<stage>`. */
interface CampaignIteration {
  epoch: string;
  name: string;
  dir: string;
}

/** The supersession record, or null before the first epoch. A damaged record refuses rather than
 *  reading as absent, because a guessed-at lineage would let two epochs both believe they are
 *  current and the repair is to fix the record, not to delete epochs. */
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

/**
 * Every epoch directory on disk: the recorded ones in their recorded order, then any `epoch-*`
 * directory the record does not name, by name, so an unrecorded epoch stays a fact rather than
 * disappearing. An epoch's name is a hash of its binding, so a sorted listing is no chronology.
 */
export function campaignEpochs(campaignRoot: string): string[] {
  if (!existsSync(campaignRoot)) return [];
  const isEpochDir = (name: string): boolean =>
    statSync(join(campaignRoot, name), { throwIfNoEntry: false })?.isDirectory() === true;
  const recorded = campaignEpochOrder(campaignRoot).filter(isEpochDir);
  const named = new Set(recorded);
  const unrecorded = readdirSync(campaignRoot)
    .filter((name) => name.startsWith("epoch-") && !named.has(name) && isEpochDir(name))
    .sort();
  return [...recorded, ...unrecorded];
}

/** Every iteration of a campaign, oldest first: epochs as `campaignEpochs` orders them, and each
 *  epoch's iterations by ordinal. */
export function campaignIterations(campaignRoot: string): CampaignIteration[] {
  return campaignEpochs(campaignRoot).flatMap((epoch) =>
    listIterationDirs(join(campaignRoot, epoch)).map((name) => ({
      epoch,
      name,
      dir: join(campaignRoot, epoch, name),
    })),
  );
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

/** Which succession `epoch` is, read from the record; see EpochSuccession. */
export function epochSuccession(campaignRoot: string, epoch: CampaignEpochEvidence): EpochSuccession | null {
  const epochs = readEpochRecord(campaignRoot)?.epochs ?? [];
  const entry = epochs.find(({ key }) => key === epoch.key);
  const prior = epochs.find(({ key }) => key === epoch.supersedes);
  if (entry === undefined || prior === undefined) return null;
  return sameCondition(prior, entry.binding) ? "pass" : "binding";
}

/** The epoch a reopening pass would supersede: its own when it has already opened, otherwise the
 *  latest pass on the same prompt and Builder condition -- hence `findLast` over the append order
 *  rather than the first match. Falling back to the pass-less initial build instead skips the pass
 *  that just refused or repaired the product, in every campaign that ran more than two. */
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

/** The epoch for this exact binding, read without moving the controller's current pointer.
 *  Evidence selection reads it this way because following `current` would cross a corrected ask,
 *  and selecting by kickoff alone could land on a different Builder condition or authoring pass. */
export function campaignEpochForBinding(
  campaignRoot: string,
  input: CampaignBindingInput,
): CampaignEpochEvidence | null {
  const existing = entryFor(readEpochRecord(campaignRoot), bindingOf(input));
  return existing === undefined ? null : evidenceOf(campaignRoot, existing);
}

/**
 * Selects, or records, the epoch for a binding and points `current` at it. Re-running an older
 * binding re-points `current` at its existing epoch instead of creating a duplicate, and the
 * iterations completed under it stay valid memory because the binding they were built under is
 * byte-identical. `current` therefore names the epoch the last authoring pass wrote, which is what
 * every later reader of this record means by "current".
 *
 * A reopening pass carries `pass`, so it never lands in an epoch an earlier pass recorded: it
 * creates its own, supersedes whatever was current, and inherits that predecessor's memory the same
 * way a corrected ask does.
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
