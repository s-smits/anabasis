import { expect, test } from "bun:test";
import type { FileRef } from "../src/models.js";
import { evidencePage, readEvidencePage } from "../src/server/evidence.js";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";

function file(index: number): FileRef {
  return {
    path: `campaigns/project/controller/run/${String(index).padStart(5, "0")}.json`,
    category: index % 2 === 0 ? "trace" : "other",
    bytes: 1,
    modifiedAt: "2026-09-09",
    content: "json",
    protected: false,
  };
}

test("evidence reads at most one page plus look-ahead and filters before pagination", () => {
  let visited = 0;
  function* files() {
    for (let i = 0; i < 13_440; i++) {
      visited++;
      yield file(i);
    }
  }
  const first = evidencePage(files(), 0, "", "all");
  expect(first.files).toHaveLength(100);
  expect(first.hasMore).toBe(true);
  expect(visited).toBe(101);
  const second = evidencePage(files(), 100, "", "all");
  expect(second.files[0]?.path).toBe(file(100).path);
  const filtered = evidencePage(files(), 0, "001", "trace");
  expect(filtered.files.every((row) => row.category === "trace" && row.path.includes("001"))).toBe(true);
  expect(evidencePage([file(1)], 0, "missing", "all").hasMore).toBe(false);
  expect(() => evidencePage([], -1, "", "all")).toThrow("offset");
});

test("file pages are scoped to an existing controller run and do not follow symlinked files", () => {
  const root = mkdtempSync(join(tmpdir(), "ana-evidence-page-"));
  const directory = join(root, "campaigns/project/controller/run");
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "opening.json"), JSON.stringify({ runId: "run" }));
    writeFileSync(join(root, "secret.json"), "{}");
    symlinkSync(join(root, "secret.json"), join(directory, "linked.json"));
    for (let i = 0; i < 205; i++) writeFileSync(join(directory, `${String(i).padStart(5, "0")}.json`), "{}");
    const page = { project: "project", runId: "run", query: "", category: "all" };
    const first = readEvidencePage(root, { ...page, offset: 0 });
    const last = readEvidencePage(root, { ...page, offset: 200 });
    expect(first.files).toHaveLength(100);
    expect(last.files).toHaveLength(6);
    expect(last.hasMore).toBe(false);
    expect(() =>
      readEvidencePage(root, { project: "../project", runId: "run", offset: 0, query: "", category: "all" }),
    ).toThrow("Run not found");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
