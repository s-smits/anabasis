/**
 * Project membership: the shared registry names a project, and so does a directory in the campaign
 * tree. A fresh id is one past the highest ordinal its request has carried in any worktree sharing
 * the tree.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, expect, it } from "bun:test";
import { selectProject, slugForDirectInput } from "../src/run/launch-project.ts";
import { recordedProjects, recordProjectRequest } from "../src/run/project-registry.ts";

const REQUEST = "Design steel trusses";
const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-project-registry-"));
  scratch.push(dir);
  return dir;
}

it("names the projects the registry recorded, and none in an empty checkout", () => {
  const repoRoot = repo();
  expect(recordedProjects(repoRoot)).toEqual([]);
  recordProjectRequest(repoRoot, "p1", "digest-1");
  recordProjectRequest(repoRoot, "p1", "digest-1");
  expect(recordedProjects(repoRoot)).toEqual(["p1"]);
});

it("names a campaign directory as a project, and no file beside one", () => {
  const repoRoot = repo();
  mkdirSync(join(repoRoot, "campaigns", "from-tree"), { recursive: true });
  writeFileSync(join(repoRoot, "campaigns", "stray.json"), "{}");
  expect(recordedProjects(repoRoot)).toEqual(["from-tree"]);
});

it("gives a fresh launch one past the highest ordinal its request carries, never the first gap", () => {
  const repoRoot = repo();
  const base = slugForDirectInput(REQUEST, "ctx");
  expect(selectProject(repoRoot, REQUEST, "ctx")).toMatchObject({ id: base, origin: "created" });
  for (const name of [base, `${base}-28`, `${base}-x`, `${base}-029`]) {
    mkdirSync(join(repoRoot, "campaigns", name), { recursive: true });
  }
  // -2 to -27 are free, as a trashed campaign leaves them; the next id is still -29.
  expect(selectProject(repoRoot, REQUEST, "ctx").id).toBe(`${base}-29`);
});

it("keeps an id spent across worktrees after its campaign directory is trashed", () => {
  // Run worktrees link `campaigns` to the main checkout's tree, so the registry beside it is shared.
  const main = repo();
  mkdirSync(join(main, "campaigns"));
  const [first, second] = [repo(), repo()];
  for (const run of [first, second]) symlinkSync(join(main, "campaigns"), join(run, "campaigns"));
  const taken = selectProject(first, REQUEST, "ctx");
  recordProjectRequest(first, taken.id, taken.requestDigest);
  mkdirSync(join(first, "campaigns", taken.id));
  rmSync(join(main, "campaigns", taken.id), { recursive: true });
  expect(recordedProjects(main)).toEqual([taken.id]);
  expect(selectProject(second, REQUEST, "ctx").id).toBe(`${taken.id}-2`);
});
