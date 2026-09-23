/**
 * One open state map, optional files, and one explicitly prepared answer, under one owner.
 *
 * The store holds working state; it does not decide the answer's shape. `setArtifact` records any
 * bounded JSON value, and public-schema validation belongs to the writer and submission paths, so a
 * domain's working state and its answer can have different shapes without this class knowing either.
 *
 * Earlier versions modelled that working state as a node-and-edge graph carried over from v1. No
 * consumer ever read it: nothing under `src/solve/` or `starters/` names a graph today, and
 * `inspect_draft` renders whatever the snapshot happens to hold. It is gone. A domain that wants a
 * graph stores one under a key; a domain that wants a table, a list or a single number stores that
 * directly, instead of converting it into nodes and edges on the way in and back out again.
 *
 * State and files both offer set, get, has, delete and a sorted snapshot, so a caller moving between
 * them keeps one set of habits. Both are Maps, which is also why a key called `__proto__` is a key
 * here and not a prototype.
 */
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { sha256 } from "../meta/digest.ts";
import { canonicalJsonCopy as trustedJson, compareCodeUnits } from "../meta/stable-json.ts";
import { keysIf } from "../meta/optional-key.ts";
import { isObject, isString, type JsonValue } from "../meta/json-shape.ts";

const DRAFT_CHECKPOINT_SCHEMA = "draft-checkpoint/v2";
export const ARTIFACT_JSON_MAX_BYTES = 1024 * 1024;
export interface DraftSnapshot {
  state: Record<string, JsonValue>;
  /** Omitted while empty, so a harness that never writes a file has no file key. */
  files?: Record<string, string>;
}

interface ArtifactMaterializationRecord {
  artifactJson: string;
  artifactDigest: string;
  sourceSeq: number;
  writerName: string;
  callId: string;
}

export type ArtifactMaterialization =
  | { state: "absent" }
  | { state: "current"; record: ArtifactMaterializationRecord }
  | { state: "stale"; record: ArtifactMaterializationRecord; currentSeq: number };

export interface DraftCheckpoint {
  schema: typeof DRAFT_CHECKPOINT_SCHEMA;
  snapshot: DraftSnapshot;
  seq: number;
  materialization: ArtifactMaterializationRecord | null;
}

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

/** The canonical bytes of a prepared answer, under one limit wherever they are produced: the writer
 *  path in draft-files.ts and the public validation in public-artifact-validate.ts both come here,
 *  so an answer cannot be accepted at preparation and refused for its size at submission. The
 *  generated-tool frame budget is derived from the same constant, which is what keeps an answer this
 *  store holds transportable across the worker protocol. */
export function preparedArtifactJson(value: unknown): string {
  const { bytes } = trustedJson(value);
  if (byteLength(bytes) > ARTIFACT_JSON_MAX_BYTES) {
    throw new Error("the prepared answer exceeds its public byte limit");
  }
  return bytes;
}

/** Isolate every JSON-safe value crossing a read or write contract. Without the copy the caller and
 *  the store would share one object, so generated code could change what it had already written and
 *  a checkpoint would carry bytes nobody recorded. */
function clone<T>(value: T): T {
  return value === undefined
    ? value
    : /* SAFETY: the clone is a JSON round-trip of the same value, so it carries the same shape as its input. */ (trustedJson(
        value,
      ).value as T);
}

/** A payload-free identity for the controller-owned file projection. The worker frames and the
 *  checkpoint carry this digest rather than the files, so both ends can agree on which file map they
 *  hold without the transport paying for its content on every frame. */
export function fileMapDigest(files: Record<string, string>): string {
  return sha256(trustedJson(files).bytes);
}

function sorted<T>(map: Map<string, T>): Record<string, T> {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => compareCodeUnits(left, right)));
}

function restoreRefused(reason: string): never {
  throw new Error(`draft restore refused: ${reason}`);
}

/** A prepared-answer record carries bounded bytes, a hex digest, a source sequence no later than
 *  the checkpoint sequence and the writer call that produced it. */
function materializationMalformed(record: ArtifactMaterializationRecord, seq: number): boolean {
  return (
    !isObject(record) ||
    !isString(record.artifactJson) ||
    byteLength(record.artifactJson) > ARTIFACT_JSON_MAX_BYTES ||
    !/^[0-9a-f]{64}$/.test(record.artifactDigest) ||
    !Number.isSafeInteger(record.sourceSeq) ||
    record.sourceSeq < 0 ||
    record.sourceSeq > seq ||
    !isString(record.writerName) ||
    record.writerName === "" ||
    !isString(record.callId) ||
    record.callId === ""
  );
}

export class DraftStore {
  private readonly state = new Map<string, JsonValue>();
  private readonly files = new Map<string, string>();
  private _seq = 0;
  private materialization: ArtifactMaterializationRecord | null = null;

  get seq(): number {
    return this._seq;
  }
  private bump(): void {
    this._seq++;
  }

  setValue(key: string, value: JsonValue): void {
    this.state.set(key, clone(value));
    this.bump();
  }

  getValue(key: string): JsonValue | undefined {
    return this.state.has(key) ? clone(this.state.get(key)) : undefined;
  }

  hasValue(key: string): boolean {
    return this.state.has(key);
  }

  deleteValue(key: string): boolean {
    if (!this.state.delete(key)) return false;
    this.bump();
    return true;
  }

  stateSnapshot(): Record<string, JsonValue> {
    return clone(sorted(this.state));
  }

  setFile(path: string, content: string): void {
    this.files.set(path, content);
    this.bump();
  }

  getFile(path: string): string | undefined {
    return this.files.get(path);
  }

  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  deleteFile(path: string): boolean {
    if (!this.files.delete(path)) return false;
    this.bump();
    return true;
  }

  fileSnapshot(): Record<string, string> {
    return sorted(this.files);
  }

  /**
   * Whole-map replacement, for a caller holding a complete new set rather than a list of edits —
   * the shell hands back everything its command left behind (`built-bash.ts`).
   *
   * The sequence advances once per resulting file, minimum one, rather than once per call.
   * `fromCheckpoint` refuses a checkpoint whose sequence is below the mutations its own snapshot
   * required, and that floor counts files, so a single bump for ten applied files would make every
   * later checkpoint of this store read as falsified.
   *
   * An identical map leaves the sequence where it is. A command that only read or tested the files
   * changed nothing, and `seq` is how a caller learns whether there is anything new to record.
   */
  replaceFiles(files: Record<string, string>): void {
    const entries = Object.entries(files);
    const unchanged =
      entries.length === this.files.size &&
      entries.every(([path, content]) => this.files.get(path) === content);
    if (unchanged) return;
    this.files.clear();
    for (const [path, content] of entries) this.files.set(path, content);
    for (let step = 0; step < Math.max(1, this.files.size); step += 1) this.bump();
  }

  /** Controller-authorised artifact writers call this through the restricted draft proxy in
   *  `draft-authority.ts`, which admits `setArtifact` only while a registered artifact-writer is
   *  executing. The writer name and call id read as optional parameters and are refused when
   *  missing, because they are what ties the prepared bytes to the call that produced them: an
   *  answer arriving without that tie could have come from any generated code that reached the
   *  store, and the submission path would have nothing to attribute it to. */
  setArtifact(value: unknown, writerName?: string, callId?: string): ArtifactMaterializationRecord {
    if (writerName === undefined || writerName === "" || callId === undefined || callId === "") {
      throw new Error("preparing an answer requires an active controller-held writer identity");
    }
    const artifactJson = preparedArtifactJson(value);
    const record = {
      artifactJson,
      artifactDigest: sha256(artifactJson),
      sourceSeq: this._seq,
      writerName,
      callId,
    };
    this.materialization = record;
    return { ...record };
  }

  artifactMaterialization(): ArtifactMaterialization {
    if (this.materialization === null) return { state: "absent" };
    const record = { ...this.materialization };
    return record.sourceSeq === this._seq
      ? { state: "current", record }
      : { state: "stale", record, currentSeq: this._seq };
  }

  snapshot(): DraftSnapshot {
    return {
      state: this.stateSnapshot(),
      ...keysIf(this.files.size > 0, () => ({ files: this.fileSnapshot() })),
    };
  }

  fieldProblems(): string[] {
    return this.state.size === 0 && this.files.size === 0 ? ["the draft is empty — nothing was built."] : [];
  }

  /** Load content into a fresh store and restart its mutation sequence. A snapshot carries content
   *  and no history, so there is no sequence to inherit; `fromCheckpoint` is the path that has one
   *  and sets it afterwards, once it has checked that number against the content. */
  static fromSnapshot(snap?: DraftSnapshot | null): DraftStore {
    const draft = new DraftStore();
    if (!snap) return draft;
    for (const [key, value] of Object.entries(snap.state)) draft.setValue(key, value);
    for (const [path, content] of Object.entries(snap.files ?? {})) draft.setFile(path, content);
    draft._seq = 0; // loading a snapshot starts a new mutation sequence at zero
    return draft;
  }

  checkpoint(): DraftCheckpoint {
    return {
      schema: DRAFT_CHECKPOINT_SCHEMA,
      snapshot: this.snapshot(),
      seq: this._seq,
      materialization: this.materialization === null ? null : { ...this.materialization },
    };
  }

  /** Become a checkpoint, in place. The solver's tools are bound to one store for the whole case,
   *  so returning to an earlier candidate has to change this instance rather than build a new one
   *  and leave the tools writing into the old one. The checkpoint goes through `fromCheckpoint`
   *  first and this store is touched only after that returns, so a falsified checkpoint changes
   *  nothing. */
  adopt(cp: DraftCheckpoint): void {
    const restored = DraftStore.fromCheckpoint(cp);
    this.state.clear();
    for (const [key, value] of restored.state) this.state.set(key, value);
    this.files.clear();
    for (const [path, content] of restored.files) this.files.set(path, content);
    // Returning to an earlier candidate is itself a mutation, so the sequence moves forward rather
    // than back to the restored one. `generated-tool-result-routing.ts` refuses a checkpoint whose
    // sequence fell below the one it already accepted, so rewinding here turned an ordinary save,
    // explore and restore into a "checkpoint regressed" protocol non-result. The restored answer
    // keeps its standing across the move: what the sequence records about it is whether it is
    // current, not the number it happened to be current at.
    const restoredIsCurrent =
      restored.materialization !== null && restored.materialization.sourceSeq === restored._seq;
    this._seq = Math.max(this._seq, restored._seq) + 1;
    this.materialization =
      restored.materialization === null
        ? null
        : { ...restored.materialization, ...keysIf(restoredIsCurrent, () => ({ sourceSeq: this._seq })) };
  }

  /** Restore content and its sequence, refusing an inconsistent checkpoint or answer identity. */
  static fromCheckpoint(cp: DraftCheckpoint): DraftStore {
    // Read as a plain string, not as the literal the interface promises: this guard exists because
    // a checkpoint can be falsified, and a type saying the field is already the right literal would
    // narrow the comparison away as one that can never fail.
    const schema: string = cp.schema;
    if (schema !== DRAFT_CHECKPOINT_SCHEMA) {
      restoreRefused(`checkpoint schema "${schema}" != "${DRAFT_CHECKPOINT_SCHEMA}"`);
    }
    if (!Number.isInteger(cp.seq) || cp.seq < 0) {
      restoreRefused(
        "the checkpoint's sequence is not a non-negative integer — the checkpoint was falsified",
      );
    }
    const draft = DraftStore.fromSnapshot(cp.snapshot);
    // Every stored entry took at least one mutation to arrive, so a snapshot states its own minimum
    // sequence, and a checkpoint claiming fewer mutations than its content required was not built
    // by this class.
    const floor = Object.keys(cp.snapshot.state).length + Object.keys(cp.snapshot.files ?? {}).length;
    if (cp.seq < floor) {
      restoreRefused(
        `the checkpoint's sequence (${cp.seq}) is below the mutations its own snapshot required (${floor}) — the checkpoint was falsified`,
      );
    }
    draft._seq = cp.seq;
    if (cp.materialization !== null) {
      const record = cp.materialization;
      if (materializationMalformed(record, cp.seq)) restoreRefused("the prepared-answer record is malformed");
      let exact: string;
      try {
        exact = trustedJson(capturedJsonParse(record.artifactJson)).bytes;
      } catch {
        restoreRefused("the prepared-answer bytes are malformed");
      }
      if (exact !== record.artifactJson || sha256(exact) !== record.artifactDigest) {
        restoreRefused("the prepared-answer identity was falsified");
      }
      draft.materialization = { ...record };
    }
    return draft;
  }
}
