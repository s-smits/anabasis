import { type JsonObject, type JsonValue, asRecord } from "../src/meta/json-shape.ts";
import { describe, expect, it } from "bun:test";
import {
  ARTIFACT_JSON_MAX_BYTES,
  DraftStore,
  type DraftCheckpoint,
  type DraftSnapshot,
  fileMapDigest,
} from "../src/solve/draft-store.ts";
import { FILE_MAP_MAX_ENTRIES } from "../src/solve/file-map.ts";
import {
  compilePublicArtifactSchema,
  publicArtifactSchemaFindings,
  validatePublicArtifactSchema,
} from "../src/solve/public-artifact-schema.ts";
import { required } from "./helpers/doubles.ts";

describe("the declared open file map", () => {
  const openSchema = compilePublicArtifactSchema(
    [{ name: "files", fileMap: true }],
    [{ files: { "example.txt": "example" } }],
  );

  it("compiles to one open file-map node instead of a closed filename union", () => {
    expect(openSchema.root.properties.files).toEqual({ kind: "file-map" });
    const artifact = {
      files: {
        "src/main.cpp": "int main() {}",
        "include/config.hpp": "#pragma once",
        "platformio.ini": "[env]",
      },
    };
    expect(publicArtifactSchemaFindings(openSchema, artifact)).toEqual([]);
  });

  it("survives the recorded-schema round trip", () => {
    expect(validatePublicArtifactSchema(JSON.parse(JSON.stringify(openSchema)))).toEqual(openSchema);
  });

  it.each<[string, Record<string, JsonValue>]>([
    ['a path with a "." or ".." segment', { "../escape.txt": "x" }],
    ['a path with a "." or ".." segment', { "./a.txt": "x" }],
    ["an absolute path", { "/absolute.txt": "x" }],
    ["a path with NUL or backslash", { "a\\b.txt": "x" }],
    ["a path with NUL or backslash", { "a\0b.txt": "x" }],
    ["a path with an empty segment", { "a//b.txt": "x" }],
    ["an empty path", { "": "x" }],
    ["a path longer than 512 characters", { ["x".repeat(600)]: "x" }],
    ["number", { "a.txt": 7 }],
    ["a file whose path is also a directory of another file", { a: "file", "a/b.txt": "also under a" }],
    [
      `${FILE_MAP_MAX_ENTRIES + 1} files`,
      Object.fromEntries(Array.from({ length: FILE_MAP_MAX_ENTRIES + 1 }, (_, i) => [`f${i}.txt`, "x"])),
    ],
    [
      "the prepared answer exceeds its public byte limit",
      { "a.txt": "é".repeat(ARTIFACT_JSON_MAX_BYTES / 2) },
    ],
  ])("refuses a file map holding %s", (actual, files) => {
    expect(publicArtifactSchemaFindings(openSchema, { files })).toEqual([
      expect.objectContaining({ actual }),
    ]);
  });

  it("refuses a fileMap declaration that is not the literal true", () => {
    expect(() =>
      compilePublicArtifactSchema(
        // @ts-expect-error — the field type pins the literal true; the compiler and the compiler-free
        // caller must both refuse the string
        [{ name: "files", fileMap: "yes" }],
        [{ files: { "a.txt": "a" } }],
      ),
    ).toThrow(/fileMap must be the literal true/);
  });

  it("refuses a fileMap field that also declares allowedValues", () => {
    expect(() =>
      compilePublicArtifactSchema(
        [{ name: "files", fileMap: true, allowedValues: ["a"] }],
        [{ files: { "a.txt": "a" } }],
      ),
    ).toThrow(/cannot declare both fileMap and allowedValues/);
  });

  it("refuses an accept control whose file map carries an unsafe path", () => {
    expect(() =>
      compilePublicArtifactSchema([{ name: "files", fileMap: true }], [{ files: { "../a.txt": "a" } }]),
    ).toThrow(/violates the declared schema/);
  });
});

/** The inner object of the `{ nested: { count: 1 } }` each store below is seeded with. */
const nested = (value: unknown): JsonObject =>
  required(asRecord(asRecord(value)?.["nested"]), "the seeded nested object");

/** A store holding one nested value and one file: two writes, so seq 2. */
function seeded(value: JsonObject = { nested: { count: 1 } }): DraftStore {
  const store = new DraftStore();
  store.setValue("root", value);
  store.setFile("a.txt", "one");
  return store;
}

function tap(store: DraftStore, act: (store: DraftStore) => void): DraftStore {
  act(store);
  return store;
}

/** Tamper with a snapshot the way a generated tool holding one could. */
function tamper(snap: DraftSnapshot): void {
  nested(snap.state.root)["count"] = 999;
  if (snap.files) snap.files["a.txt"] = "tampered";
}

// Draft tools reach the store only through its write methods, which advance seq; every read hands
// back a copy, so changing what a read returned changes neither the stored value nor the clock.
describe("the draft store keeps its values private", () => {
  it.each<[string, () => DraftStore, number]>([
    [
      "a value read back",
      () => tap(seeded(), (store) => void (nested(store.getValue("root"))["count"] = 999)),
      2,
    ],
    [
      "the caller's object after writing it",
      () => {
        const value = { nested: { count: 1 } };
        return tap(seeded(value), () => void (value.nested.count = 999));
      },
      2,
    ],
    ["a snapshot", () => tap(seeded(), (store) => tamper(store.snapshot())), 2],
    [
      "a file projection",
      () => tap(seeded(), (store) => void (store.fileSnapshot()["a.txt"] = "tampered")),
      2,
    ],
    // A restored store starts its clock at zero: no closure state survives a restart.
    [
      "the snapshot a store was restored from",
      () => {
        const snap = seeded().snapshot();
        return tap(DraftStore.fromSnapshot(snap), () => tamper(snap));
      },
      0,
    ],
  ])("never lets %s reach back into the store", (_, tampered, seq) => {
    const store = tampered();
    expect(store.snapshot()).toEqual({
      state: { root: { nested: { count: 1 } } },
      files: { "a.txt": "one" },
    });
    expect(store.seq).toBe(seq);
  });

  it("keeps prototype-shaped keys as data and never reads an inherited property", () => {
    const store = new DraftStore();
    store.setValue("__proto__", { store: true });
    store.setValue("constructor", { store: "constructor" });
    store.setFile("__proto__", "file body");

    const state = store.stateSnapshot();
    expect(Object.getOwnPropertyDescriptor(state, "__proto__")?.value).toEqual({ store: true });
    expect(Object.getOwnPropertyDescriptor(state, "constructor")?.value).toEqual({
      store: "constructor",
    });
    expect(store.getFile("__proto__")).toBe("file body");

    // oxlint-disable-next-line eslint/no-extend-native -- polluting the prototype is the subject: the store must ignore an inherited property, and the finally below removes it.
    Object.defineProperty(Object.prototype, "draftStoreInherited", {
      value: "not-a-store-value",
      configurable: true,
    });
    try {
      expect(store.getValue("draftStoreInherited")).toBeUndefined();
      expect(store.hasValue("draftStoreInherited")).toBe(false);
      expect(store.deleteValue("draftStoreInherited")).toBe(false);
      expect(store.hasFile("draftStoreInherited")).toBe(false);
    } finally {
      Reflect.deleteProperty(Object.prototype, "draftStoreInherited");
    }
  });
});

describe("files and state have separate storage with the same operations", () => {
  it.each([
    [
      "state",
      (s: DraftStore) => s.setValue("k", 1),
      (s: DraftStore) => s.hasValue("k"),
      (s: DraftStore, key: string) => s.deleteValue(key),
    ],
    [
      "file",
      (s: DraftStore) => s.setFile("k", "1"),
      (s: DraftStore) => s.hasFile("k"),
      (s: DraftStore, key: string) => s.deleteFile(key),
    ],
  ] as const)(
    "a %s delete reports whether it removed anything and only then advances seq",
    (_, set, has, remove) => {
      const store = new DraftStore();
      set(store);
      expect(has(store)).toBe(true);
      const seqAfterWrite = store.seq;
      expect(remove(store, "absent")).toBe(false);
      expect(store.seq).toBe(seqAfterWrite);
      expect(remove(store, "k")).toBe(true);
      expect(store.seq).toBe(seqAfterWrite + 1);
      expect(has(store)).toBe(false);
    },
  );

  it("snapshot sorts both regions and omits files entirely while none exist", () => {
    const store = new DraftStore();
    store.setValue("zeta", 1);
    store.setValue("alpha", 2);
    expect(Object.keys(store.snapshot().state)).toEqual(["alpha", "zeta"]);
    expect(JSON.stringify(store.snapshot())).not.toContain("files");

    store.setFile("b.txt", "b");
    store.setFile("a.txt", "a");
    expect(Object.keys(store.snapshot().files ?? {})).toEqual(["a.txt", "b.txt"]);
  });

  it("file-map identity is canonical and contains no file payload", () => {
    const first = fileMapDigest({ "b.txt": "b", "a.txt": "a" });
    expect(first).toBe(fileMapDigest({ "a.txt": "a", "b.txt": "b" }));
    expect(first).not.toBe(fileMapDigest({ "a.txt": "changed", "b.txt": "b" }));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  // One tick per resulting file keeps a later checkpoint above its mutation floor; an identical map
  // ticks nothing, so an answer prepared from it stays current.
  it.each<[string, Record<string, string>, Record<string, string>, number]>([
    ["a whole new map", { "keep.ts": "1", "drop.ts": "2" }, { "keep.ts": "1", "a.ts": "1", "b.ts": "2" }, 3],
    ["an empty map", { "a.ts": "1" }, {}, 1],
    ["an identical map", { "a.ts": "1" }, { "a.ts": "1" }, 0],
  ])("replaceFiles with %s swaps the whole map and ticks once per resulting file", (_, from, to, ticks) => {
    const store = new DraftStore();
    store.replaceFiles(from);
    store.setArtifact({ files: store.fileSnapshot() }, "finish", "call");
    const before = store.seq;
    store.replaceFiles(to);
    expect(store.fileSnapshot()).toEqual(to);
    expect(store.seq).toBe(before + ticks);
    expect(store.artifactMaterialization().state).toBe(ticks === 0 ? "current" : "stale");
    expect(DraftStore.fromCheckpoint(store.checkpoint()).fileSnapshot()).toEqual(to);
  });
});

describe("restart equivalence", () => {
  it("a fresh store restored from a snapshot produces identical output and behaviour", () => {
    const store = seeded();
    const restarted = DraftStore.fromSnapshot(store.snapshot());
    expect(restarted.snapshot()).toEqual(store.snapshot());

    store.setValue("extra", 3);
    restarted.setValue("extra", 3);
    expect(restarted.snapshot()).toEqual(store.snapshot());
  });

  it("restoring a null snapshot gives an empty store with a field problem", () => {
    const draft = DraftStore.fromSnapshot(null);
    expect(draft.snapshot()).toEqual({ state: {} });
    expect(draft.fieldProblems()).toHaveLength(1);
    draft.setFile("only.txt", "content");
    expect(draft.fieldProblems()).toEqual([]);
  });
});

describe("explicit answer preparation", () => {
  it("stores canonical exact bytes and becomes stale after a later ordinary mutation", () => {
    const store = new DraftStore();
    store.setValue("private-progress", { turns: 4 });
    const record = store.setArtifact({ zeta: 2, alpha: 1 }, "finish", "call-1");
    expect(record.artifactJson).toBe('{"alpha":1,"zeta":2}');
    expect(store.artifactMaterialization()).toMatchObject({ state: "current", record });
    store.setValue("private-progress", { turns: 5 });
    expect(store.artifactMaterialization()).toMatchObject({
      state: "stale",
      record: { sourceSeq: 1, writerName: "finish", callId: "call-1" },
      currentSeq: 2,
    });
  });

  it("a file write makes a prepared answer stale, exactly as a state write does", () => {
    const store = new DraftStore();
    store.setArtifact({ answer: 1 }, "finish", "call");
    expect(store.artifactMaterialization().state).toBe("current");
    store.setFile("late.ts", "written after recording");
    expect(store.artifactMaterialization().state).toBe("stale");
  });

  it("permits an explicitly prepared empty JSON answer", () => {
    const store = new DraftStore();
    store.setArtifact({}, "finish", "empty");
    expect(store.artifactMaterialization()).toMatchObject({
      state: "current",
      record: { artifactJson: "{}", sourceSeq: 0 },
    });
  });

  it.each<[string, (store: DraftStore) => void, RegExp]>([
    ["no writer", (store) => store.setArtifact({ answer: 1 }), /writer identity/],
    ["an empty call id", (store) => store.setArtifact({ answer: 1 }, "finish", ""), /writer identity/],
    [
      "more bytes than the worker protocol carries",
      (store) => store.setArtifact({ value: "x".repeat(1024 * 1024) }, "finish", "large"),
      /byte limit/,
    ],
  ])("refuses an answer prepared with %s and records none", (_, prepare, refusal) => {
    const store = new DraftStore();
    expect(() => prepare(store)).toThrow(refusal);
    expect(store.artifactMaterialization()).toEqual({ state: "absent" });
  });
});

// A checkpoint, unlike a snapshot, carries the sequence number, so edits after a restore continue
// from the saved version and a prepared answer keeps its identity.
describe("draft checkpoint restores the sequence number", () => {
  it("fromCheckpoint restores state and seq, then later edits increase seq", () => {
    const store = new DraftStore();
    store.setValue("root", { label: "draft" });
    store.setFile("main.ts", "1");
    store.setValue("root", { label: "draft", revised: true }); // extra tick past the floor
    store.setArtifact({ root: { label: "draft" } }, "finish", "checkpoint");
    const restored = DraftStore.fromCheckpoint(store.checkpoint());
    expect(restored.snapshot()).toEqual(store.snapshot());
    expect(restored.seq).toBe(store.seq);

    restored.setValue("next", 1);
    expect(restored.seq).toBe(store.seq + 1);
  });

  it("snapshot serializes draft values without a seq key", () => {
    const store = new DraftStore();
    store.setValue("root", 1);
    // A snapshot remains clock-free; prepared-answer identity lives in the checkpoint.
    expect(JSON.stringify(store.snapshot())).not.toContain('"seq"');
    expect(Object.keys(store.checkpoint())).toContain("seq");
  });

  it("restore refuses a checkpoint whose schema is unknown", () => {
    const cp = new DraftStore().checkpoint();
    // @ts-expect-error — the checkpoint type pins the current schema; restore must refuse the old one
    const falsified: DraftCheckpoint = { ...cp, schema: "draft-checkpoint/v0" };
    expect(() => DraftStore.fromCheckpoint(falsified)).toThrow(/schema/);
  });

  it("restore refuses falsified prepared-answer bytes and identity", () => {
    const store = new DraftStore();
    store.setValue("root", 1);
    store.setArtifact({ root: 1 }, "finish", "call");
    const cp = store.checkpoint();
    // Bound before the closure: a property narrowing does not survive into a nested function,
    // while this const does, so the falsified record keeps its type with no assertion.
    const { materialization } = cp;
    if (materialization === null) throw new Error("expected a prepared answer");
    expect(() =>
      DraftStore.fromCheckpoint({
        ...cp,
        materialization: { ...materialization, artifactJson: '{"root":2}' },
      }),
    ).toThrow(/falsified/);
  });

  // The floor counts both regions, so files cannot be smuggled past a low clock: one value and two
  // files make it 3.
  it.each([-1, 1.5, 2])("restore refuses the falsified clock %p", (seq) => {
    const store = new DraftStore();
    store.setValue("meta", 1);
    store.replaceFiles({ "a.ts": "1", "b.ts": "2" });
    expect(store.seq).toBe(3);
    expect(() => DraftStore.fromCheckpoint({ ...store.checkpoint(), seq })).toThrow(/falsified/);
  });
});
