// The Examiner command, `tools/d1b/examine.ts`, with a scripted session. No paid model runs here.
import { afterAll, describe, expect, it } from "bun:test";
import { readdirSync, rmSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { inExaminerWall } from "../src/examiner/shell.ts";
import { examineCommand } from "../tools/d1b/examine.ts";
import { read } from "../src/kernel/log.ts";
import { REPO, campaignLog } from "../tools/d2/campaign.ts";
import type { Seated } from "../tools/d2/round.ts";
import { fixtureTasks, layOutPack } from "./helpers/fixture-pack.ts";
import { present } from "./helpers/matchers.ts";

const STEM = `test-examine-command-${String(runtimeProcess.pid)}`;
const PACK = ["--examiner", "claude/claude-opus-5-5"];
/** A scripted session that held nothing and refused nothing. */
const finished = () => ({ ended: "finished", puts: 0, held: [], refused: [] }) as const;
for (const name of ["home", "probe", "unkept"]) {
  layOutPack(join(REPO, ".ana", "d2", `${STEM}-${name}`), fixtureTasks(1));
}

afterAll(() => {
  for (const name of ["home", "probe", "unkept"]) {
    rmSync(join(REPO, ".ana", "d2", `${STEM}-${name}`), { recursive: true, force: true });
  }
});

describe("the Examiner command", () => {
  it("opens the session's home with nothing of the reference harness in it", async () => {
    let home: string[] = [];
    await examineCommand([...PACK, "--name", `${STEM}-home`, "--session", "x-1"], async (request, wall) => {
      home = await inExaminerWall(request, present(wall, "the session's wall"), async ({ shell }) =>
        readdirSync(shell.dirs.home),
      );
      return finished();
    });
    expect(home).not.toContain("reference-harness");
  });

  it("solves the author's tries by the reference harness through the seats it is given, each start naming the session, as many as it may put", async () => {
    const asked: { harness: string; comparison: string | undefined; task: string }[] = [];
    let reference: string | undefined;
    const seated: Seated = (_campaign, given) => ({
      builder: null,
      setting: "scripted",
      solve: async (task, harness, _kill, comparison) => {
        expect(harness.dir).toBe(given.reference);
        reference = given.reference;
        asked.push({ harness: harness.dir, comparison, task: task.taskId });
        return { solve: "x-1-s1", ending: { outcome: "pass" } };
      },
    });
    await examineCommand(
      [...PACK, "--name", `${STEM}-probe`, "--session", "x-1", "--proposals", "5"],
      async (request) => {
        const probe = present(request.probe, "the session's probe");
        expect(probe.tries).toBe(5);
        const task = { taskId: "try-1", family: "fixture", publicInput: {}, hidden: null };
        expect(await probe.solve(task, new AbortController().signal)).toMatchObject({ solve: "x-1-s1" });
        return finished();
      },
      seated,
    );
    expect(asked).toEqual([{ harness: present(reference), comparison: "x-1", task: "try-1" }]);
  });

  it("records the campaign's setting at a session's first try and not before, so a session that tries nothing leaves no setting", async () => {
    const seated: Seated = () => ({
      builder: null,
      setting: "scripted",
      solve: async () => ({ solve: "x-1-s1", ending: { outcome: "pass" } }),
    });
    const settings = () =>
      read(campaignLog(`${STEM}-unkept`)).filter((event) => event.kind === "campaign.setting");
    const task = { taskId: "try-1", family: "fixture", publicInput: {}, hidden: null };
    await examineCommand(
      [...PACK, "--name", `${STEM}-unkept`, "--session", "x-1"],
      async () => finished(),
      seated,
    );
    expect(settings()).toHaveLength(0);
    await examineCommand(
      [...PACK, "--name", `${STEM}-unkept`, "--session", "x-2"],
      async (request) => {
        const probe = present(request.probe, "the session's probe");
        await probe.solve(task, new AbortController().signal);
        await probe.solve(task, new AbortController().signal);
        return finished();
      },
      seated,
    );
    expect(settings()).toHaveLength(1);
  });
});
