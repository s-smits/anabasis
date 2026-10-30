/**
 * The gate's proof over a list of commits (`proveCommits`, `tools/runtime/gate.ts`), as `bun run land`
 * and the pre-push hook call it, over real commits in a fixture repository, with Bun replaced only at
 * the gate's steps (`test/helpers/fake-bun.ts`). A small driver written into the fixture imports the
 * gate from a checkout and proves the `<commit>:<pass>` pairs it is given, so a case names each
 * commit's pass as land would and reads which steps and nearby tests each pass ran, and which pass
 * a remembered one spared. Until 25 October these cases ran through the pre-push hook, which then
 * proved every commit a push added.
 */
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";

import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import { fakeBun, gatesRun } from "./helpers/fake-bun.ts";

const fixture = mkdtempSync(join(tmpdir(), "ana-gate-"));
const work = join(fixture, "work");
const bin = join(fixture, "bin");
const log = join(fixture, "gates.log");
const fake = (mkdirSync(bin), fakeBun(bin, log));

const git = (...args: string[]): string => execTextSync("git", args, { cwd: work }).trim();
function commit(file: string, text: string, message: string): string {
  writeFileSync(join(work, file), text);
  git("add", file);
  git("commit", "-qm", message);
  return git("rev-parse", "HEAD");
}
const blob = (text: string): string =>
  execTextSync("git", ["hash-object", "-w", "--stdin"], { cwd: work, stdin: text }).trim();
/** A tree or commit's tree with one more file at the top, holding its own name. */
const withFile = (from: string, name: string): string =>
  execTextSync("git", ["mktree"], {
    cwd: work,
    stdin: `${[git("ls-tree", from), `100644 blob ${blob(name)}\t${name}`].filter((row) => row !== "").join("\n")}\n`,
  }).trim();
const short = (sha: string): string => sha.slice(0, 9);

/** A driver that proves `<commit>:<pass>` pairs with the gate at `gate`, `-` for documentation. */
function driverOf(gate: string): string {
  const path = join(fixture, `prove-${String(gate.length)}-${short(Bun.hash(gate).toString(16))}.ts`);
  writeFileSync(
    path,
    `import { proveCommits } from ${JSON.stringify(gate)};
const proofs = Bun.argv.slice(2).map((pair) => {
  const [commit = "", pass = ""] = pair.split(":");
  return { commit, pass: pass === "-" ? null : pass };
});
const failed = await proveCommits(process.cwd(), proofs, {
  who: "land",
  jobs: Number(process.env.DRIVER_JOBS ?? "1"),
  say: (line) => console.error("prove: " + line),
  // As land's mark throws Moved once a head moved under the proof.
  mark: (commit, state) => {
    if (state === "success" && commit === process.env.DRIVER_MOVED_AT) throw new Error("moved");
  },
}).catch((error) => {
  console.error("REJECTED " + String(error));
  process.exit(3);
});
if (failed !== null) console.error("FAILS " + failed.step + " Log: " + failed.log);
process.exit(failed === null ? 0 : 1);
`,
  );
  return path;
}
const ownDriver = driverOf(join(import.meta.dir, "..", "tools", "runtime", "gate.ts"));

mkdirSync(join(work, "src"), { recursive: true });
mkdirSync(join(work, "test"));
git("init", "-q", "-b", "main");
git("config", "user.email", "fixture@localhost");
git("config", "user.name", "fixture");
writeFileSync(join(work, "src", "b.ts"), "export const b = 1;\n");
writeFileSync(
  join(work, "test", "owner.test.ts"),
  'import { owner } from "../src/owner.ts";\nexport { owner };\n',
);
git("add", "-A");
const base = commit("src/owner.ts", "export const owner = 1;\n", "base");
commit("README.md", "two\n", "docs");
const source = commit("src/owner.ts", "export const owner = 2;\n", "source");
const second = commit("src/b.ts", "export const b = 2;\n", "second");
// Main holds `base`, as a clone's remote-tracking ref says.
git("update-ref", "refs/remotes/origin/main", base);

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

function prove(pairs: readonly string[], env: Record<string, string> = {}, driver = ownDriver) {
  return spawnTextSync(capturedExecPath, [driver, ...pairs], {
    cwd: work,
    env: { ...Bun.env, ANA_GATE_FRESH: "", ...fake, ...env },
  });
}
/** What land asks of `source` and `second` above the documentation commit: the static steps, then the whole gate. */
const landing = [`${source}:static`, `${second}:whole`];
const forgetPasses = (): void => rmSync(join(work, ".git", "ana-gate-passed"), { force: true });

beforeEach(() => {
  rmSync(log, { force: true });
  forgetPasses();
});

describe("proveCommits", () => {
  it("gives a static pass its steps and nearby tests, and a whole pass the suite", () => {
    expect(prove(landing).status).toBe(0);
    expect(gatesRun(log)).toEqual([`${source} test/owner.test.ts`, `${second} suite`]);
    const steps = readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line.startsWith(source));
    expect(steps.map((line) => line.split("\t")[1])).toEqual([
      "install --frozen-lockfile",
      "run format:check",
      "run secrets",
      "run typecheck",
      "run lint -- --strict",
      "run test -- test/owner.test.ts",
    ]);
  });

  it("runs the UI's whole gate over the UI, its tests within three imports over what it imports, and nothing over the rest", () => {
    const tree = (rows: readonly string[]): string =>
      execTextSync("git", ["mktree"], { cwd: work, stdin: `${rows.join("\n")}\n` }).trim();
    const file = (name: string, text: string): string => `100644 blob ${blob(text)}\t${name}`;
    const lines = (text: string): string[] => text.split("\n").filter((row) => row !== "");
    const into = (from: string, name: string, sub: string): string =>
      tree([
        ...lines(git("ls-tree", from)).filter((row) => !row.endsWith(`\t${name}`)),
        `040000 tree ${sub}\t${name}`,
      ]);
    // Three imports from `deep.test.ts` to `src/b.ts`, four from `far.test.ts`, one from the browser's.
    const tests = tree([
      file("browser-page.test.ts", 'import "../../../src/b.ts";\n'),
      file("deep.test.ts", 'import "./h1.ts";\n'),
      file("h1.ts", 'import "./h2.ts";\n'),
      file("h2.ts", 'import "../../../src/b.ts";\n'),
      file("far.test.ts", 'import "./f1.ts";\n'),
      file("f1.ts", 'import "./f2.ts";\n'),
      file("f2.ts", 'import "./f3.ts";\n'),
      file("f3.ts", 'import "../../../src/b.ts";\n'),
    ]);
    const ui = tree([file("package.json", "{}\n"), `040000 tree ${tests}\ttest`]);
    const held = git(
      "commit-tree",
      into(second, "packages", tree([`040000 tree ${ui}\tui`])),
      "-p",
      second,
      "-m",
      "the UI",
    );
    const away = git("commit-tree", withFile(held, "c.ts"), "-p", held, "-m", "away from the UI");
    const src = tree([
      ...lines(git("ls-tree", `${away}:src`)).filter((row) => !row.endsWith("\tb.ts")),
      file("b.ts", "export const b = 3;\n"),
    ]);
    const imported = git("commit-tree", into(away, "src", src), "-p", away, "-m", "what the UI imports");
    const head = git("commit-tree", withFile(imported, "d.ts"), "-p", imported, "-m", "head");
    const ran = (sha: string): string[] =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((row) => row.startsWith(sha))
        .map((row) => row.split("\t")[1] ?? "");
    const near = (...names: string[]): string[] => [
      "run ui:deps",
      "run ui:build",
      `run test -- ${names.map((name) => `packages/ui/test/${name}`).join(" ")}`,
    ];
    try {
      // Main before the UI: the commit that brings it and the head run its whole gate; a static
      // pass over a change to what it imports runs the tests near it but the browser's; a commit
      // that changes nothing it reads runs no UI step.
      expect(prove([`${held}:static`, `${away}:static`, `${imported}:static`, `${head}:whole`]).status).toBe(
        0,
      );
      expect(ran(held)[1]).toBe("run ui:gate");
      expect(ran(away)[1]).toBe("run format:check");
      expect(ran(imported).slice(1, 4)).toEqual(near("deep.test.ts"));
      expect(ran(head)[1]).toBe("run ui:gate");
      // Main holding the UI: a whole pass over the same change runs the browser's file too.
      git("update-ref", "refs/remotes/origin/main", away);
      rmSync(log, { force: true });
      forgetPasses();
      expect(prove([`${imported}:static`, `${head}:whole`]).status).toBe(0);
      expect(ran(head).slice(1, 4)).toEqual(near("browser-page.test.ts", "deep.test.ts"));
      // Main holding the change: a whole pass over a head that leaves what the UI reads alone.
      git("update-ref", "refs/remotes/origin/main", imported);
      rmSync(log, { force: true });
      forgetPasses();
      expect(prove([`${head}:whole`]).status).toBe(0);
      expect(ran(head)[1]).toBe("run format:check");
    } finally {
      git("update-ref", "refs/remotes/origin/main", base);
    }
  });

  it("runs a tree again once a file the gate imports changed, and not for a neighbour it never imports", () => {
    // A copy of the checker as a caller's checkout holds it: the gate and what it imports.
    const checker = join(fixture, "checker");
    for (const part of ["tools/runtime", "src/meta"]) {
      cpSync(join(import.meta.dir, "..", part), join(checker, part), { recursive: true });
    }
    const driver = driverOf(join(checker, "tools", "runtime", "gate.ts"));
    expect(prove(landing, {}, driver).status).toBe(0);
    rmSync(log, { force: true });
    expect(prove(landing, {}, driver).status).toBe(0);
    expect(gatesRun(log)).toEqual([]);
    appendFileSync(join(checker, "tools", "runtime", "lint.ts"), "\n// a step the target runs as its own\n");
    expect(prove(landing, {}, driver).status).toBe(0);
    expect(gatesRun(log)).toEqual([]);
    appendFileSync(join(checker, "src", "meta", "subprocess.ts"), "\n// the gate's import, changed\n");
    expect(prove(landing, {}, driver).status).toBe(0);
    expect(gatesRun(log)).toEqual([`${source} test/owner.test.ts`, `${second} suite`]);
  });

  it("lets a running proof finish and keep its pass before a rejected mark removes the checkouts", () => {
    // `second` has no nearby test and passes at once; `source` is still in its two-second test step
    // when the mark for `second` throws, as land's does when a head moved.
    const result = prove([`${second}:static`, `${source}:static`], {
      DRIVER_JOBS: "2",
      DRIVER_MOVED_AT: second,
      ANA_FAKE_TOGETHER: "2",
      ANA_FAKE_SUITE: "(pass) one",
    });
    expect(result.status).toBe(3);
    expect(prove([`${source}:static`]).stderr).toContain("passed earlier on these exact bytes");
  });

  it("stops at the commit that fails and names the failing step and its log", () => {
    const result = prove(landing, { ANA_FAKE_FAIL: `${source} lint` });
    expect(result.status).toBe(1);
    expect(gatesRun(log)).toEqual([`${source} -`]);
    const last = result.stderr.trimEnd().split("\n").at(-1) ?? "";
    expect(last).toStartWith("FAILS lint Log: ");
    expect(readFileSync(last.slice(last.indexOf("Log: ") + 5), "utf8")).toContain(
      "gate: step lint failed (exit 1)",
    );
    // The commits beneath a fix keep their passes; this one has none to keep.
    expect(prove(landing).stderr).not.toContain("passed earlier");
  });

  // The wrapper prints its host-wall lines in colour, so the recorded shape begins with an escape.
  const red = "\u001b[0m\u001b[31m";
  const pulses = [
    [
      "a host-wall rerun",
      `${red}host-wall: 1 test(s) failed on time alone, none on an assertion; running their 1 file(s) again in one fresh process: test/two.test.ts`,
      true,
    ],
    [
      "a host-wall error",
      `${red}host-wall: error: the host reached a load average of 20.0 on 8 cores, but 1 file(s) printed no result at all: test/two.test.ts`,
      false,
    ],
  ] as const;
  it.each(pulses)(
    "reports counts and rerun state after %s",
    (_name, wall, rerunning) => {
      const result = prove([`${source}:whole`], {
        ANA_FAKE_SUITE: `(pass) one\n(fail) two\n${wall}\n(pass) two`,
        ANA_GATE_PULSE_SECONDS: "1",
      });
      expect(result.status).toBe(0);
      const named = /Log: (\/\S+\.log)/u.exec(result.stderr)?.[1] ?? "";
      expect(readFileSync(named, "utf8")).toContain("(pass) two");
      expect(result.stderr).toContain(
        `prove: ${short(source)} still running after 0 min: 2 tests passed, 1 failed`,
      );
      expect(result.stderr.includes("1 test(s) failed on time alone, none on an assertion")).toBe(rerunning);
      expect(result.stderr.includes("failed files are running again in one fresh process")).toBe(rerunning);
    },
    20_000,
  );
});
