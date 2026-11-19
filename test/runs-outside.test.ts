/**
 * `bun run runs outside` runs other owners' commands in one order: nothing is spent before both dry
 * runs, a step that fails ends the read, a tree reaches the store only whole and unchanged, and a
 * label the store holds is neither exported nor carried again. One read is walked end to end on
 * this machine, with a stand-in export and sitting; the rest are read as words.
 */
import { namedIn } from "../tools/runs/hosts.ts";
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { benchesOf } from "../tools/runs/host-config.ts";
import {
  evalOf,
  heldAs,
  opened,
  type Plan,
  sealed,
  settingsOf,
  stepsOf,
  walk,
} from "../tools/runs/outside.ts";
import { Misused } from "../tools/runs/registry.ts";

const HOSTS = JSON.stringify([
  { name: "builder", ssh: "you@builder", tree: "~/src/anabasis", bun: "~/.bun/bin/bun" },
  { name: "bench", ssh: "you@bench", tree: "~/src/anabasis", bun: "~/.bun/bin/bun" },
]);
const RUN = "stats-fresh-opus-builder";
const DIGEST = "a".repeat(64);
const STATS = {
  name: "statbench",
  host: "bench",
  store: "bench/store",
  sitting: "bin/sitting.sh",
  packs: ["stats"],
};
const benches = (...list: readonly Partial<typeof STATS>[]) => ({
  ANA_HOSTS: HOSTS,
  EVAL_RUNNER: JSON.stringify(list),
});
const ENV = benches(STATS);

const planOf = (over: Partial<Plan> = {}): Plan => ({
  run: RUN,
  label: "ref-a1",
  harness: DIGEST,
  login: "2",
  holder: { name: "builder", ssh: "you@builder", tree: "~/src/anabasis", bun: "~/.bun/bin/bun" },
  tree: "/home/you/control",
  bun: "bun",
  ...settingsOf(RUN, ENV),
  place: "linux-x64",
  python: "3.12",
  held: null,
  wait: false,
  ...over,
});

const said = (plan: Plan) => stepsOf(plan).map(({ says }) => says);
const text = (plan: Plan) => stepsOf(plan).map(({ command }) => command.join(" "));

/** A folder for one test, gone after it. */
function inScratch(name: string, body: (root: string) => Promise<void> | void) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), `${name}-`));
    try {
      await body(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

describe("runs outside", () => {
  test("a run's pack chooses its benchmark, and a choice the list leaves open refuses before any machine is asked", () => {
    expect(settingsOf(RUN, ENV)).toMatchObject({ bench: "statbench", runner: { name: "bench" } });
    // A benchmark with no machine named is rolled on this one.
    const { host: _, ...local } = STATS;
    expect(settingsOf(RUN, benches(local)).runner).toBeUndefined();
    expect(() => settingsOf("other-fresh-opus-builder", ENV)).toThrow(/no benchmark reads pack other/u);
    // A pack listed reads the packs named from it, and no pack that merely starts with its letters.
    expect(settingsOf("stats-v2-fresh-opus-builder", ENV).bench).toBe("statbench");
    expect(() => settingsOf("statsx-fresh-opus-builder", ENV)).toThrow(/no benchmark reads pack statsx/u);
    // Two benchmarks that read one pack each take a read of their own, named.
    const two = benches(STATS, { ...STATS, name: "second", packs: ["stats", "other"] });
    expect(() => settingsOf(RUN, two)).toThrow(/statbench, second read it; name one with --bench/u);
    expect(settingsOf(RUN, two, "second").bench).toBe("second");
    // The single machine of before is not read.
    expect(() => settingsOf(RUN, { ANA_HOSTS: HOSTS, ABLATION_HOST: "bench" })).toThrow(/no benchmark/u);
  });

  test("a benchmark entry without its store, its sitting or a host the list holds is refused", () => {
    const { store: _, ...storeless } = STATS;
    expect(() => benchesOf(benches(storeless))).toThrow(/needs a safe name, a store and a sitting command/u);
    expect(() => benchesOf(benches({ ...STATS, packs: [] }))).toThrow(/statbench: packs takes/u);
    expect(() => benchesOf(benches(STATS, STATS))).toThrow(/repeats statbench/u);
    expect(() => benchesOf(benches({ ...STATS, host: "nowhere" }))).toThrow(/no host nowhere/u);
    expect(benchesOf({})).toEqual([]);
    // A verb kept to this machine reads the benchmark rolled here and none rolled elsewhere.
    const { host: _host, ...local } = { ...STATS, name: "local" };
    const kept = benchesOf({ ...benches(STATS, local), ANA_HOP: "1" });
    expect(kept.map(({ name, host }) => [name, host])).toEqual([["local", undefined]]);
  });

  test("pause --eval owes one waiting read a benchmark of the run, named before the pause is armed", () => {
    const two = benches(STATS, { ...STATS, name: "second" });
    const pause = ["--after", "reported", RUN];
    expect(evalOf([...pause, "--yes"], two)).toEqual({ passed: [...pause, "--yes"], reads: [] });
    expect(evalOf([...pause, "--eval", "--yes"], two)).toEqual({
      passed: [...pause, "--yes"],
      reads: [
        [RUN, "--bench", "statbench", "--wait", "--yes"],
        [RUN, "--bench", "second", "--wait", "--yes"],
      ],
    });
    // Without --yes each read is a plan; a run no benchmark reads is paused alone.
    expect(evalOf([RUN, "--eval"], ENV).reads).toEqual([[RUN, "--bench", "statbench", "--wait"]]);
    expect(evalOf(["other-fresh-opus-builder", "--eval"], two).reads).toEqual([]);
    // A machine named alone, as the setting read until 17 November, is no list, and is refused as
    // a plain error, which the CLI prints as a refusal and not as a defect with its stack.
    for (const [old, says] of [
      ["{}", /EVAL_RUNNER takes a JSON list/u],
      ["bench", /EVAL_RUNNER is not JSON/u],
    ] as const) {
      const refusal = (() => {
        try {
          return evalOf([RUN, "--eval"], { ANA_HOSTS: HOSTS, EVAL_RUNNER: old });
        } catch (error) {
          return error;
        }
      })();
      const read = refusal instanceof Error ? [refusal.constructor, refusal.message] : refusal;
      expect(read).toEqual([Error, expect.stringMatching(says)]);
    }
    // A run named past a `--` is paused and would be read nowhere, so the flag is refused there.
    expect(namedIn("pause", ["--after", "reported", RUN, "--yes"])).toEqual([RUN]);
    expect(() => evalOf(["--eval", "--", RUN], ENV)).toThrow(Misused);
  });

  test("the machine is asked first, and nothing is spent before both dry runs", () => {
    const steps = text(planOf());
    expect(said(planOf())).toEqual([
      "the benchmark's machine is idle",
      "export ref-a1 for linux-x64 on builder",
      "carry ref-a1 into the store on bench",
      "clear the export's stage",
      "dry run of ref-a1",
      "dry run of starter-ref-a1",
      "roll ref-a1, then starter-ref-a1, on login 2",
    ]);
    expect(steps.map((step) => step.includes("--yes"))).toEqual([
      ...Array.from({ length: 6 }, () => false),
      true,
    ]);
    // The export runs where the campaign is, and the sitting where the store is.
    expect(steps[1]).toContain("you@builder");
    expect(steps[1]).toContain(String.raw`--for '\''linux-x64'\'' --python '\''3.12'\''`);
    expect(steps[6]).toContain("you@bench");
  });

  test(
    "a read walks on one machine: export, carry, both dry runs, then the reference before the Starter",
    inScratch("outside-walk", async (root) => {
      const control = join(root, "control");
      const store = join(root, "store");
      const ran = join(root, "ran.txt");
      mkdirSync(control);
      const script = (name: string, body: string) => {
        writeFileSync(join(root, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
        return join(root, name);
      };
      // The export's stand-in writes a tree and its build record where `--out` says.
      const bun = script(
        "bun",
        'while [ $# -gt 0 ]; do case "$1" in --name) n=$2;; --out) o=$2;; esac; shift; done\nmkdir -p "$o/trees/$n" && echo guide > "$o/trees/$n/CLAUDE.md" && echo "{}" > "$o/trees/$n.build.json"',
      );
      const sitting = script("sitting", `case "$1" in status) echo idle;; run) echo "$*" >> ${ran};; esac`);
      const plan = planOf({ holder: undefined, runner: undefined, tree: control, bun, store, sitting });
      const env = { ...Bun.env, TMPDIR: root };
      await walk(
        stepsOf(plan),
        async (command) => await Bun.spawn([...command], { env, stdout: "ignore" }).exited,
      );
      expect(readdirSync(join(store, "trees")).toSorted()).toEqual(["ref-a1", "ref-a1.build.json"]);
      expect(readdirSync(join(store, "trees", "ref-a1"))).toEqual(["CLAUDE.md"]);
      expect(existsSync(join(root, "ana-outside-read-ref-a1"))).toBe(false);
      // The arms roll detached from the read, one after the other.
      for (
        let at = 0;
        at < 100 && (existsSync(ran) ? readFileSync(ran, "utf8") : "").split("\n").length < 5;
        at += 1
      ) {
        await Bun.sleep(20);
      }
      const arms = readFileSync(ran, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split(" "));
      expect(arms.map((words) => [words[2], words.at(-1)])).toEqual([
        ["ref-a1", "--dry-run"],
        ["starter-ref-a1", "--dry-run"],
        ["ref-a1", "--yes"],
        ["starter-ref-a1", "--yes"],
      ]);
      expect(arms.map((words) => words[1])).toEqual(["2", "2", "2", "2"]);
    }),
  );

  test(
    "the carry moves a tree in only whole, unchanged and with no link to the build machine",
    inScratch("outside-carry", (root) => {
      const from = join(root, "stage");
      const trees = join(root, "store", "trees");
      mkdirSync(join(from, "ref-a1", "tools"), { recursive: true });
      // Bytes that do not compress, seeded, so that a byte changed in the stream lands in a file's.
      let seed = 7;
      const noise = Uint8Array.from(
        { length: 20_000 },
        () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) >> 23,
      );
      writeFileSync(join(from, "ref-a1", "tools", "run"), noise);
      writeFileSync(join(from, "ref-a1", ".DS_Store"), "finder");
      writeFileSync(join(from, "ref-a1.build.json"), "{}");
      const stream = () => Bun.spawnSync(["/bin/sh", "-c", sealed(from, "ref-a1")]).stdout;
      const open = (bytes: Uint8Array) =>
        Bun.spawnSync(["/bin/sh", "-c", opened(trees, "ref-a1")], { stdin: bytes }).exitCode;
      // A stream cut short, and one with a byte changed, which bsdtar alone would extract, move nothing in.
      expect(open(stream().subarray(0, 60))).not.toBe(0);
      const changed = stream();
      const at = Math.floor(changed.length / 2);
      changed.set([(changed[at] ?? 0) ^ 1], at);
      expect(open(changed)).not.toBe(0);
      expect(existsSync(join(trees, "ref-a1"))).toBe(false);
      // A link to an absolute path names the build machine's files and is refused.
      symlinkSync("/opt/build/python3", join(from, "ref-a1", "tools", "python3"));
      expect(open(stream())).not.toBe(0);
      expect(existsSync(join(trees, "ref-a1"))).toBe(false);
      rmSync(join(from, "ref-a1", "tools", "python3"));
      expect(open(stream())).toBe(0);
      expect(readdirSync(trees).toSorted()).toEqual(["ref-a1", "ref-a1.build.json"]);
      expect(readdirSync(join(trees, "ref-a1"))).toEqual(["tools"]);
      // A tree in place is never written over.
      expect(open(stream())).not.toBe(0);
    }),
  );

  test("a label the store holds is rolled as it stands, with no export, carry or machine that holds the run", () => {
    const held = planOf({ held: DIGEST, holder: undefined });
    expect(said(held)).toEqual([
      "the benchmark's machine is idle",
      "dry run of ref-a1",
      "dry run of starter-ref-a1",
      "roll ref-a1, then starter-ref-a1, on login 2",
    ]);
    // The harness named reaches the export and the reference's arm, and never the Starter's.
    const named = text(planOf({ harness: "b".repeat(64) }));
    expect(named.filter((step) => step.includes("b".repeat(64)))).toHaveLength(3);
    expect(named[5]).not.toContain("b".repeat(64));
  });

  test("a harness is read once unless --as names another read, and a label binds one tree", () => {
    const store = new Map([
      ["ref-old", DIGEST],
      ["starter-old", "s".repeat(64)],
    ]);
    expect(heldAs(store, DIGEST, "aaaaaaaa")).toEqual({ again: ["ref-old"], held: null });
    expect(heldAs(store, DIGEST, "again-1", "again-1")).toEqual({ again: [], held: null });
    // Its own label goes on where an arm stopped, and another harness is no read of this one.
    expect(heldAs(store, DIGEST, "ref-old")).toEqual({ again: [], held: DIGEST });
    expect(heldAs(store, "b".repeat(64), "bbbbbbbb")).toEqual({ again: [], held: null });
    expect(() => heldAs(store, "b".repeat(64), "ref-old", "ref-old")).toThrow(/binds one tree/u);
    // A letter is no digest to set against the store's, so its label is rolled as the store holds it.
    expect(heldAs(store, "C", "ref-old", "ref-old")).toEqual({ again: [], held: DIGEST });
  });

  test("a read that waits looks again while an arm holds the machine, and one that does not refuses", () => {
    const [waits] = text(planOf({ wait: true }));
    const [refuses] = text(planOf());
    expect(waits).toMatch(/until .*status \| head -n 1 \| grep -qx idle; do sleep 300; done/u);
    expect(waits).not.toContain("exit 1");
    expect(refuses).toContain("exit 1");
    expect(said(planOf({ wait: true })).slice(1)).toEqual(said(planOf()).slice(1));
  });

  test("a failed dry run starts nothing", async () => {
    const ran: string[] = [];
    const failing = walk(stepsOf(planOf()), (command) => {
      const words = command.join(" ");
      ran.push(words);
      return Promise.resolve(words.includes("--dry-run") ? 1 : 0);
    });
    await expect(failing).rejects.toThrow("dry run of ref-a1: exit 1; none of the 2 steps after it ran");
    expect(ran).toHaveLength(5);
    expect(ran.some((words) => words.includes("--yes"))).toBe(false);
  });
});
