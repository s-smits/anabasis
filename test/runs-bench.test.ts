import { describe, expect, test } from "bun:test";
import { benchesOf } from "../tools/runs/host-config.ts";
import { type Plan, settingsOf, stepsOf, walk } from "../tools/runs/bench.ts";

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

describe("runs bench", () => {
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
