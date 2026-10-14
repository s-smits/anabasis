// The three scripts the operator's skills share: the stack as its edges, the source a campaign's
// launches ran, and the closing of an Oracle bundle.
import { afterAll, describe, expect, it } from "bun:test";
import { told as sourceTold } from "#skills/attribution-and-proof/scripts/run-source.ts";
import { CommandFailure } from "#skills/main/cli.ts";
import { gitText } from "#skills/main/git.ts";
import { bundle } from "#skills/oracle-handover/scripts/bundle.ts";
import { chain, type Pull, told as stackTold } from "#skills/stack-pr/scripts/stack.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import { launchesOf } from "../tools/runs/receipt.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-skill-scripts-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const pull = (number: number, head: string, base: string): Pull => ({
  number,
  headRefName: head,
  baseRefName: base,
  headRefOid: String(number).repeat(40).slice(0, 40),
});

describe("the stack", () => {
  // #9 sits beside the stack with the highest number, off the middle.
  const pulls = [pull(9, "side", "a"), pull(3, "c", "b"), pull(1, "a", "main"), pull(2, "b", "a")];

  it("takes the deepest pull request for the top, not the highest number", () => {
    const { line, sides } = chain(pulls);
    expect(line.map((each) => each.number)).toStrictEqual([1, 2, 3]);
    expect(sides.map((each) => each.number)).toStrictEqual([9]);
    expect(stackTold(pulls, null)).toContain("top: #3 c at 3333333");
  });

  it("says of a branch whether anything is stacked on it", () => {
    expect(stackTold(pulls, "c").at(-1)).toBe("nothing is stacked on it: its commits may still be folded");
    expect(stackTold(pulls, "a").at(-1)).toBe("stacked on it: #9, #2. It takes new commits only");
    expect(stackTold(pulls, "side")[1]).toBe("beside the stack");
    expect(() => stackTold(pulls, "gone")).toThrow(CommandFailure);
  });

  it("starts a chain on a base that has landed, and says so of an empty list", () => {
    const landed = [pull(5, "b", "a"), pull(4, "a", "landed"), pull(6, "lone", "main")];
    expect(chain(landed).line.map((each) => each.number)).toStrictEqual([4, 5]);
    expect(stackTold([], null)).toStrictEqual(["no pull request is open"]);
  });
});

describe("the source a campaign's launches ran", () => {
  const repo = join(root, "repo");
  const folder = join(repo, ".ana", "d2", "buffer");
  mkdirSync(folder, { recursive: true });
  const git = (...args: string[]) =>
    runTextSyncOrThrow(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t.dev", ...args]);
  git("init", "-q");
  git("commit", "-q", "--allow-empty", "-m", "first");
  const first = gitText(repo, "rev-parse", "HEAD");
  git("commit", "-q", "--allow-empty", "-m", "second");
  const second = gitText(repo, "rev-parse", "HEAD");
  const receipt = (session: string, at: string, commit: string, dirty: boolean, bun?: string) =>
    writeFileSync(
      join(folder, `launch-${session}.json`),
      JSON.stringify({
        at,
        pid: 1,
        flags: ["--cap", "5"],
        envFile: "/private/x.env",
        commit,
        dirty,
        load: 3.2,
        cores: 8,
        bun,
      }),
    );

  it("says nothing was recorded for a campaign started by hand", () => {
    expect(launchesOf(join(folder, "log.jsonl"))).toStrictEqual([]);
    expect(sourceTold(folder, repo, [])[0]).toStartWith("no launch receipt");
  });

  it("says each launch's commit and what it holds, and nothing a receipt keeps private", () => {
    receipt("g1", "2026-10-09T14:00:00.000Z", second, true, "1.4.3");
    receipt("b-1", "2026-10-09T13:00:00.000Z", first, false);
    writeFileSync(join(folder, "launch-b-1.out"), "");
    const lines = sourceTold(folder, repo, [second]);
    expect(lines).toStrictEqual([
      `b-1  2026-10-09T13:00:00.000Z  ${first.slice(0, 9)}  clean  load 3.2 on 8 cores  bun unknown`,
      "  published on no remote branch",
      `  does not hold ${second.slice(0, 9)}`,
      `g1  2026-10-09T14:00:00.000Z  ${second.slice(0, 9)}  with uncommitted changes  load 3.2 on 8 cores  bun 1.4.3`,
      "  published on no remote branch",
      `  holds ${second.slice(0, 9)}`,
    ]);
    expect(lines.join("\n")).not.toContain("x.env");
  });
});

describe("an Oracle bundle", () => {
  const made = (name: string, files: Readonly<Record<string, string>>) => {
    const dir = join(root, name);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  };

  it("zips a folder that holds the task document, and counts its files", () => {
    const dir = made("oracle-a", { "REVIEW.md": "# Review\n", "notes/predictions.md": "held\n" });
    const { out, bytes, files } = bundle(dir, 1024 * 1024);
    expect(out).toBe(`${dir}.zip`);
    expect(files).toBe(2);
    expect(bytes).toBeGreaterThan(0);
    expect(runTextSyncOrThrow(["unzip", "-Z1", out]).split("\n")).toContain("oracle-a/REVIEW.md");
  });

  it("refuses a folder with no task document, a credential-shaped line and a zip over its size", () => {
    expect(() => bundle(made("oracle-b", { "notes/a.md": "x\n" }), 1024)).toThrow("holds no REVIEW.md");
    const key = ["sk-ant-api03-", "Xy7Qm2Lp9RtVw4Zc8Nb1Hj6Kd3Gs0Ge5"].join("");
    const leaky = made("oracle-c", {
      "REVIEW.md": "# Review\n",
      "notes/a.md": `Authorization: Bearer ${key}\n`,
    });
    expect(() => bundle(leaky, 1024 * 1024)).toThrow("notes/a.md:1");
    expect(existsSync(`${leaky}.zip`)).toBe(false);
    const big = made("oracle-d", { "REVIEW.md": "# Review\n" });
    expect(() => bundle(big, 10)).toThrow("over its");
    expect(existsSync(`${big}.zip`)).toBe(false);
  });
});
