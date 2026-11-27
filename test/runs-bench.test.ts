import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { benchesOf } from "../tools/runs/host-config.ts";
import {
  bench,
  completedBenchPairs,
  defaultBenchLabel,
  heldAs,
  type Plan,
  probed,
  settingsOf,
  stepsOf,
  walk,
} from "../tools/runs/bench.ts";

const scratch: string[] = [];
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
  baseline: "base",
  ...over,
});

const said = (plan: Plan) => stepsOf(plan).map(({ says }) => says);
const text = (plan: Plan) => stepsOf(plan).map(({ command }) => command.join(" "));
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe("runs bench", () => {
  test("a run's pack chooses its benchmark, and a choice the list leaves open refuses before any machine is asked", () => {
    expect(settingsOf(RUN, ENV)).toMatchObject({ bench: "statbench", runner: { name: "bench" } });
    const { host: _, ...local } = STATS;
    expect(settingsOf(RUN, benches(local)).runner).toBeUndefined();
    expect(() => settingsOf("other-fresh-opus-builder", ENV)).toThrow(/no benchmark reads pack other/u);
    // A pack listed reads the packs named from it, and no pack that merely starts with its letters.
    expect(settingsOf("stats-v2-fresh-opus-builder", ENV).bench).toBe("statbench");
    expect(() => settingsOf("statsx-fresh-opus-builder", ENV)).toThrow(/no benchmark reads pack statsx/u);
    const two = benches(STATS, { ...STATS, name: "second", packs: ["stats", "other"] });
    expect(() => settingsOf(RUN, two)).toThrow(/statbench, second read it; name one with --bench/u);
    expect(settingsOf(RUN, two, "second").bench).toBe("second");
    expect(() => settingsOf(RUN, { ANA_HOSTS: HOSTS, ABLATION_HOST: "bench" })).toThrow(/no benchmark/u);
  });

  test("a benchmark entry without its store, its sitting or a host the list holds is refused", () => {
    const { store: _, ...storeless } = STATS;
    expect(() => benchesOf(benches(storeless))).toThrow(/needs a safe name, a store and a sitting command/u);
    expect(() => benchesOf(benches({ ...STATS, packs: [] }))).toThrow(/statbench: packs takes/u);
    expect(() => benchesOf(benches(STATS, STATS))).toThrow(/repeats statbench/u);
    expect(() => benchesOf(benches({ ...STATS, host: "nowhere" }))).toThrow(/no host nowhere/u);
    expect(benchesOf({})).toEqual([]);
    const { host: _host, ...local } = { ...STATS, name: "local" };
    const kept = benchesOf({ ...benches(STATS, local), ANA_HOP: "1" });
    expect(kept.map(({ name, host }) => [name, host])).toEqual([["local", undefined]]);
  });

  test("the machine is asked first, and nothing is spent before both dry runs", () => {
    const steps = text(planOf());
    expect(said(planOf())).toEqual([
      "the benchmark's machine is idle",
      "export ref-a1 for linux-x64 on builder",
      "carry ref-a1 into the store on bench",
      "clear the export's stage",
      "dry run of ref-a1",
      "dry run of base-ref-a1",
      "roll ref-a1, then base-ref-a1, on login 2",
    ]);
    expect(steps.map((step) => step.includes("--yes"))).toEqual([
      ...Array.from({ length: 6 }, () => false),
      true,
    ]);
    // The export runs where the campaign is, and the sitting where the store is.
    expect(steps[1]).toContain("you@builder");
    expect(steps[1]).toContain(String.raw`--arm '\''pi:stats-fresh-opus-builder'\''`);
    expect(steps[1]).toContain(String.raw`--for '\''linux-x64'\'' --python '\''3.12'\''`);
    expect(steps[4]).toContain(String.raw`--arm '\''pi:stats-fresh-opus-builder'\''`);
    expect(steps[5]).toContain(String.raw`--arm '\''pi:base'\''`);
    expect(steps[6]).toContain("you@bench");
    expect(steps[6]).toContain(`pi:${RUN}`);
    expect(steps[6]).toContain("pi:base");
    // Reference must succeed before the paired baseline rolls.
    expect(steps[6]).toContain("--yes && ");
    expect(steps[6]).not.toContain("--yes; ");
  });

  test("native pi supports starter fallback and refuses unknown baseline names", async () => {
    const starterSteps = text(planOf({ label: "pi-ref-a1", baseline: "starter" }));
    expect(starterSteps[5]).toContain(String.raw`--arm '\''pi:starter'\''`);
    expect(starterSteps[6]).toContain("starter-pi-ref-a1");

    await expect(bench([RUN, "--baseline", "other"])).rejects.toThrow(/--baseline takes base or starter/u);
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

  test("completedBenchPairs handles both base- and starter- baselines with exact task matching", async () => {
    const store = mkdtempSync(join(tmpdir(), "ana-bench-scores-"));
    scratch.push(store);
    const put = (arm: string, task: string, runtime?: string) => {
      mkdirSync(join(store, "judged", arm), { recursive: true });
      const body = runtime === undefined ? "{}\n" : `${JSON.stringify({ runtime })}\n`;
      writeFileSync(join(store, "judged", arm, `${task}.json`), body);
    };
    put("ref-a1", "t1");
    put("starter-ref-a1", "t1");
    put("starter-ref-a1", "t2");
    put("pi-a2", "t1", "pi-durable");
    put("base-pi-a2", "t1", "pi-durable");
    put("pi-mixed", "t1", "pi-durable");
    put("starter-pi-mixed", "t1", "claude-code");
    put("pi-self-mixed", "t1", "pi-durable");
    put("pi-self-mixed", "t2", "claude-code");
    put("base-pi-self-mixed", "t1", "pi-durable");
    put("base-pi-self-mixed", "t2", "pi-durable");
    expect(completedBenchPairs(store)).toEqual([{ label: "pi-a2", baseline: "base-pi-a2" }]);
    put("ref-a1", "t2");
    expect(completedBenchPairs(store)).toEqual([
      { label: "pi-a2", baseline: "base-pi-a2" },
      { label: "ref-a1", baseline: "starter-ref-a1" },
    ]);
    mkdirSync(join(store, "scored"), { recursive: true });
    writeFileSync(join(store, "scored", "pi-a2.txt"), "all 1\n  pi-a2 score 10/10\n");
    expect(completedBenchPairs(store)).toEqual([{ label: "ref-a1", baseline: "starter-ref-a1" }]);
    put("pi-a2", "t2", "pi-durable");
    put("base-pi-a2", "t2", "pi-durable");
    mkdirSync(join(store, "judged", "corrupt-arm"), { recursive: true });
    writeFileSync(join(store, "judged", "corrupt-arm", "t1.json"), "{not-json");
    expect(completedBenchPairs(store)).toEqual([
      { label: "pi-a2", baseline: "base-pi-a2" },
      { label: "ref-a1", baseline: "starter-ref-a1" },
    ]);
    await expect(bench(["--bench", "no-such-bench"])).rejects.toThrow("no benchmark no-such-bench");
  });

  test("heldAs deduplicates native pi trees, reports legacy claude reads, and refuses legacy label reuse", () => {
    expect(probed({ sitting: "bin/sitting.sh", store: "bench/store" })).toContain(
      `grep -EH '"(harness|mode|programsOf)"'`,
    );
    const store = new Map([
      ["aaaaaaaa", DIGEST],
      ["pi-aaaaaaaa", DIGEST],
    ]);
    const modes = new Map<string, "claude" | "pi">([["pi-aaaaaaaa", "pi"]]);
    expect(heldAs(store, DIGEST, "pi-other", { modes })).toEqual({
      again: ["pi-aaaaaaaa"],
      held: null,
      legacy: ["aaaaaaaa"],
    });
    expect(heldAs(new Map([["aaaaaaaa", DIGEST]]), DIGEST, "pi-aaaaaaaa")).toEqual({
      again: [],
      held: null,
      legacy: ["aaaaaaaa"],
    });
    expect(heldAs(store, DIGEST, "pi-aaaaaaaa", { modes })).toEqual({
      again: [],
      held: DIGEST,
      legacy: ["aaaaaaaa"],
    });
    expect(() => heldAs(store, DIGEST, "aaaaaaaa", { modes })).toThrow("legacy claude export");
    expect(defaultBenchLabel(DIGEST)).toBe("pi-aaaaaaaa");
    expect(defaultBenchLabel(`programs-of:${DIGEST}`)).toBe("pi-programs-aaaaaaaa");
    expect(defaultBenchLabel("B")).toBe("");
    const OTHER = "b".repeat(64);
    const progStore = new Map([["pi-programs-aaaaaaaa", "c".repeat(64)]]);
    const progModes = new Map<string, "claude" | "pi">([["pi-programs-aaaaaaaa", "pi"]]);
    const progMap = new Map([["pi-programs-aaaaaaaa", DIGEST]]);
    expect(
      heldAs(progStore, `programs-of:${DIGEST}`, "pi-programs-other", {
        modes: progModes,
        programsOf: progMap,
      }),
    ).toEqual({ again: ["pi-programs-aaaaaaaa"], held: null, legacy: [] });
    expect(() =>
      heldAs(progStore, `programs-of:${OTHER}`, "pi-programs-aaaaaaaa", {
        modes: progModes,
        programsOf: progMap,
      }),
    ).toThrow(/not programs-of:bbbbbbbb/u);
    expect(() =>
      heldAs(store, "programs-of:B", "pi-aaaaaaaa", {
        as: "pi-aaaaaaaa",
        modes,
        programsOf: progMap,
      }),
    ).toThrow(/not programs-of:B/u);
    expect(() =>
      heldAs(store, "programs-of:B", "pi-aaaaaaaa", {
        as: "pi-aaaaaaaa",
        modes,
      }),
    ).toThrow(/not programs-of:B/u);
    expect(() =>
      heldAs(progStore, "B", "pi-programs-aaaaaaaa", {
        as: "pi-programs-aaaaaaaa",
        modes: progModes,
        programsOf: progMap,
      }),
    ).toThrow(/for programs-of:aaaaaaaa, not B/u);
    expect(
      heldAs(progStore, "programs-of:B", "pi-programs-aaaaaaaa", {
        as: "pi-programs-aaaaaaaa",
        modes: progModes,
        programsOf: progMap,
      }),
    ).toEqual({ again: [], held: "c".repeat(64), legacy: [] });
  });
});
