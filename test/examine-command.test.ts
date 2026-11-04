// The Examiner command, `tools/d1b/examine.ts`, with a scripted session. No paid model runs here.
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import type { Session } from "../src/examiner/session.ts";
import { examineCommand } from "../tools/d1b/examine.ts";
import { REPO } from "../tools/d2/campaign.ts";
import type { Seated } from "../tools/d2/round.ts";
import { fixtureTasks, layOutPack } from "./helpers/fixture-pack.ts";
import { present } from "./helpers/matchers.ts";

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "ana-examine-command-")));
const BUNDLE = join(ROOT, "bundle");
const STEM = `test-examine-command-${String(runtimeProcess.pid)}`;
const PACK = [
  "--root",
  ROOT,
  "--sweep",
  "s",
  "--cycle",
  "c01",
  "--bundle",
  BUNDLE,
  "--examiner",
  "claude/claude-opus-5-5",
];
layOutPack(ROOT, BUNDLE, fixtureTasks(1), join(REPO, "test", "fixtures", "harness-min"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  for (const name of ["home", "probe"]) {
    rmSync(join(REPO, ".ana", "d2", `${STEM}-${name}`), { recursive: true, force: true });
  }
});

describe("the Examiner command", () => {
  it("hands the session the reference harness's kept directory", async () => {
    let reference: string | undefined;
    await examineCommand([...PACK, "--name", `${STEM}-home`, "--session", "x-1"], async (_request, wall) => {
      reference = wall?.reference;
      return { ended: "finished", puts: 0, held: [], refused: [] };
    });
    expect(reference !== undefined && existsSync(join(reference, "agent"))).toBe(true);
  });

  it("solves the author's tries by the reference harness through the seats it is given, each start naming the session, as many as it may put", async () => {
    const asked: { harness: string; comparison: string | undefined; task: string }[] = [];
    const seated: Seated = (_campaign, given) => ({
      builder: null,
      setting: "scripted",
      solve: async (task, harness, _kill, comparison) => {
        expect(harness.dir).toBe(given.reference);
        asked.push({ harness: harness.dir, comparison, task: task.taskId });
        return { solve: "x-1-s1", ending: { outcome: "pass" } };
      },
    });
    let reference: string | undefined;
    await examineCommand(
      [...PACK, "--name", `${STEM}-probe`, "--session", "x-1", "--proposals", "5"],
      async (request, wall) => {
        reference = wall?.reference;
        const probe = present(request.probe, "the session's probe");
        expect(probe.tries).toBe(5);
        const task = { taskId: "try-1", family: "fixture", publicInput: {}, hidden: null };
        expect(await probe.solve(task, new AbortController().signal)).toMatchObject({ solve: "x-1-s1" });
        return { ended: "finished", puts: 0, held: [], refused: [] };
      },
      seated,
    );
    expect(asked).toEqual([{ harness: present(reference), comparison: "x-1", task: "try-1" }]);
  });

  it("gives a session no probe where no seats are given", async () => {
    const given: Parameters<Session<"write">>[0]["probe"][] = [];
    await examineCommand([...PACK, "--name", `${STEM}-home`, "--session", "x-2"], async (request) => {
      given.push(request.probe);
      return { ended: "finished", puts: 0, held: [], refused: [] };
    });
    expect(given).toEqual([null]);
  });
});
