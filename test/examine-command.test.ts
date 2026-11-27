// The Examiner command, `tools/eval/examine.ts`, with a scripted session. No paid model runs here.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, readdirSync, rmSync } from "../src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { append, LOG_FILE } from "../src/kernel/log.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { inExaminerSandbox } from "../src/examiner/shell.ts";
import { examineCommand } from "../tools/eval/examine.ts";
import { REPO } from "../tools/campaign/campaign.ts";
import { fixtureDraft, fixtureTasks, layOutPack } from "./helpers/fixture-pack.ts";
import { present } from "./helpers/matchers.ts";

const STEM = `test-examine-command-${String(runtimeProcess.pid)}`;
const PACK = ["--examiner", "claude/claude-opus-5-5"];
const finished = () => ({ ended: "finished", puts: 0, held: [], refused: [] }) as const;
for (const name of ["home", "judged"]) {
  layOutPack(join(REPO, ".ana", "d2", `${STEM}-${name}`), fixtureTasks(1));
}

afterAll(() => {
  for (const name of ["home", "judged", "unopened"]) {
    rmSync(join(REPO, ".ana", "d2", `${STEM}-${name}`), { recursive: true, force: true });
  }
});

describe("the Examiner command", () => {
  it("opens the session's home with nothing of the reference harness in it", async () => {
    let home: string[] = [];
    await examineCommand([...PACK, "--name", `${STEM}-home`, "--session", "x-1"], async (request, wall) => {
      home = await inExaminerSandbox(request, present(wall, "the session's wall"), async ({ shell }) =>
        readdirSync(shell.dirs.home),
      );
      return finished();
    });
    expect(home).not.toContain("reference-harness");
  });

  it("offers revision unless --no-revise withholds it", async () => {
    const offered: boolean[] = [];
    const runs: [string, ...string[]][] = [["x-2"], ["x-3", "--no-revise"]];
    for (const [session, ...flags] of runs) {
      await examineCommand([...PACK, "--name", `${STEM}-home`, "--session", session, ...flags], (request) => {
        offered.push(request.revise !== undefined);
        return Promise.resolve(finished());
      });
    }
    expect(offered).toEqual([true, false]);
  });

  it("offers revision on a drafted log no opening names", async () => {
    const name = `${STEM}-unopened`;
    mkdirSync(join(REPO, ".ana", "d2", name), { recursive: true });
    append(join(REPO, ".ana", "d2", name, LOG_FILE), "exam.drafted", {
      session: "d-1",
      draft: parseJsonAs<JsonObject>(capturedJsonStringify(fixtureDraft(fixtureTasks(1)))),
    });
    let offered = false;
    await examineCommand(
      [...PACK, "--name", name, "--session", "x-1", "--solver", "claude/claude-opus-5-5"],
      (request) => {
        offered = request.revise !== undefined;
        return Promise.resolve(finished());
      },
    );
    expect(offered).toBe(true);
  });

  it("judges by the flagged reviewer over the recorded seat", async () => {
    const name = `${STEM}-judged`;
    append(join(REPO, ".ana", "d2", name, LOG_FILE), "campaign.opened", {
      solver: { model: "claude/claude-opus-5-5", effort: "high" },
      seats: { reviewer: { model: "claude/claude-sonnet-5-5", effort: "high" } },
    });
    const lanes: (string | undefined)[] = [];
    const runs: [string, ...string[]][] = [["x-1"], ["x-2", "--reviewer", "openai-codex/gpt-6.1-sol"]];
    for (const [session, ...flags] of runs) {
      await examineCommand([...PACK, "--name", name, "--session", session, ...flags], (request) => {
        lanes.push(request.lane);
        return Promise.resolve(finished());
      });
    }
    expect(lanes).toEqual(["code-only", "judged"]);
  });
});
