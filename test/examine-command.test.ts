// The Examiner command, `tools/d1b/examine.ts`, with a scripted session. No paid model runs here.
import { afterAll, describe, expect, it } from "bun:test";
import { readdirSync, rmSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { inExaminerWall } from "../src/examiner/shell.ts";
import { examineCommand } from "../tools/d1b/examine.ts";
import { REPO } from "../tools/d2/campaign.ts";
import { fixtureTasks, layOutPack } from "./helpers/fixture-pack.ts";
import { present } from "./helpers/matchers.ts";

const STEM = `test-examine-command-${String(runtimeProcess.pid)}`;
const PACK = ["--examiner", "claude/claude-opus-5-5"];
const finished = () => ({ ended: "finished", puts: 0, held: [], refused: [] }) as const;
for (const name of ["home"]) {
  layOutPack(join(REPO, ".ana", "d2", `${STEM}-${name}`), fixtureTasks(1));
}

afterAll(() => {
  for (const name of ["home"]) {
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
});
