/**
 * The files preset: Pi's own read, write and edit tools with the DraftStore as their file system.
 *
 * Every case drives the tools a solver is handed, so what is pinned is the outcome a solver sees:
 * the roster and its schemas, the one draft every mutation lands in, the bounds a write cannot
 * cross, and the text each refusal arrives as.
 */
import { describe, expect, it } from "bun:test";
import { createDraftFileTools } from "../src/solve/draft-files.ts";
import { ARTIFACT_JSON_MAX_BYTES, DraftStore } from "../src/solve/draft-store.ts";
import { FILE_MAP_MAX_ENTRIES } from "../src/solve/file-map.ts";
import {
  compilePublicArtifactSchema,
  publicArtifactSchemaFindings,
} from "../src/solve/public-artifact-schema.ts";

const FILE_SCHEMA = compilePublicArtifactSchema([{ name: "files" }], [{ files: { "a.txt": "value" } }]);
const OPEN_SCHEMA = compilePublicArtifactSchema(
  [{ name: "files", fileMap: true }],
  [{ files: { "example.txt": "example" } }],
);

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

describe("the files preset's roster", () => {
  it("is Pi's read, write and edit with their schemas, plus materialize_files and no shell", () => {
    const { tools, read, write, edit } = toolsFor(new DraftStore());
    expect(tools.map((tool) => tool.name)).toEqual(["read", "write", "edit", "materialize_files"]);
    expect(read.parameters).toHaveProperty("properties.offset");
    expect(write.parameters).toHaveProperty("properties.content");
    expect(edit.parameters).toHaveProperty("properties.edits");
    // Pi's coercion of the legacy single-edit shape still reaches the solver's calls.
    expect(edit.prepareArguments?.({ path: "a.txt", oldText: "a", newText: "b" })).toMatchObject({
      edits: [{ oldText: "a", newText: "b" }],
    });
    for (const tool of [read, write, edit]) expect(tool.description).toContain("draft file root");
  });

  it("accepts an object-only union produced by varying file names", () => {
    const schema = compilePublicArtifactSchema(
      [{ name: "files" }],
      [{ files: { "a.txt": "a" } }, { files: { "b.txt": "b" } }],
    );
    expect(() => toolsFor(new DraftStore(), schema)).not.toThrow();
  });
});

describe("one draft behind every tool", () => {
  it("writes, pages and applies batched edits, one sequence step per mutation", async () => {
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

  it("names a file by the root's own absolute path as well as relatively", async () => {
    const draft = new DraftStore();
    const { read, write } = toolsFor(draft);
    await write.execute("absolute", { path: "/draft/b.txt", content: "bee" });
    expect(draft.getFile("b.txt")).toBe("bee");
    expect(text(await read.execute("read", { path: "b.txt" }))).toBe("bee");
  });

  it("keeps a failed edit atomic and applies sequential same-file mutations", async () => {
    const draft = new DraftStore();
    const { write, edit } = toolsFor(draft);
    await write.execute("seed", { path: "a.txt", content: "alpha" });
    const before = draft.seq;
    await expect(
      edit.execute("missing", { path: "a.txt", edits: [{ oldText: "absent", newText: "x" }] }),
    ).rejects.toThrow(/Could not find the exact text in a.txt/);
    expect(draft.getFile("a.txt")).toBe("alpha");
    expect(draft.seq).toBe(before);

    await edit.execute("queued-edit", { path: "a.txt", edits: [{ oldText: "alpha", newText: "beta" }] });
    await write.execute("queued-write", { path: "a.txt", content: "final" });
    expect(draft.getFile("a.txt")).toBe("final");
    expect(draft.seq).toBe(before + 2);
  });

  it("materializes after each mutation, so an open file map takes names no control used", async () => {
    const draft = new DraftStore();
    const { write } = toolsFor(draft, OPEN_SCHEMA);
    await write.execute("new-name", { path: "src/main.cpp", content: "int main() {}" });
    const record = draft.artifactMaterialization();
    if (record.state !== "current") throw new Error(`materialization is ${record.state}`);
    expect(record.record).toMatchObject({ writerName: "write", callId: "new-name" });
    expect(publicArtifactSchemaFindings(OPEN_SCHEMA, JSON.parse(record.record.artifactJson))).toEqual([]);
  });

  it("prepares an empty file projection with exact trusted bytes on request", async () => {
    const draft = new DraftStore();
    const emptySchema = compilePublicArtifactSchema([{ name: "files" }], [{ files: {} }]);
    const { materialize } = toolsFor(draft, emptySchema);
    await materialize.execute("empty-files", {});
    expect(draft.artifactMaterialization()).toMatchObject({
      state: "current",
      record: { artifactJson: '{"files":{}}', writerName: "materialize_files", callId: "empty-files" },
    });
  });
});

describe("what a write cannot do", () => {
  it("crosses no answer bound, and the refusal arrives as the bound's own words", async () => {
    const schema = compilePublicArtifactSchema([{ name: "files", fileMap: true }], [{ files: {} }]);
    const draft = new DraftStore();
    const { write, edit } = toolsFor(draft, schema);
    await write.execute("seed", { path: "a.txt", content: "é" });
    const before = draft.checkpoint();
    await expect(write.execute("long-path", { path: "x".repeat(513), content: "x" })).rejects.toThrow(
      /a path longer than 512 characters/,
    );
    // The edit tool passes its file access's refusal through, so the solver reads the reason itself
    // rather than a bare error code.
    await expect(
      edit.execute("large-edit", {
        path: "a.txt",
        edits: [{ oldText: "é", newText: "é".repeat(ARTIFACT_JSON_MAX_BYTES / 2) }],
      }),
    ).rejects.toThrow("the prepared answer exceeds its public byte limit");
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

  it("runs after its call was cancelled", async () => {
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

  it("reaches a host path, leaves the root, or spells a path with backslashes", async () => {
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

  it("makes a file where a directory is, or under a file", async () => {
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
});

describe("what a refusal says", () => {
  it("names a missing file to read or edit with its code", async () => {
    const { read, edit } = toolsFor(new DraftStore());
    await expect(read.execute("read", { path: "missing.txt" })).rejects.toMatchObject({ code: "not_found" });
    // Pi's edit tool reports the code its file access raised.
    await expect(
      edit.execute("edit", { path: "missing.txt", edits: [{ oldText: "a", newText: "b" }] }),
    ).rejects.toThrow("Could not edit file: missing.txt. Error code: not_found.");
  });

  it("replaces Pi's bash advice for an over-long line, which the draft tools cannot follow", async () => {
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
