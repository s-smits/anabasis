/**
 * `bun run runs outside` runs other owners' commands in one order: nothing is spent before both dry
 * runs, a step that fails ends the read, and a label the store holds is neither exported nor
 * carried again. The commands are read as words here and never run.
 */
import { describe, expect, test } from "bun:test";
import { benchesOf } from "../tools/runs/host-config.ts";
import { type Plan, readAs, readsArmed, settingsOf, stepsOf, walk } from "../tools/runs/outside.ts";

const HOSTS = JSON.stringify([
  { name: "builder", ssh: "you@builder", tree: "~/src/anabasis", bun: "~/.bun/bin/bun" },
  { name: "bench", ssh: "you@bench", tree: "~/src/anabasis", bun: "~/.bun/bin/bun" },
]);
const RUN = "stats-fresh-opus-builder";
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

function planOf(over: Partial<Plan> = {}): Plan {
  const saved = Bun.env.ANA_HOSTS;
  Bun.env.ANA_HOSTS = HOSTS;
  try {
    return {
      run: RUN,
      label: "ref-a1",
      harness: "a".repeat(64),
      login: "2",
      holder: { name: "builder", ssh: "you@builder", tree: "~/src/anabasis", bun: "~/.bun/bin/bun" },
      tree: "/home/you/control",
      bun: "bun",
      ...settingsOf(RUN, ENV),
      place: "linux-x64",
      held: null,
      wait: false,
      ...over,
    };
  } finally {
    if (saved === undefined) delete Bun.env.ANA_HOSTS;
    else Bun.env.ANA_HOSTS = saved;
  }
}

const said = (plan: Plan) => stepsOf(plan).map(({ says }) => says);
const text = (plan: Plan) => stepsOf(plan).map(({ command }) => command.join(" "));

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
  });

  test("pause --eval names its benchmarks as it is armed: none goes on as a pause alone, a faulty list refuses before the pause", () => {
    const saved = { hosts: Bun.env.ANA_HOSTS, benches: Bun.env.EVAL_RUNNER };
    const set = (name: "ANA_HOSTS" | "EVAL_RUNNER", value: string | undefined) => {
      if (value === undefined) delete Bun.env[name];
      else Bun.env[name] = value;
    };
    try {
      Object.assign(Bun.env, benches(STATS, { ...STATS, name: "second" }));
      expect(readsArmed(RUN)).toEqual(["statbench", "second"]);
      expect(readsArmed("other-fresh-opus-builder")).toEqual([]);
      // A machine named alone, as the setting read until 17 November, is no list.
      for (const old of ["{}", "bench"]) {
        Bun.env.EVAL_RUNNER = old;
        expect(() => readsArmed(RUN)).toThrow(/EVAL_RUNNER takes a JSON list of benchmarks/u);
      }
    } finally {
      set("ANA_HOSTS", saved.hosts);
      set("EVAL_RUNNER", saved.benches);
    }
  });

  test("the machine is asked first, and nothing is spent before both dry runs", () => {
    const steps = text(planOf());
    expect(said(planOf())).toEqual([
      "the benchmark's machine is idle",
      "export ref-a1 for linux-x64 on builder",
      "carry ref-a1 into the store on bench",
      "clear the export's stage",
      "the tree's own python3 on bench",
      "dry run of ref-a1",
      "dry run of starter-ref-a1",
      "start ref-a1 on login 2",
      "queue starter-ref-a1 behind it",
    ]);
    const spends = steps.map((step) => step.includes("--yes"));
    expect(spends.indexOf(true)).toBe(7);
    expect(steps.filter((step) => step.includes("--dry-run"))).toHaveLength(2);
    // The export runs where the campaign is, and the sitting where the store is.
    expect(steps[1]).toContain("you@builder");
    expect(steps[1]).toContain("score.ts tree --arm");
    expect(steps[7]).toContain("you@bench");
    // The carry moves the tree in only after the stream ended well, and never over one in place.
    expect(steps[2]).toContain("set -o pipefail");
    expect(steps[2]).toMatch(/test ! -e .*tar -xzf - .*&& mv /u);
  });

  test("a label the store holds is rolled as it stands, and one machine needs no carry", () => {
    expect(said(planOf({ held: "a".repeat(64) }))).not.toContain("export ref-a1 for linux-x64 on builder");
    expect(said(planOf({ held: "a".repeat(64) }))).toHaveLength(6);
    const one = planOf({ holder: planOf().runner });
    expect(said(one)).not.toContain("carry ref-a1 into the store on bench");
    expect(said(one)).toHaveLength(7);
    // The harness named reaches the export and the reference's arm, and never the Starter's.
    const named = text(planOf({ harness: "b".repeat(64) }));
    expect(named.filter((step) => step.includes("b".repeat(64)))).toHaveLength(3);
    expect(named.at(-1)).not.toContain("b".repeat(64));
  });

  test("a harness the store holds under another label is read once, unless --as names another read", () => {
    const held = new Map([
      ["ref-old", "a".repeat(64)],
      ["starter-old", "s".repeat(64)],
    ]);
    expect(readAs(held, "a".repeat(64), "aaaaaaaa")).toStrictEqual(["ref-old"]);
    expect(readAs(held, "a".repeat(64), "again-1", "again-1")).toStrictEqual([]);
    // Its own label goes on where an arm stopped, and another harness is no read of this one.
    expect(readAs(held, "a".repeat(64), "ref-old")).toStrictEqual([]);
    expect(readAs(held, "b".repeat(64), "bbbbbbbb")).toStrictEqual([]);
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
    const steps = stepsOf(planOf());
    const failing = walk(steps, (command) => {
      const words = command.join(" ");
      ran.push(words);
      return Promise.resolve(words.includes("--dry-run") ? 1 : 0);
    });
    await expect(failing).rejects.toThrow("dry run of ref-a1: exit 1; none of the 3 steps after it ran");
    expect(ran).toHaveLength(6);
    expect(ran.some((words) => words.includes("--yes"))).toBe(false);
  });
});
