// The two readers that group texts on the local model: which rulings say one thing, and how alike an
// exam's tasks read. The embedder is scripted, so no test loads a model: a text's `group-N` picks its
// vector, and a text without one gets a vector of its own.
import { afterAll, describe, expect, it } from "bun:test";
import type { EventKind } from "../src/kernel/log.ts";
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfNotNull } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { newsIn } from "../tools/runs/pulse-readers.ts";
import { READERS, readersOf } from "../tools/wri/derive.ts";
import { dot, type Embed, groupsOf } from "../tools/wri/embed.ts";
import { nearnessOf } from "../tools/wri/nearness.ts";
import { restatedOf } from "../tools/wri/restated.ts";
import { roundSolves } from "./helpers/logged-round.ts";
import { fakeEmbed } from "./helpers/fake-embed.ts";

const CANARY = "hidden-value-71839";
const WIDTH = 16;
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});
function scratch(): string {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-near-")));
  folders.push(folder);
  return folder;
}

const line = (kind: EventKind, data: JsonObject) =>
  `${JSON.stringify({ at: new Date(0).toISOString(), kind, data })}\n`;

function logOf(lines: readonly string[]): { log: string; store: string } {
  const root = scratch();
  const log = join(root, "log.jsonl");
  writeFileSync(log, lines.join(""));
  return { log, store: join(root, "store") };
}

/** An embedder that counts what it is asked, and stops part-way as a kill does. */
function scripted(stopAfter = Number.POSITIVE_INFINITY) {
  const asked: string[] = [];
  let batches = 0;
  const embed: Embed = async (texts) => {
    if (batches >= stopAfter) throw new Error("cut");
    batches += 1;
    asked.push(...texts);
    const own = await fakeEmbed(texts);
    return texts.map((words, at) => {
      const group = /group-(\d+)/.exec(words)?.[1];
      if (group === undefined) return own[at] ?? new Float32Array();
      const axis = new Float32Array(WIDTH);
      axis[Number(group)] = 1;
      return axis;
    });
  };
  return { asked, load: async () => embed };
}
const noModel = async (): Promise<Embed> => {
  throw new Error("no model should load");
};

const refused = (solve: string, checks: readonly string[]) =>
  line("verdict", { solve, kind: "fail", blocking: [...checks] });
const ruled = (solve: string, task: string, ruling: string, reason: string) =>
  line("referee.finding", { solve, task, ruling, reason });

describe("groupsOf", () => {
  const unit = (at: number) => {
    const axis = new Float32Array(WIDTH);
    axis[at] = 1;
    return axis;
  };
  it("joins two at the line, and leaves one just under it apart", () => {
    const tilted = Float32Array.from(unit(0));
    tilted[0] = 0.97;
    tilted[1] = Math.sqrt(1 - 0.97 ** 2);
    expect(dot(unit(0), tilted)).toBeLessThan(0.98);
    const [one, other] = groupsOf([unit(0), tilted], 0.98);
    expect(one).not.toBe(other);
    const [first, second] = groupsOf([unit(0), tilted], 0.97);
    expect(first).toBe(second);
  });
  it("carries a group through a chain of near vectors", () => {
    const step = (at: number) => {
      const axis = new Float32Array(WIDTH);
      axis[0] = Math.cos(at * 0.15);
      axis[1] = Math.sin(at * 0.15);
      return axis;
    };
    const chain = [step(0), step(1), step(2), unit(5)];
    expect(dot(chain[0] ?? unit(0), chain[2] ?? unit(0))).toBeLessThan(0.98);
    const roots = groupsOf(chain, 0.98);
    expect(new Set(roots.slice(0, 3)).size).toBe(1);
    expect(roots[3]).not.toBe(roots[0]);
  });
});

describe("restated", () => {
  const FIVE_OF_ONE = [
    refused("s-1", ["ph"]),
    ruled("s-1", "t-1", "earned", `group-1 first wording ${CANARY}`),
    refused("s-2", ["ph"]),
    ruled("s-2", "t-2", "earned", `group-1 second wording ${CANARY}`),
    refused("s-3", ["ph"]),
    ruled("s-3", "t-3", "earned", `group-1 third wording ${CANARY}`),
    refused("s-4", ["capacity"]),
    ruled("s-4", "t-4", "earned", `a wording of its own ${CANARY}`),
    refused("s-5", ["capacity"]),
    ruled("s-5", "t-5", "unclear", `another of its own ${CANARY}`),
  ];

  it("names a group with its tasks, rulings and checks, and no group of one", async () => {
    const { log, store } = logOf(FIVE_OF_ONE);
    const said = await restatedOf(log, { store, load: scripted().load });
    expect(said[0]).toStartWith(
      "restated: 5 rulings in 3 groups at 0.93; 3 in a group of 3 or more; 0 groups",
    );
    expect(said.slice(1)).toEqual(["restated: 3 rulings on 3 tasks, earned 3; check ph"]);
  });

  it("puts one complaint ruled two ways first, even as a pair", async () => {
    const { log, store } = logOf([
      ...FIVE_OF_ONE,
      refused("s-6", ["cap"]),
      ruled("s-6", "t-6", "earned", "group-2 one way"),
      refused("s-7", ["cap"]),
      ruled("s-7", "t-7", "check-defect", "group-2 the other"),
    ]);
    const said = await restatedOf(log, { store, load: scripted().load });
    expect(said[1]).toBe("ruled two ways: 2 rulings on 2 tasks, check-defect 1, earned 1; check cap");
    expect(said[2]).toStartWith("restated: 3 rulings");
  });

  it("reads a second ruling of one solve as that solve's ruling, once", async () => {
    const { log, store } = logOf([
      refused("s-1", ["ph"]),
      ruled("s-1", "t-1", "unclear", "group-1 first"),
      ruled("s-1", "t-1", "earned", "group-1 second"),
    ]);
    const said = await restatedOf(log, { store, load: scripted().load });
    expect(said).toEqual([
      "restated: 1 rulings in 1 groups at 0.93; 0 in a group of 3 or more; 0 groups ruled two ways; embedded 1 this read",
    ]);
  });

  it("prints no reason, and says one line where no ruling holds one", async () => {
    const { log, store } = logOf(FIVE_OF_ONE);
    const said = await restatedOf(log, { store, load: scripted().load });
    expect(said.join("\n")).not.toContain(CANARY);
    expect(said.join("\n")).not.toContain("wording");
    const silent = logOf([ruled("s-1", "t-1", "earned", "  ")]);
    expect(await restatedOf(silent.log, { store: silent.store, load: noModel })).toEqual([
      "restated: no ruling on record holds a reason",
    ]);
  });

  it("keeps what a cut finished, and embeds only the rest", async () => {
    const lines = Array.from({ length: 40 }, (_, at) => {
      const solve = `s-${String(at)}`;
      return refused(solve, ["ph"]) + ruled(solve, `t-${String(at)}`, "earned", `reason ${String(at)}`);
    });
    const { log, store } = logOf(lines);
    const cut = scripted(1);
    const stopped = await restatedOf(log, { store, load: cut.load });
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toContain("no reading");
    expect(stopped[0]).toContain("16 of 40 texts embedded: cut");
    const rest = scripted();
    await restatedOf(log, { store, load: rest.load });
    expect(rest.asked).toHaveLength(24);
    expect(cut.asked.filter((words) => rest.asked.includes(words))).toEqual([]);
  });

  it("loads no model on a read with nothing new, and embeds only an append's words", async () => {
    const { log, store } = logOf(FIVE_OF_ONE);
    await restatedOf(log, { store, load: scripted().load });
    expect((await restatedOf(log, { store, load: noModel }))[0]).toContain("embedded 0 this read");
    appendFileSync(log, ruled("s-9", "t-9", "earned", "one new reason"));
    const append = scripted();
    await restatedOf(log, { store, load: append.load });
    expect(append.asked).toEqual(["one new reason"]);
  });
});

describe("nearness", () => {
  const task = (version: string, session: string | null, publicInput: JsonObject | string) =>
    line("task.proposed", {
      version,
      taskId: version,
      ...keyIfNotNull("session", session),
      task: { taskId: version, family: "f", publicInput, hidden: { secret: CANARY } },
    }) + line("task.gate", { version, gate: 1, outcome: "passed" });
  const reported = (session: string, reading: string, outcomes: Readonly<Record<string, string>>) => {
    const { events, terms } = roundSolves(session, ["h1", "h2"], outcomes);
    return [
      ...events.map(({ kind, data }) => line(kind, data)),
      line("comparison.reported", {
        session,
        old: "h1",
        fresh: "h2",
        starter: "h1",
        reading,
        scored: { wins: 0, losses: 0, ties: 0 },
        ...terms,
      }),
    ];
  };

  it("reads a session of near tasks apart from one of far ones", async () => {
    const { log, store } = logOf([
      task("v1", "e-1", `group-1 first ${CANARY}`),
      task("v2", "e-1", `group-1 second ${CANARY}`),
      task("v3", "e-1", `group-1 third ${CANARY}`),
      task("v4", "e-2", { title: `its own ${CANARY}` }),
      task("v5", "e-2", { title: `another ${CANARY}` }),
    ]);
    const said = await nearnessOf(log, { store, load: scripted().load });
    expect(said[0]).toStartWith("nearness: 5 tasks, 2 at 0.98 or above to an earlier one");
    expect(said[1]).toBe("session e-1: 3 tasks, median nearest earlier 1.00, 2 at 0.98 or above");
    expect(said[2]).toStartWith("session e-2: 2 tasks, median nearest earlier ");
    expect(said[2]).toEndWith(", 0 at 0.98 or above");
  });

  it("counts a comparison's groups, and which of them holds its wins", async () => {
    const { log, store } = logOf([
      task("v1", "e-1", "group-1 a"),
      task("v2", "e-1", "group-1 b"),
      task("v3", "e-1", "group-1 c"),
      task("v4", "e-1", "its own"),
      ...reported("g-1", "step", { v1: "FF PP", v2: "FF PP", v3: "PP PP", v4: "FF PP" }),
    ]);
    const said = await nearnessOf(log, { store, load: scripted().load });
    expect(said.at(-1)).toBe("g-1 step: 4 scored tasks in 2 groups at 0.98, the largest 3, with 2 of 3 wins");
  });

  it("reads tasks that differ apart, where the wins fall outside the largest group", async () => {
    const { log, store } = logOf([
      task("v1", "e-1", "group-1 a"),
      task("v2", "e-1", "group-1 b"),
      task("v3", "e-1", "group-2 c"),
      ...reported("g-1", "no-step", { v1: "PP PP", v2: "PP FF", v3: "FF PP" }),
    ]);
    const said = await nearnessOf(log, { store, load: scripted().load });
    expect(said.at(-1)).toBe(
      "g-1 no-step: 3 scored tasks in 2 groups at 0.98, the largest 2, with 0 of 1 wins",
    );
  });

  it("prints no task, and says one line where the log holds none", async () => {
    const { log, store } = logOf([task("v1", "e-1", `words ${CANARY}`), task("v2", "e-1", `more ${CANARY}`)]);
    const said = await nearnessOf(log, { store, load: scripted().load });
    expect(said.join("\n")).not.toContain(CANARY);
    expect(said.join("\n")).not.toContain("words");
    const pack = logOf([line("task.proposed", { version: "v1", taskId: "v1" })]);
    expect(await nearnessOf(pack.log, { store: pack.store, load: noModel })).toEqual([
      "nearness: no task's public input is on record in this log",
    ]);
  });

  it("keeps what a cut finished, loads no model once it holds all, and embeds only an append's words", async () => {
    const tasks = Array.from({ length: 40 }, (_, at) => task(`v${String(at)}`, "e-1", `words ${String(at)}`));
    const { log, store } = logOf(tasks);
    const cut = scripted(1);
    const stopped = await nearnessOf(log, { store, load: cut.load });
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toContain("16 of 40 texts embedded: cut");
    const rest = scripted();
    await nearnessOf(log, { store, load: rest.load });
    expect(rest.asked).toHaveLength(24);
    expect((await nearnessOf(log, { store, load: noModel }))[0]).toContain("embedded 0 this read");
    appendFileSync(log, task("v99", "e-1", "one new task"));
    const append = scripted();
    await nearnessOf(log, { store, load: append.load });
    expect(append.asked).toEqual(["one new task"]);
  });
});

describe("as readers of a pass", () => {
  it("makes a group ruled two ways news at a look, and a group that only grew a moved count", async () => {
    const lines = ["1", "2", "3"].flatMap((at) => [
      refused(`s-${at}`, ["ph"]),
      ruled(`s-${at}`, `t-${at}`, "earned", `group-1 wording ${at}`),
    ]);
    const { log, store } = logOf(lines);
    const ways = { store, load: scripted().load };
    const seen = newsIn(await restatedOf(log, ways), undefined, { milestone: false });
    appendFileSync(log, refused("s-4", ["ph"]) + ruled("s-4", "t-4", "earned", "group-1 wording 4"));
    const grown = newsIn(await restatedOf(log, ways), seen, { milestone: false });
    expect(grown.fresh).toEqual([]);
    expect(grown.moved.some((row) => row.startsWith("restated: 4 rulings on 4 tasks"))).toBe(true);
    appendFileSync(log, refused("s-5", ["ph"]) + ruled("s-5", "t-5", "unclear", "group-1 wording 5"));
    const split = newsIn(await restatedOf(log, ways), grown, { milestone: false });
    expect(split.fresh).toEqual(["ruled two ways: 5 rulings on 5 tasks, earned 4, unclear 1; check ph"]);
  });

  it("makes a new comparison news at a look, in a row short enough for one", async () => {
    const task = (version: string, publicInput: string) =>
      line("task.proposed", {
        version,
        taskId: version,
        session: "e-1",
        task: { taskId: version, family: "f", publicInput, hidden: null },
      }) + line("task.gate", { version, gate: 1, outcome: "passed" });
    const compared = (session: string) => {
      const { events, terms } = roundSolves(session, ["h1", "h2"], { v1: "FF PP" });
      return events
        .map(({ kind, data }) => line(kind, data))
        .concat(
          line("comparison.reported", {
            session,
            old: "h1",
            fresh: "h2",
            starter: "h1",
            reading: "no-step",
            scored: { wins: 0, losses: 0, ties: 0 },
            ...terms,
          }),
        );
    };
    const { log, store } = logOf([task("v1", "its own"), ...compared("g-1")]);
    const ways = { store, load: scripted().load };
    const seen = newsIn(await nearnessOf(log, ways), undefined, { milestone: false });
    appendFileSync(log, compared("g-2").join(""));
    const said = await nearnessOf(log, ways);
    expect(newsIn(said, seen, { milestone: false }).fresh).toEqual([
      "g-2 no-step: 1 scored tasks in 1 groups at 0.98, the largest 1, with 1 of 1 wins",
    ]);
    for (const row of said) expect(row.length).toBeLessThanOrEqual(160);
  });

  it("resume after a cut, so a pass comes round to them again", () => {
    for (const name of ["restated", "nearness"]) {
      expect(READERS.find((reader) => reader.name === name)?.embeds).toBe(true);
    }
  });

  it("are left out by --no-embed, and no other reader is", () => {
    const named = (noEmbed: boolean) => readersOf(noEmbed).map(({ name }) => name);
    expect(named(false)).toEqual(READERS.map(({ name }) => name));
    expect(READERS.map(({ name }) => name).filter((name) => !named(true).includes(name))).toEqual([
      "restated",
      "nearness",
    ]);
  });
});
