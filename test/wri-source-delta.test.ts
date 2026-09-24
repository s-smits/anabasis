import { afterAll, describe, expect, it } from "bun:test";
import {
  buildSourceDelta,
  renderSourceDelta,
} from "../.claude/skills/whole-run-investigation/scripts/source-delta.mjs";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { join } from "../src/meta/path.ts";
import { runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import { hostTool } from "../src/meta/host-tool.ts";

afterAll(cleanupScratch);

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(repo: string, args: string[]): string {
  return runTextSyncOrThrow([hostTool("git"), "-C", repo, ...args], { env: GIT_ENV }).trim();
}

/** Two commits: the older declares safeguard `old-one`; the newer adds `new-one` to that run
 *  file and changes a starter file. Neither commit deletes a file. */
function repoWithTwoCommits() {
  const repo = scratchDir("ana-source-delta-repo-");
  git(repo, ["init", "-q", "-b", "main"]);
  mkdirSync(join(repo, "src", "run"), { recursive: true });
  mkdirSync(join(repo, "starters"), { recursive: true });
  writeFileSync(join(repo, "src", "run", "loop.ts"), 'safeguardTriggered("old-one", "x");\n');
  writeFileSync(join(repo, "starters", "card.md"), "v1\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "one"]);
  const older = git(repo, ["rev-parse", "HEAD"]);
  writeFileSync(
    join(repo, "src", "run", "loop.ts"),
    'safeguardTriggered("old-one", "x");\nsafeguardTriggered("new-one", "y");\n',
  );
  writeFileSync(join(repo, "starters", "card.md"), "v2\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "two"]);
  const newer = git(repo, ["rev-parse", "HEAD"]);
  return { repo, older, newer };
}

function campaign(root: string, name: string, runId: string, commit: string, writtenAt: string): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "controller", runId), { recursive: true });
  writeFileSync(
    join(dir, "controller", runId, "opening.json"),
    JSON.stringify({ writtenAt, source: { commit } }),
  );
  return dir;
}

describe("source-delta reach", () => {
  it("joins safeguards declared in changed files to the run's fired log and flags a model-visible change", () => {
    const { repo, older, newer } = repoWithTwoCommits();
    const root = scratchDir("ana-source-delta-campaigns-");
    campaign(root, "lane-1", "run-a", older, "2026-09-01T00:00:00.000Z");
    const current = campaign(root, "lane-2", "run-b", newer, "2026-09-02T00:00:00.000Z");
    mkdirSync(join(current, "safeguards", "run-b-i02"), { recursive: true });
    writeFileSync(
      join(current, "safeguards", "run-b-i02", "SAFEGUARDS_LOG.txt"),
      "2026-09-02T01:00:00.000Z | old-one | detail\n2026-09-02T01:00:01.000Z | elsewhere | detail\n",
    );

    const delta = buildSourceDelta({ campaign: current, runId: "run-b", repo });
    expect(delta.state).toBe("resolved");
    expect(delta.previousCommit).toBe(older);
    expect(delta.previousProvenance).toContain("lane-1");
    expect(delta.changed.map((entry: { path: string }) => entry.path).sort()).toEqual([
      "src/run/loop.ts",
      "starters/card.md",
    ]);
    const loop = delta.changed.find((entry: { path: string }) => entry.path === "src/run/loop.ts");
    expect(loop?.newSafeguardIds).toEqual(["new-one"]);
    expect(delta.safeguards).toEqual([
      { id: "new-one", state: "unreached", firings: 0 },
      { id: "old-one", state: "fired", firings: 1 },
    ]);
    expect(delta.firedElsewhere).toEqual([{ id: "elsewhere", firings: 1 }]);
    expect(delta.modelVisibleChanged).toEqual(["starters/card.md"]);

    const text = renderSourceDelta(delta);
    expect(text).toContain("UNREACHED CHANGED SAFEGUARDS (lane 21): new-one");
    expect(text).toContain("MODEL-VISIBLE SURFACE CHANGED (lane 21): starters/card.md");
    expect(text).not.toContain("safeguardTriggered(");
  });

  it("reads a sibling campaign's latest run by its opening instant, not its directory name", () => {
    const { repo, older, newer } = repoWithTwoCommits();
    const root = scratchDir("ana-source-delta-campaigns-");
    const previous = campaign(root, "lane-1", "run-10", older, "2026-09-02T00:00:00.000Z");
    campaign(root, "lane-1", "run-9", newer, "2026-09-01T00:00:00.000Z");
    const current = campaign(root, "lane-2", "run-b", newer, "2026-09-03T00:00:00.000Z");
    // By name `run-9` is last, and it was opened first; its commit equals the current one, so the
    // old name order reported an identical source where the recorded latest run differs.
    const delta = buildSourceDelta({ campaign: current, runId: "run-b", repo, previous });
    expect(delta.previousCommit).toBe(older);
    expect(delta.state).toBe("resolved");
  });

  it("counts a safeguard log only for this run's canonical iterations", () => {
    const { repo, older, newer } = repoWithTwoCommits();
    const root = scratchDir("ana-source-delta-campaigns-");
    campaign(root, "lane-1", "run-a", older, "2026-09-01T00:00:00.000Z");
    const current = campaign(root, "lane-2", "run-b", newer, "2026-09-02T00:00:00.000Z");
    for (const name of ["run-b-i02", "run-b-ix"]) {
      mkdirSync(join(current, "safeguards", name), { recursive: true });
      writeFileSync(
        join(current, "safeguards", name, "SAFEGUARDS_LOG.txt"),
        "2026-09-02T01:00:00.000Z | old-one | detail\n",
      );
    }
    const delta = buildSourceDelta({ campaign: current, runId: "run-b", repo });
    expect(delta.safeguards).toContainEqual({ id: "old-one", state: "fired", firings: 1 });
  });

  it("reports unresolved sources instead of guessing and identical sources as no delta", () => {
    const { repo, newer } = repoWithTwoCommits();
    const root = scratchDir("ana-source-delta-campaigns-");
    const unknown = "f".repeat(40);
    const missing = campaign(root, "lane-1", "run-a", unknown, "2026-09-01T00:00:00.000Z");
    expect(buildSourceDelta({ campaign: missing, runId: "run-a", repo }).state).toBe("source-unresolved");

    const alone = campaign(root, "other-1", "run-c", newer, "2026-09-03T00:00:00.000Z");
    const noPrevious = buildSourceDelta({ campaign: alone, runId: "run-c", repo });
    expect(noPrevious.state).toBe("previous-unresolved");
    expect(renderSourceDelta(noPrevious)).toContain("no earlier campaign of lane other");

    expect(buildSourceDelta({ campaign: alone, runId: "run-c", repo, previous: newer }).state).toBe(
      "identical-source",
    );
    expect(buildSourceDelta({ campaign: alone, runId: "run-c", repo, previous: unknown }).state).toBe(
      "previous-unresolved",
    );
  });
});
