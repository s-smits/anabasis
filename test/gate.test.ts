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
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { hostname, tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { holdAlone, sayingPulls } from "../tools/runtime/landing.ts";

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
  // As land stops its proofs once a head moved under one, or on a signal.
  stop: process.env.DRIVER_STOP_MS ? AbortSignal.timeout(Number(process.env.DRIVER_STOP_MS)) : undefined,
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
    // The cheap steps run first and in turn; the rest start side by side, in no fixed order.
    const ran = steps.map((line) => line.split("\t")[1] ?? "");
    expect(ran.slice(0, 3)).toEqual(["install --frozen-lockfile", "run format:check", "run secrets"]);
    expect(ran.slice(3).toSorted((one, other) => one.localeCompare(other))).toEqual([
      "run lint -- --strict",
      "run test -- test/owner.test.ts",
      "run typecheck",
      "tools/loc/source-policy.ts",
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
    // A root file the UI's gate does not run with, and one it installs from.
    const config = git("commit-tree", withFile(away, "tsconfig.json"), "-p", away, "-m", "a config");
    const lock = git("commit-tree", withFile(config, "bun.lock"), "-p", config, "-m", "the lockfile");
    // The UI's steps of a commit's gate, in their order: they run in turn, beside the other steps.
    const ran = (sha: string): string[] =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((row) => row.startsWith(sha))
        .map((row) => row.split("\t")[1] ?? "")
        .filter((args) => args.startsWith("run ui:") || args.startsWith("run test -- packages/ui/"));
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
      // The UI's install runs first wherever the UI is, since the lint reads what it installs.
      expect(ran(held)).toEqual(["run ui:deps", "run ui:gate"]);
      expect(ran(away)).toEqual(["run ui:deps"]);
      expect(ran(imported)).toEqual(near("deep.test.ts"));
      expect(ran(head)).toEqual(["run ui:deps", "run ui:gate"]);
      // Only what the UI's gate installs from or runs with sends a static pass through all of it.
      expect(prove([`${config}:static`, `${lock}:static`]).status).toBe(0);
      expect(ran(config)).toEqual(["run ui:deps"]);
      expect(ran(lock)).toEqual(["run ui:deps", "run ui:gate"]);
      // Main holding the UI: a whole pass over the same change runs the browser's file too.
      git("update-ref", "refs/remotes/origin/main", away);
      rmSync(log, { force: true });
      forgetPasses();
      expect(prove([`${imported}:static`, `${head}:whole`]).status).toBe(0);
      expect(ran(head)).toEqual(near("browser-page.test.ts", "deep.test.ts"));
      // Main holding the change: a whole pass over a head that leaves what the UI reads alone.
      git("update-ref", "refs/remotes/origin/main", imported);
      rmSync(log, { force: true });
      forgetPasses();
      expect(prove([`${head}:whole`]).status).toBe(0);
      expect(ran(head)).toEqual(["run ui:deps"]);
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
    // The tests start beside the lint, so they ran; the next commit's gate did not start.
    expect(gatesRun(log)).toEqual([`${source} test/owner.test.ts`]);
    const last = result.stderr.trimEnd().split("\n").at(-1) ?? "";
    expect(last).toStartWith("FAILS lint Log: ");
    expect(readFileSync(last.slice(last.indexOf("Log: ") + 5), "utf8")).toContain(
      "gate: step lint failed (exit 1)",
    );
    // The commits beneath a fix keep their passes; this one has none to keep.
    expect(prove(landing).stderr).not.toContain("passed earlier");
  });

  it("prints each failed test's assertion once, however far above the log's end it stands", () => {
    const after = Array.from({ length: 40 }, (_, line) => `later output ${String(line)}`).join("\n");
    const result = prove([`${source}:whole`], {
      ANA_FAKE_FAIL: `${source} test`,
      ANA_FAKE_SUITE: `(pass) one\nerror: expect(received).toBe(expected)\nReceived: 31.5\n(fail) two [5.00ms]\n1 tests failed:\n(fail) two [5.00ms]\n${after}`,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error: expect(received).toBe(expected)\nReceived: 31.5\n(fail) two");
    expect(result.stderr.match(/\(fail\) two/gu)).toHaveLength(1);
    expect(result.stderr).not.toContain("(pass) one");
    expect(result.stderr).toContain("later output 39");
  });

  it("ends a pass under way when stopped, records nothing of it and starts no other", () => {
    // The test step takes two seconds, so the stop lands while the static pass of `source` runs.
    const result = prove(landing, { ANA_FAKE_SUITE: "(pass) one", DRIVER_STOP_MS: "1200" });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`${short(source)}: stopped.`);
    expect(gatesRun(log).map((gate) => gate.split(" ")[0])).toEqual([source]);
    expect(prove(landing).status).toBe(0);
    const proved = gatesRun(log).map((gate) => gate.split(" ")[0]);
    expect(proved, "the stopped pass is proved again").toEqual([source, source, second]);
  });

  // The wrapper prints its lines in colour, so the recorded shape begins with an escape.
  const red = "\u001B[0m\u001B[31m";
  const pulses = [
    [
      "an idle-wall rerun",
      `${red}idle-wall: retrying 1 interrupted and 0 unfinished file(s) one at a time in one fresh process: test/two.test.ts`,
      true,
    ],
    ["an idle-wall error", `${red}idle-wall: error: the suite was ended by the idle wall`, false],
  ] as const;
  it.each(pulses)(
    "reports counts and rerun state after %s",
    (_name, wall, rerunning) => {
      const result = prove([`${source}:whole`], {
        ANA_FAKE_SUITE: `(pass) one\n(fail) two [5.00ms]\n1 tests failed:\n(fail) two [5.00ms]\n${wall}\n(pass) two`,
        ANA_GATE_PULSE_SECONDS: "1",
      });
      expect(result.status).toBe(0);
      const named = /Log: (\/\S+\.log)/u.exec(result.stderr)?.[1] ?? "";
      expect(readFileSync(named, "utf8")).toContain("(pass) two");
      expect(result.stderr).toContain(
        `prove: ${short(source)} still running after 0 min: 2 tests passed, 1 failed`,
      );
      expect(result.stderr.includes("are running again one at a time")).toBe(rerunning);
    },
    20_000,
  );
});

describe("one landing of a clone at a time", () => {
  /** The record a live process of this host holds a lock by (`holder.ts`). */
  const recordOf = (pid: number): string =>
    `${String(pid)} ${hostname()} ${execTextSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)]).trim()}`;

  it("waits while a live process holds the clone, and takes the lock over once its holder is gone", async () => {
    const clone = mkdtempSync(join(fixture, "alone-"));
    execTextSync("git", ["init", "-q"], { cwd: clone });
    const lock = join(clone, ".git", "ana-land.lock");
    const mine = String(runtimeProcess.pid);
    // The lock is a link whose target is its holder's record.
    symlinkSync(recordOf(runtimeProcess.pid), lock);
    const said: string[] = [];
    const held = holdAlone(clone, "land", (line) => said.push(line), 20);
    const early = await Promise.race([held.then(() => "held"), Bun.sleep(200).then(() => "waiting")]);
    expect(early).toBe("waiting");
    expect(said).toEqual([`another land (pid ${mine}) is running in this clone; waiting for it to end`]);
    // Above any pid either system gives, so no process answers it.
    rmSync(lock);
    symlinkSync("4194399", lock);
    const release = await held;
    expect(readlinkSync(lock)).toBe(recordOf(runtimeProcess.pid));
    release();
    const again = await holdAlone(clone, "land", () => undefined, 20);
    expect(readlinkSync(lock)).toBe(recordOf(runtimeProcess.pid));
    again();
  });

  it("ends a live holder whose note it covers, and waits out one it does not", async () => {
    const held = (): { clone: string; lock: string; holder: Bun.Subprocess } => {
      const clone = mkdtempSync(join(fixture, "alone-"));
      execTextSync("git", ["init", "-q"], { cwd: clone });
      const lock = join(clone, ".git", "ana-land.lock");
      const holder = Bun.spawn(["sleep", "30"]);
      symlinkSync(`${recordOf(holder.pid)} #5 sanitizing`, lock);
      return { clone, lock, holder };
    };
    const over = (note: string): boolean => note === "#5 sanitizing";
    const apart = held();
    const waiting = holdAlone(apart.clone, "land", () => undefined, 20, {
      note: "#4 sanitizing",
      over: () => false,
    });
    const early = await Promise.race([waiting.then(() => "held"), Bun.sleep(200).then(() => "waiting")]);
    expect(early, "a holder outside its claim is waited for").toBe("waiting");
    expect(apart.holder.killed).toBe(false);
    apart.holder.kill();
    (await waiting)();

    const { clone, lock, holder } = held();
    const said: string[] = [];
    const release = await holdAlone(clone, "land", (line) => said.push(line), 20, {
      note: "#6 sanitizing",
      over,
    });
    await holder.exited;
    expect(holder.signalCode).toBe("SIGTERM");
    expect(said.join("\n")).toContain(`pid ${String(holder.pid)}, #5 sanitizing`);
    expect(readlinkSync(lock)).toBe(`${recordOf(runtimeProcess.pid)} #6 sanitizing`);
    release();
  });

  it("lets one of many landings take a dead holder's lock, and the others wait for it", async () => {
    const clone = mkdtempSync(join(fixture, "alone-"));
    execTextSync("git", ["init", "-q"], { cwd: clone });
    symlinkSync("4194399", join(clone, ".git", "ana-land.lock"));
    const taker = join(clone, "taker.ts");
    const landingPath = JSON.stringify(join(import.meta.dir, "..", "tools", "runtime", "landing.ts"));
    writeFileSync(
      taker,
      [
        `import { holdAlone } from ${landingPath};`,
        // Every taker starts at one instant, so they meet at the takeover rather than one after another.
        `while (Date.now() < ${String(Date.now() + 3000)});`,
        `await holdAlone(${JSON.stringify(clone)}, "land", () => console.log("waiting"), 20);`,
        `console.log("held");`,
        "await Bun.sleep(30000);",
      ].join("\n"),
    );
    const takers = Array.from({ length: 8 }, () => Bun.spawn([capturedExecPath, taker], { stdout: "pipe" }));
    const firstLine = async (one: (typeof takers)[number]): Promise<string> => {
      const reader = one.stdout.getReader();
      let text = "";
      while (!text.includes("\n")) {
        const { done, value } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      return text.split("\n")[0] ?? "";
    };
    const said = await Promise.all(takers.map(firstLine));
    for (const one of takers) one.kill();
    expect(said.filter((one) => one === "held")).toHaveLength(1);
    expect(said.filter((one) => one === "waiting")).toHaveLength(7);
  }, 30_000);

  it("reads a holder whose live pid started at another time as gone, and ends nothing", async () => {
    const clone = mkdtempSync(join(fixture, "alone-"));
    execTextSync("git", ["init", "-q"], { cwd: clone });
    const lock = join(clone, ".git", "ana-land.lock");
    const stranger = Bun.spawn(["sleep", "30"]);
    symlinkSync(`${String(stranger.pid)} ${hostname()} Thu Jan  1 00:00:00 1970 #5 sanitizing`, lock);
    const held = holdAlone(clone, "land", () => undefined, 20, { note: "#6 sanitizing", over: () => true });
    const early = await Promise.race([held.then(() => "held"), Bun.sleep(500).then(() => "waiting")]);
    expect(early).toBe("held");
    expect(stranger.killed || stranger.signalCode !== null).toBe(false);
    stranger.kill();
    (await held)();
  });

  it("waits for a live landing that writes the older record, ends nothing, and takes the lock once it is gone", async () => {
    const clone = mkdtempSync(join(fixture, "alone-"));
    execTextSync("git", ["init", "-q"], { cwd: clone });
    const lock = join(clone, ".git", "ana-land.lock");
    const older = Bun.spawn(["sleep", "30"]);
    symlinkSync(`${String(older.pid)} #5 sanitizing`, lock);
    const held = holdAlone(clone, "land", () => undefined, 20, { note: "#6 sanitizing", over: () => true });
    const early = await Promise.race([held.then(() => "held"), Bun.sleep(300).then(() => "waiting")]);
    expect(early).toBe("waiting");
    expect(older.signalCode).toBe(null);
    expect(readlinkSync(lock)).toBe(`${String(older.pid)} #5 sanitizing`);
    older.kill();
    await older.exited;
    (await held)();
  });

  it("takes at once an older record whose pid is gone", async () => {
    const clone = mkdtempSync(join(fixture, "alone-"));
    execTextSync("git", ["init", "-q"], { cwd: clone });
    const lock = join(clone, ".git", "ana-land.lock");
    symlinkSync("4194399 #5 sanitizing", lock);
    const held = holdAlone(clone, "land", () => undefined, 20);
    const early = await Promise.race([held.then(() => "held"), Bun.sleep(300).then(() => "waiting")]);
    expect(early).toBe("held");
    expect(readlinkSync(lock)).toBe(recordOf(runtimeProcess.pid));
    (await held)();
  });

  it("takes over at once a lock an older landing left as a folder without its pid", async () => {
    const clone = mkdtempSync(join(fixture, "alone-"));
    execTextSync("git", ["init", "-q"], { cwd: clone });
    const lock = join(clone, ".git", "ana-land.lock");
    mkdirSync(lock);
    const held = holdAlone(clone, "land", () => undefined, 20);
    const early = await Promise.race([held.then(() => "held"), Bun.sleep(60).then(() => "waiting")]);
    expect(early).toBe("held");
    expect(readlinkSync(lock)).toBe(recordOf(runtimeProcess.pid));
    (await held)();
  });

  it("names each commit's pull request on the lines that name the commit", () => {
    const said: string[] = [];
    const proofs = ["a", "b", "c", "d"].map((letter) => ({ commit: letter.repeat(40), pass: null }));
    // #2 has no commit of its own: its head is #1's, so c and d are #3's.
    const pulls = [1, 2, 3].map((number) => ({ number, headRefOid: (number === 3 ? "d" : "b").repeat(40) }));
    const say = sayingPulls(proofs, pulls, (line) => said.push(line));
    say(`1 of 4, ${"a".repeat(9)}: documentation only.`);
    say(`${"c".repeat(9)} still running after 1 min`);
    say(`4 of 4, ${"d".repeat(9)}: passed.`);
    say("#1, #2, #3 onto main: 4 commits.");
    expect(said).toEqual([
      `1 of 4, pr1 ${"a".repeat(9)}: documentation only.`,
      `pr3 ${"c".repeat(9)} still running after 1 min`,
      `4 of 4, pr3 ${"d".repeat(9)}: passed.`,
      "#1, #2, #3 onto main: 4 commits.",
    ]);
  });
});
