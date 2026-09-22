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
    expect(tools.map((tool) => tool.name)).toEqual(["read", "write", "edit", "materialize_files"]);
    expect(read.parameters).toHaveProperty("properties.offset");
    expect(write.parameters).toHaveProperty("properties.content");
    expect(edit.parameters).toHaveProperty("properties.edits");
    for (const tool of [read, write, edit]) {
      expect(tool.description).toContain(
        "the answer's `files` itself: name a file inside it without a leading `files/`.",
      );
    }
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
    await expect(write.execute("long-path", { path: "x".repeat(513), content: "x" })).rejects.toThrow();
    await expect(
      edit.execute("large-edit", {
        path: "a.txt",
        edits: [{ oldText: "é", newText: "é".repeat(ARTIFACT_JSON_MAX_BYTES / 2) }],
      }),
    ).rejects.toThrow();
    expect(draft.checkpoint()).toEqual(before);
    expect(
      publicArtifactSchemaFindings(schema, { files: { "a.txt": "é".repeat(ARTIFACT_JSON_MAX_BYTES / 2) } }),
    ).not.toEqual([]);
    draft.replaceFiles(
      Object.fromEntries(Array.from({ length: FILE_MAP_MAX_ENTRIES }, (_, i) => [`f${i}`, "x"])),
    );
    const full = draft.checkpoint();
    await expect(write.execute("overflow", { path: "extra", content: "x" })).rejects.toThrow();
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
    ).rejects.toThrow();
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

  it("restores exact sorted file state through the existing draft checkpoint", async () => {
    const draft = new DraftStore();
    const { write } = toolsFor(draft);
    await write.execute("z", { path: "z.txt", content: "last" });
    await write.execute("a", { path: "a.txt", content: "first" });
    const checkpoint = draft.checkpoint();
    const restored = DraftStore.fromCheckpoint(checkpoint);

    expect(restored.fileSnapshot()).toEqual({ "a.txt": "first", "z.txt": "last" });
    expect(restored.seq).toBe(draft.seq);
    const projection = restored.fileSnapshot();
    projection["a.txt"] = "falsified";
    expect(restored.getFile("a.txt")).toBe("first");
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

  it("rejects unsafe paths, non-string contents, collisions, and oversize maps", () => {
    const bad = (files: Record<string, JsonValue>) => publicArtifactSchemaFindings(openSchema, { files });
    expect(bad({ "../escape.txt": "x" })).not.toEqual([]);
    expect(bad({ "/absolute.txt": "x" })).not.toEqual([]);
    expect(bad({ "a\\b.txt": "x" })).not.toEqual([]);
    expect(bad({ "a\0b.txt": "x" })).not.toEqual([]);
    expect(bad({ "a//b.txt": "x" })).not.toEqual([]);
    expect(bad({ "./a.txt": "x" })).not.toEqual([]);
    expect(bad({ "": "x" })).not.toEqual([]);
    expect(bad({ "a.txt": 7 })).not.toEqual([]);
    expect(bad({ a: "file", "a/b.txt": "also under a" })).not.toEqual([]);
    const oversize = Object.fromEntries(
      Array.from({ length: FILE_MAP_MAX_ENTRIES + 1 }, (_, i) => [`f${i}.txt`, "x"]),
    );
    expect(bad(oversize)).not.toEqual([]);
    expect(bad({ ["x".repeat(600)]: "x" })).not.toEqual([]);
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

// Draft tools update DraftStore through its write methods, which advance seq. Reads
// return separate copies, so changing a returned value cannot change the stored value.
/** The inner object of the `{ nested: { count: 1 } }` each test below seeds, read through checks. */
const nested = (value: unknown): JsonObject =>
  required(asRecord(asRecord(value)?.["nested"]), "the seeded nested object");

describe("state values are private and clone-isolated", () => {
  it("getValue returns a clone: mutating it leaves the store and seq unchanged", () => {
    const store = new DraftStore();
    store.setValue("payload", { nested: { count: 1 } });
    const seqAfterWrite = store.seq;

    nested(store.getValue("payload"))["count"] = 999;

    expect(store.seq).toBe(seqAfterWrite);
    expect(store.getValue("payload")).toEqual({ nested: { count: 1 } });
  });

  it("setValue clones on write: mutating the caller's object afterwards does not reach the store", () => {
    const store = new DraftStore();
    const value = { nested: { count: 1 } };
    store.setValue("payload", value);
    const seqAfterWrite = store.seq;

    value.nested.count = 999;

    expect(store.seq).toBe(seqAfterWrite);
    expect(store.getValue("payload")).toEqual({ nested: { count: 1 } });
  });

  it("the old public attrs object is gone; both regions are Maps, so a key is never a prototype", () => {
    const store = new DraftStore();
    // Held as Maps rather than plain objects. `draft-authority.ts` proxies a null-prototype target
    // and answers only named members, so a generated tool reaches neither field. Both regions are
    // private, so the test reads them by name at runtime.
    expect(store).not.toHaveProperty("attrs");
    expect(store).toHaveProperty("state", expect.any(Map));
    expect(store).toHaveProperty("files", expect.any(Map));
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

  it("deleteValue reports whether it removed anything and only then advances seq", () => {
    const store = new DraftStore();
    store.setValue("k", 1);
    const seqAfterWrite = store.seq;

    expect(store.deleteValue("absent")).toBe(false);
    expect(store.seq).toBe(seqAfterWrite);
    expect(store.deleteValue("k")).toBe(true);
    expect(store.seq).toBe(seqAfterWrite + 1);
    expect(store.hasValue("k")).toBe(false);
  });
});

describe("files and state have separate storage with the same operations", () => {
  it("set, get, has and delete round-trip, and delete advances seq once", () => {
    const store = new DraftStore();
    store.setFile("src/main.ts", "export const x = 1;\n");
    expect(store.getFile("src/main.ts")).toBe("export const x = 1;\n");
    expect(store.hasFile("src/main.ts")).toBe(true);

    const seqBeforeDelete = store.seq;
    expect(store.deleteFile("absent.ts")).toBe(false);
    expect(store.seq).toBe(seqBeforeDelete);
    expect(store.deleteFile("src/main.ts")).toBe(true);
    expect(store.seq).toBe(seqBeforeDelete + 1);
    expect(store.getFile("src/main.ts")).toBeUndefined();
  });

  it("snapshot sorts both regions and omits files entirely while none exist", () => {
    const store = new DraftStore();
    store.setValue("zeta", 1);
    store.setValue("alpha", 2);
    expect(Object.keys(store.snapshot().state)).toEqual(["alpha", "zeta"]);
    expect(store.snapshot().files).toBeUndefined();
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

  it("replaceFiles swaps the whole map, so a removed file is representable", () => {
    const store = new DraftStore();
    store.setFile("keep.ts", "1");
    store.setFile("drop.ts", "2");

    store.replaceFiles({ "keep.ts": "1", "new.ts": "3" });

    expect(store.fileSnapshot()).toEqual({ "keep.ts": "1", "new.ts": "3" });
    expect(store.hasFile("drop.ts")).toBe(false);
  });

  it("replaceFiles advances seq once per resulting file, so no later checkpoint reads as falsified", () => {
    const store = new DraftStore();
    const before = store.seq;
    store.replaceFiles({ "a.ts": "1", "b.ts": "2", "c.ts": "3" });
    expect(store.seq).toBe(before + 3);

    // fromCheckpoint requires seq to cover the file count, including after a whole-map write.
    const restored = DraftStore.fromCheckpoint(store.checkpoint());
    expect(restored.fileSnapshot()).toEqual(store.fileSnapshot());
    expect(restored.seq).toBe(store.seq);
  });

  it("emptying the file map still advances seq once", () => {
    const store = new DraftStore();
    store.setFile("a.ts", "1");
    const before = store.seq;
    store.replaceFiles({});
    expect(store.seq).toBe(before + 1);
    expect(store.fileSnapshot()).toEqual({});
  });

  it("an identical map leaves seq unchanged, so a prepared answer stays current", () => {
    const store = new DraftStore();
    store.replaceFiles({ "a.ts": "1" });
    store.setArtifact({ files: store.fileSnapshot() }, "finish", "call");
    const before = store.seq;

    store.replaceFiles({ "a.ts": "1" });

    expect(store.seq).toBe(before);
    expect(store.artifactMaterialization().state).toBe("current");
  });
});

describe("snapshot is deeply isolated", () => {
  it("mutating nested snapshot values never reaches back into the store", () => {
    const store = new DraftStore();
    store.setValue("root", { nested: { count: 1 } });
    store.setFile("a.txt", "one");
    const seqAfterWrite = store.seq;

    const snap = store.snapshot();
    nested(snap.state.root)["count"] = 999;
    if (snap.files) snap.files["a.txt"] = "tampered";

    expect(store.seq).toBe(seqAfterWrite);
    const fresh = store.snapshot();
    expect(nested(fresh.state.root)["count"]).toBe(1);
    expect(fresh.files?.["a.txt"]).toBe("one");
  });
});

describe("restart equivalence", () => {
  it("a fresh store restored from a snapshot produces identical output and behaviour", () => {
    const store = new DraftStore();
    store.setValue("root", { label: "draft" });
    store.setValue("count", 2);
    store.setFile("src/main.ts", "export const x = 1;\n");

    const restarted = DraftStore.fromSnapshot(store.snapshot());
    expect(restarted.snapshot()).toEqual(store.snapshot());

    store.setValue("extra", 3);
    restarted.setValue("extra", 3);
    expect(restarted.snapshot()).toEqual(store.snapshot());
  });

  it("mutating the snapshot object after restoration does not reach the freshly built store", () => {
    const store = new DraftStore();
    store.setValue("root", { nested: { count: 1 } });
    store.setFile("a.txt", "one");

    const snap: DraftSnapshot = store.snapshot();
    const restarted = DraftStore.fromSnapshot(snap);

    nested(snap.state.root)["count"] = 999;
    if (snap.files) snap.files["a.txt"] = "tampered";

    const restartedSnap = restarted.snapshot();
    expect(nested(restartedSnap.state.root)["count"]).toBe(1);
    expect(restartedSnap.files?.["a.txt"]).toBe("one");
  });

  it("restoring a snapshot starts the sequence number at zero — no hidden closure state survives restart", () => {
    const store = new DraftStore();
    store.setValue("a", 1);
    store.setFile("b.txt", "2");
    expect(store.seq).toBeGreaterThan(0);

    const restarted = DraftStore.fromSnapshot(store.snapshot());
    expect(restarted.seq).toBe(0);
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

  it("refuses an answer prepared without a controller-held writer identity", () => {
    const store = new DraftStore();
    expect(() => store.setArtifact({ answer: 1 })).toThrow(/writer identity/);
    expect(() => store.setArtifact({ answer: 1 }, "finish", "")).toThrow(/writer identity/);
    expect(store.artifactMaterialization()).toEqual({ state: "absent" });
  });

  it("refuses an artifact larger than the worker protocol can carry", () => {
    const store = new DraftStore();
    expect(() => store.setArtifact({ value: "x".repeat(1024 * 1024) }, "finish", "large")).toThrow(
      /byte limit/,
    );
    expect(store.artifactMaterialization()).toEqual({ state: "absent" });
  });
});

// Checkpoint restoration (PF-06 s4.1 DraftAuthorityCheckpoint) restores the sequence number
// as well as the draft values, so subsequent edits continue from the saved version.
// A plain snapshot omits seq; the fromSnapshot test above checks that it starts at zero.
describe("draft checkpoint restores the sequence number (plan-pack restart-equivalence)", () => {
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

  it("restore refuses a falsified clock: negative, non-integer, or fewer ticks than the snapshot required", () => {
    const store = new DraftStore();
    store.setValue("meta", 1);
    store.setFile("a.ts", "1");
    store.setFile("b.ts", "2");
    const cp = store.checkpoint();
    expect(() => DraftStore.fromCheckpoint({ ...cp, seq: -1 })).toThrow(/falsified/);
    expect(() => DraftStore.fromCheckpoint({ ...cp, seq: 1.5 })).toThrow(/falsified/);
    expect(() => DraftStore.fromCheckpoint({ ...cp, seq: 2 })).toThrow(/falsified/); // floor is 3
  });

  it("the mutation floor counts both regions, so files cannot be smuggled past a low clock", () => {
    const store = new DraftStore();
    store.setValue("k", 1);
    store.replaceFiles({ "a.ts": "1", "b.ts": "2" });
    expect(store.seq).toBe(3);
    expect(() => DraftStore.fromCheckpoint({ ...store.checkpoint(), seq: 2 })).toThrow(/falsified/);
  });
});
