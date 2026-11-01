// The Examiner command, `tools/d1b/examine.ts`, with a scripted session. No paid model runs here.
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { examineCommand } from "../tools/d1b/examine.ts";
import { REPO } from "../tools/d2/campaign.ts";
import { fixtureTasks, layOutPack } from "./helpers/fixture-pack.ts";

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
  rmSync(join(REPO, ".ana", "d2", `${STEM}-home`), { recursive: true, force: true });
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
});
