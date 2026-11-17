/**
 * `bun run runs outside` runs other owners' commands in one order: nothing is spent before both dry
 * runs, a step that fails ends the read, and a label the store holds is neither exported nor
 * carried again. The commands are read as words here and never run.
 */
import { describe, expect, test } from "bun:test";
import { type Plan, settingsOf, stepsOf, walk } from "../tools/runs/outside.ts";

const HOSTS = JSON.stringify([
  { name: "builder", ssh: "you@builder", tree: "~/src/anabasis", bun: "~/.bun/bin/bun" },
  { name: "bench", ssh: "you@bench", tree: "~/src/anabasis", bun: "~/.bun/bin/bun" },
]);
const ENV = {
  ANA_HOSTS: HOSTS,
  ABLATION_HOST: "bench",
  BENCH_STORE: "bench/store",
  BENCH_SITTING: "bin/sitting.sh",
};

function planOf(over: Partial<Plan> = {}): Plan {
  const saved = Bun.env.ANA_HOSTS;
  Bun.env.ANA_HOSTS = HOSTS;
  try {
    return {
      run: "stats-fresh-opus-builder",
      label: "ref-a1",
      login: "2",
      holder: { name: "builder", ssh: "you@builder", tree: "~/src/anabasis", bun: "~/.bun/bin/bun" },
      tree: "/home/you/control",
      bun: "bun",
      ...settingsOf(ENV),
      place: "linux-x64",
      held: null,
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
  test("a setting left unset refuses and names it, before any machine is asked", () => {
    expect(() => settingsOf({ ...ENV, BENCH_SITTING: "" })).toThrow(/^BENCH_SITTING unset/u);
    expect(() => settingsOf({ ANA_HOSTS: HOSTS })).toThrow(/^BENCH_STORE and BENCH_SITTING unset/u);
    // Unset or `here`, the benchmark is rolled on this machine.
    expect(settingsOf({ ...ENV, ABLATION_HOST: "here" }).bench).toBeUndefined();
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
    const one = planOf({ holder: planOf().bench });
    expect(said(one)).not.toContain("carry ref-a1 into the store on bench");
    expect(said(one)).toHaveLength(7);
    // The harness named reaches the export and the reference's arm, and never the Starter's.
    const named = text(planOf({ harness: "b".repeat(64) }));
    expect(named.filter((step) => step.includes("b".repeat(64)))).toHaveLength(3);
    expect(named.at(-1)).not.toContain("b".repeat(64));
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
