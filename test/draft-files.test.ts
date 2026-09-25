import { type JsonObject, type JsonValue, asRecord } from "../src/meta/json-shape.ts";
import { describe, expect, it } from "bun:test";
import { createDraftFileTools } from "../src/solve/draft-files.ts";
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

const FILE_SCHEMA = compilePublicArtifactSchema([{ name: "files" }], [{ files: { "a.txt": "value" } }]);

function toolsFor(draft: DraftStore, schema = FILE_SCHEMA) {
  const tools = createDraftFileTools(draft, schema);
  const find = (name: string) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`missing ${name}`);
    return tool;
  };
  return {
    tools,
    read: find("read"),
    write: find("write"),
    edit: find("edit"),
    materialize: find("materialize_files"),
  };
}

function text(result: Awaited<ReturnType<ReturnType<typeof toolsFor>["read"]["execute"]>>): string {
  return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

describe("the optional DraftStore-backed Pi files preset", () => {
  it("uses Pi's direct schemas and batched edit coercion without registering bash", () => {
    const { tools, read, write, edit } = toolsFor(new DraftStore());
    expect(tools.map((tool) => tool.name)).not.toContain("bash");
    expect(read.parameters).toHaveProperty("properties.offset");
    expect(write.parameters).toHaveProperty("properties.content");
    expect(edit.parameters).toHaveProperty("properties.edits");
    expect(edit.prepareArguments?.({ path: "a.txt", oldText: "a", newText: "b" })).toMatchObject({
      edits: [{ oldText: "a", newText: "b" }],
    });
  });

  it("explicitly prepares an empty file projection with exact trusted bytes", async () => {
    const draft = new DraftStore();
    const emptySchema = compilePublicArtifactSchema([{ name: "files" }], [{ files: {} }]);
    const { materialize } = toolsFor(draft, emptySchema);
    await materialize.execute("empty-files", {});
    expect(draft.artifactMaterialization()).toMatchObject({
      state: "current",
      record: {
        artifactJson: '{"files":{}}',
        writerName: "materialize_files",
        callId: "empty-files",
      },
    });
  });

  it("accepts an object-only union produced by varying file names", () => {
    const schema = compilePublicArtifactSchema(
      [{ name: "files" }],
      [{ files: { "a.txt": "a" } }, { files: { "b.txt": "b" } }],
    );
    expect(() => toolsFor(new DraftStore(), schema)).not.toThrow();
  });

  it("writes, paginates, and applies Pi's exact batched edits through one draft", async () => {
    const draft = new DraftStore();
    const { read, write, edit } = toolsFor(draft);
    await write.execute("write", { path: "src/a.txt", content: "one\ntwo\nthree" });
    const page = await read.execute("read", { path: "src/a.txt", offset: 2, limit: 1 });
    expect(text(page)).toContain("two");
    expect(text(page)).toContain("Use offset=3");

    const edited = await edit.execute("edit", {
      path: "src/a.txt",
      edits: [
        { oldText: "one", newText: "ONE" },
        { oldText: "three", newText: "THREE" },
      ],
    });
    expect(draft.getFile("src/a.txt")).toBe("ONE\ntwo\nTHREE");
    expect(edited.details).toMatchObject({ firstChangedLine: 1 });
    expect(edited.details?.patch).toContain("-one");
    expect(draft.seq).toBe(2);
  });

  it("rejects files over the limits before mutation and keeps the previous prepared answer current", async () => {
    const schema = compilePublicArtifactSchema([{ name: "files", fileMap: true }], [{ files: {} }]);
    const draft = new DraftStore();
    const { write, edit } = toolsFor(draft, schema);
    await write.execute("seed", { path: "a.txt", content: "é" });
    const before = draft.checkpoint();
    await expect(write.execute("long-path", { path: "x".repeat(513), content: "x" })).rejects.toThrow(
      /a path longer than 512 characters/,
    );
    // Pi's edit tool reports only "Error code: unknown"; the byte-limit refusal travels as the cause.
    await expect(
      edit.execute("large-edit", {
        path: "a.txt",
        edits: [{ oldText: "é", newText: "é".repeat(ARTIFACT_JSON_MAX_BYTES / 2) }],
      }),
    ).rejects.toMatchObject({ cause: { message: "the prepared answer exceeds its public byte limit" } });
    expect(draft.checkpoint()).toEqual(before);
    draft.replaceFiles(
      Object.fromEntries(Array.from({ length: FILE_MAP_MAX_ENTRIES }, (_, i) => [`f${i}`, "x"])),
    );
    const full = draft.checkpoint();
    await expect(write.execute("overflow", { path: "extra", content: "x" })).rejects.toThrow(
      `expected at most ${FILE_MAP_MAX_ENTRIES} files`,
    );
    expect(draft.checkpoint()).toEqual(full);
    await write.execute("replace", { path: "f0", content: "updated" });
    expect(draft.getFile("f0")).toBe("updated");
  });

  it("carries cancellation through Pi's context before a file mutation", async () => {
    const draft = new DraftStore();
    const { write } = toolsFor(draft);
    const controller = new AbortController();
    controller.abort();
    await expect(
      write.execute("cancelled", { path: "a.txt", content: "x" }, controller.signal),
    ).rejects.toThrow(/abort/i);
    expect(draft.seq).toBe(0);
    expect(draft.getFile("a.txt")).toBeUndefined();
  });

  it("refuses host paths and traversal before any state mutation", async () => {
    const draft = new DraftStore();
    const { write } = toolsFor(draft);
    await expect(write.execute("absolute", { path: "/etc/passwd", content: "x" })).rejects.toMatchObject({
      code: "permission_denied",
    });
    await expect(write.execute("traversal", { path: "../outside", content: "x" })).rejects.toMatchObject({
      code: "permission_denied",
    });
    await expect(write.execute("backslash", { path: "..\\outside", content: "x" })).rejects.toMatchObject({
      code: "invalid",
    });
    expect(draft.fileSnapshot()).toEqual({});
    expect(draft.seq).toBe(0);
  });

  it("refuses impossible file and directory collisions", async () => {
    const first = new DraftStore();
    const { write: firstWrite } = toolsFor(first);
    await firstWrite.execute("file", { path: "a", content: "file" });
    await expect(firstWrite.execute("child", { path: "a/b.txt", content: "child" })).rejects.toMatchObject({
      code: "not_directory",
    });
    expect(first.fileSnapshot()).toEqual({ a: "file" });

    const second = new DraftStore();
    const { write: secondWrite } = toolsFor(second);
    await secondWrite.execute("child", { path: "a/b.txt", content: "child" });
    await expect(secondWrite.execute("parent", { path: "a", content: "file" })).rejects.toMatchObject({
      code: "is_directory",
    });
    expect(second.fileSnapshot()).toEqual({ "a/b.txt": "child" });
  });

  it("keeps a failed edit atomic and applies sequential same-file mutations", async () => {
    const draft = new DraftStore();
    const { write, edit } = toolsFor(draft);
    await write.execute("seed", { path: "a.txt", content: "alpha" });
    const before = draft.seq;
    await expect(
      edit.execute("missing", {
        path: "a.txt",
        edits: [{ oldText: "absent", newText: "x" }],
      }),
    ).rejects.toThrow(/Could not find the exact text in a.txt/);
    expect(draft.getFile("a.txt")).toBe("alpha");
    expect(draft.seq).toBe(before);

    await edit.execute("queued-edit", {
      path: "a.txt",
      edits: [{ oldText: "alpha", newText: "beta" }],
    });
    await write.execute("queued-write", { path: "a.txt", content: "final" });
    expect(draft.getFile("a.txt")).toBe("final");
    expect(draft.seq).toBe(before + 2);
  });

  it("replaces Pi's unavailable bash advice", async () => {
    const draft = new DraftStore();
    const { read, write } = toolsFor(draft);
    await write.execute("long", { path: "long.txt", content: "x".repeat(60 * 1024) });
    const result = text(await read.execute("read-long", { path: "long.txt" }));
    expect(result).toContain("Use write to replace the file with shorter lines");
    expect(result).not.toContain("Use bash");

    await write.execute("literal", {
      path: "literal.txt",
      content: "prefix Use bash: harmless text] suffix",
    });
    expect(text(await read.execute("read-literal", { path: "literal.txt" }))).toBe(
      "prefix Use bash: harmless text] suffix",
    );
  });
});

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

  it("lets the files preset write filenames absent from every control", async () => {
    const draft = new DraftStore();
    const { write } = toolsFor(draft, openSchema);
    await write.execute("new-name", { path: "src/main.cpp", content: "int main() {}" });
    const record = draft.artifactMaterialization();
    if (record.state !== "current") throw new Error(`materialization is ${record.state}`);
    const artifact = JSON.parse(record.record.artifactJson);
    expect(publicArtifactSchemaFindings(openSchema, artifact)).toEqual([]);
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
