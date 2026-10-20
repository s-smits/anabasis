// The command's admission probes, with a scripted solve and review. No paid model runs here.
import { afterAll, describe, expect, it } from "bun:test";
import { examine } from "../src/examiner/session.ts";
import type { Ending } from "../src/kernel/solve.ts";
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
const TASK = fixtureTasks(1)[0];
const RULINGS = ["earned", "check-defect", "unclear", null] as const;
const ENDINGS: readonly Ending[] = [
  { outcome: "fail", kind: "rejected" },
  { outcome: "pass" },
  { outcome: "fail", kind: "turns-ended" },
  { outcome: "flagged", reason: "malformed" },
  { outcome: "non-result", kind: "provider", reason: "offline" },
];
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
  for (const name of [...RULINGS.map(String), "home", "missing-reviewer"]) {
    rmSync(join(REPO, ".ana", "d2", `${STEM}-${name}`), { recursive: true, force: true });
  }
});

describe("the Examiner command's admission reviews", () => {
  it("refuses a model admission session without a Referee before opening the campaign", async () => {
    const name = `${STEM}-missing-reviewer`;
    await expect(
      examineCommand([...PACK, "--name", name, "--session", "x-1"], examine, () => {
        throw new Error("an unreviewed solver must not be seated");
      }),
    ).rejects.toThrow("--reviewer");
    expect(existsSync(join(REPO, ".ana", "d2", name))).toBe(false);
  });

  it("counts only an earned rejection, reviews no other ending, and leaves an unruled rejection unmeasured", async () => {
    for (const ruling of RULINGS) {
      const reviewed: string[] = [];
      const measured: Ending[] = [];
      let solves = 0;
      await examineCommand(
        [
          "--root",
          ROOT,
          "--sweep",
          "s",
          "--cycle",
          "c01",
          "--bundle",
          BUNDLE,
          "--name",
          `${STEM}-${String(ruling)}`,
          "--session",
          "x-1",
          "--examiner",
          "claude/claude-opus-5-5",
          ...(ruling === null ? [] : ["--reviewer", "claude/claude-opus-5-5"]),
        ],
        async (request) => {
          if (TASK === undefined || request.probe === null) {
            throw new Error("the command must provide a probe");
          }
          for (const _ending of ENDINGS) {
            measured.push(await request.probe(request.pack(TASK), "x-1", new AbortController().signal));
          }
          return { ended: "finished", puts: 0, held: [], refused: [] };
        },
        (campaign) => {
          campaign.reviewers = () => ({
            referee: async (solve) => {
              reviewed.push(solve);
              return {
                ruling,
                check: null,
                rule: null,
                field: null,
                reason: "fixture",
                probes: [],
              };
            },
          });
          return {
            builder: null,
            setting: campaign.setting(campaign.test),
            solve: async () => {
              const ending = ENDINGS[solves++];
              if (ending === undefined) throw new Error("no extra solve is expected");
              return { solve: `s-${String(solves)}`, ending };
            },
          };
        },
      );
      expect(reviewed).toEqual(ruling === null ? [] : ["s-1"]);
      expect(measured.slice(1)).toEqual(ENDINGS.slice(1));
      expect(measured[0]).toMatchObject(
        ruling === "earned"
          ? { outcome: "fail", kind: "rejected" }
          : { outcome: "non-result", kind: "check" },
      );
    }
  });

  it("hands the session the reference harness's kept directory where --reference-home is on or unnamed, and none where it is off", async () => {
    const walls: (string | undefined)[] = [];
    // On unless named since 19 October: a command that names nothing lays the copy.
    for (const home of ["on", "off", undefined]) {
      const named = home === undefined ? [] : ["--reference-home", home];
      await examineCommand(
        [...PACK, "--name", `${STEM}-home`, "--session", `x-${home ?? "unnamed"}`, ...named],
        async (_request, wall) => {
          walls.push(wall?.reference);
          return { ended: "finished", puts: 0, held: [], refused: [] };
        },
      );
    }
    expect(walls[0] !== undefined && existsSync(join(walls[0], "agent"))).toBe(true);
    expect(walls[1]).toBeUndefined();
    expect(walls[2]).toBe(walls[0]);
    await expect(
      examineCommand(
        [...PACK, "--name", `${STEM}-home`, "--session", "x-3", "--reference-home", "yes"],
        async () => {
          throw new Error("no session opens on a word that is neither on nor off");
        },
      ),
    ).rejects.toThrow("--reference-home is on or off, not yes");
  });
});
