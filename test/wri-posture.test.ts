// The posture reader: what a cut leaves, what it says when it cannot read, that it prints no prose,
// and that neither its vectors nor its labels can reach a seat. The embedder is always injected: no
// test here loads a model or needs the network.
import { afterAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { breaches } from "#skills/repository-practice/scripts/direction.ts";
import { gitText } from "#src/meta/git.ts";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { type CommandWall, solveDirs, walledBase } from "../src/tools/command.ts";
import { walledEnv } from "../src/tools/env.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";
import { claimRoot } from "../src/wall/seat-root.ts";
import { folderOf, resultOf } from "../tools/runs/pulse-readers.ts";
import { importsOf, lines } from "../tools/runtime/gate.ts";
import { READERS, type Reader } from "../tools/wri/derive.ts";
import { passOver, queueOf, runQueue } from "../tools/wri/pass.ts";
import type { Embed } from "../tools/wri/embed.ts";
import { postureOf } from "../tools/wri/posture.ts";
import { fakeEmbed } from "./helpers/posture-embed.ts";

const REPO = join(import.meta.dir, "..");
const CANARY = "hidden-value-71839";
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

function scratch(): string {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-posture-")));
  folders.push(folder);
  return folder;
}

const event = (kind: string, data: Readonly<Record<string, JsonValue>>) =>
  `${JSON.stringify({ at: new Date(0).toISOString(), kind, data })}\n`;

/** A log of one Builder session of `units` turns with words, one that ended, and a solve. */
function logOf(units: number, tail = ""): string {
  const folder = join(scratch(), ".ana", "d2", "the-run");
  mkdirSync(folder, { recursive: true });
  const turns = Array.from({ length: units }, (_, turn) =>
    event("build.turn", { session: "b-1", turn, text: `words of turn ${String(turn)} ${CANARY}` }),
  ).join("");
  const log = join(folder, "log.jsonl");
  writeFileSync(
    log,
    [
      event("build.started", { session: "b-1", parent: "" }),
      turns,
      event("build.finished", { session: "b-1", ended: "finished" }),
      event("solve.started", { solve: "s-1", condition: "" }),
      event("solve.turn", { solve: "s-1", turn: 1, text: `a solver's words ${CANARY}` }),
      event("solve.turn", { solve: "s-1", turn: 2, text: "" }),
      event("solve.turn", {
        solve: "s-1",
        turn: 3,
        text: `the provider's words ${CANARY}`,
        error: "overloaded",
      }),
      event("solve.finished", { solve: "s-1", ending: { outcome: "fail", kind: "rejected" } }),
      tail,
    ].join(""),
  );
  return log;
}

/** An embedder that counts what it is asked, and stops part-way as a kill does. */
function counted(stopAfter = Number.POSITIVE_INFINITY) {
  const asked: string[] = [];
  let batches = 0;
  const embed: Embed = async (texts) => {
    if (batches >= stopAfter) throw new Error("cut");
    batches += 1;
    asked.push(...texts);
    return fakeEmbed(texts);
  };
  return { asked, load: async () => embed };
}

const vectorsIn = (store: string, log: string) => {
  const folder = folderOf(store, log);
  const file = readdirSync(folder).find((name) => name.startsWith("vectors-"));
  return join(folder, file ?? "");
};

describe("what a cut leaves", () => {
  it("embeds only what an earlier read did not, and reads as an uncut read does", async () => {
    const log = logOf(60);
    const store = join(scratch(), "store");
    const first = counted(2);
    const stopped = await postureOf(log, { store, load: first.load });
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toContain("no reading");
    expect(first.asked).toHaveLength(32);
    const second = counted();
    const finished = await postureOf(log, { store, load: second.load });
    expect(first.asked.filter((words) => second.asked.includes(words))).toEqual([]);
    const whole = counted();
    const uncut = await postureOf(log, { store: join(scratch(), "store"), load: whole.load });
    expect(second.asked.length + first.asked.length).toBe(whole.asked.length);
    // Past the head line, which counts what this read embedded.
    expect(finished.slice(1)).toEqual(uncut.slice(1));
  });

  it("loads no model on a read with nothing new, and embeds only an append's words after one", async () => {
    const log = logOf(20);
    const store = join(scratch(), "store");
    await postureOf(log, { store, load: counted().load });
    const load = async () => {
      throw new Error("no model should load");
    };
    expect((await postureOf(log, { store, load }))[0]).toContain("embedded 0 this read");
    appendFileSync(log, event("build.turn", { session: "b-1", turn: 99, text: "one new sentence" }));
    const append = counted();
    await postureOf(log, { store, load: append.load });
    expect(append.asked).toEqual(["one new sentence"]);
  });

  it("embeds again the line a kill tore, and keeps every line after it whole", async () => {
    const log = logOf(20);
    const store = join(scratch(), "store");
    await postureOf(log, { store, load: counted().load });
    const file = vectorsIn(store, log);
    const all = readFileSync(file, "utf8");
    writeFileSync(file, all.slice(0, all.lastIndexOf("\n") - 40));
    const again = counted();
    await postureOf(log, { store, load: again.load });
    expect(again.asked).toHaveLength(1);
    const later = counted();
    await postureOf(log, { store, load: later.load });
    expect(later.asked).toEqual([]);
  });

  it("finishes across two passes when the first is killed part-way, the second embedding only the rest", async () => {
    const root = scratch();
    const log = logOf(60);
    const store = join(root, "store");
    const count = join(root, "count");
    const reader = (name: string, embeds: boolean): Reader => ({
      name,
      embeds,
      args: (at) => [
        "test/helpers/posture-slow.ts",
        at,
        "--store",
        join(root, "vectors"),
        "--count",
        count,
        "--hang-after",
        "2",
      ],
    });
    const posture = reader("posture", true);
    // Long enough for a loaded host to reach the hang: the helper hangs, so the whole budget is spent.
    const budgetMs = 8000;
    await passOver(store, [log], { budgetMs, roomNow: () => true, readers: [posture] });
    const cut = resultOf(store, log, "posture");
    expect(cut).toMatchObject({ size: -1, ok: false });
    expect(cut?.ms).toBeGreaterThanOrEqual(budgetMs - 100);
    const firstPass = readFileSync(count, "utf8").trim().split("\n").map(Number);
    expect(firstPass).toEqual([16, 16]);
    expect(
      readFileSync(vectorsIn(join(root, "vectors"), log), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean),
    ).toHaveLength(32);
    // What the cut recorded is about the whole budget. A reader that resumes takes its turn anyway...
    const [due] = queueOf(store, [log], [posture]);
    expect(due?.ms).toBeGreaterThanOrEqual(budgetMs - 100);
    const room = { budgetMs, room: () => true, now: () => 100 };
    const taken: string[] = [];
    await runQueue(due === undefined ? [] : [due], {
      ...room,
      read: async ({ reader: { name } }) => {
        taken.push(name);
      },
    });
    expect(taken).toEqual(["posture"]);
    // ...where one that does not would wait for a budget it can never have.
    const refused: string[] = [];
    await runQueue(due === undefined ? [] : [{ ...due, reader: reader("plain", false) }], {
      ...room,
      read: async ({ reader: { name } }) => {
        refused.push(name);
      },
    });
    expect(refused).toEqual([]);
    await passOver(store, [log], { budgetMs: 60_000, roomNow: () => true, readers: [posture] });
    expect(resultOf(store, log, "posture")).toMatchObject({ ok: true, size: Bun.file(log).size });
    const all = readFileSync(count, "utf8").trim().split("\n").map(Number);
    const whole = counted();
    await postureOf(log, { store: join(root, "whole"), load: whole.load });
    const later = all.slice(firstPass.length).reduce((sum, n) => sum + n, 0);
    expect(later).toBe(whole.asked.length - 32);
  }, 90_000);
});

describe("when it cannot read", () => {
  it("says so in one line where a log holds no prose, and loads nothing", async () => {
    const log = logOf(0);
    const silent = join(dirname(log), "silent.jsonl");
    writeFileSync(silent, event("solve.turn", { solve: "s-1", turn: 1, text: "  " }));
    const said = await postureOf(silent, {
      store: join(scratch(), "store"),
      load: async () => {
        throw new Error("no model should load");
      },
    });
    expect(said).toEqual(["posture: no prose in this log, 0 of 1 turns hold words"]);
  });

  it("says so in one line where no model can be had, and leaves the store as it was", async () => {
    const store = join(scratch(), "store");
    const said = await postureOf(logOf(3), {
      store,
      load: async () => {
        throw new Error("fetch failed\nand a second line");
      },
    });
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^posture: no reading, .* 0 of \d+ texts embedded: fetch failed$/);
    expect(existsSync(store)).toBe(false);
  });

  it("finishes its reading where the store cannot be written, and says so in one line", async () => {
    const blocker = join(scratch(), "a-file");
    writeFileSync(blocker, "");
    const said = await postureOf(logOf(20), { store: join(blocker, "store"), load: counted().load });
    expect(said.filter((line) => line.includes("cannot be written"))).toHaveLength(1);
    expect(said.some((line) => line.startsWith("build b-1 finished: 20 units"))).toBe(true);
  });

  it("exits 0 as a reader on a log with no prose, through the list a pass runs", async () => {
    const posture = READERS.find(({ name }) => name === "posture");
    expect(posture?.embeds).toBe(true);
    const log = join(scratch(), "log.jsonl");
    writeFileSync(log, event("build.started", { session: "b-1", parent: "" }));
    const child = Bun.spawnSync([process.execPath, ...(posture?.args(log, REPO) ?? [])], { cwd: REPO });
    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString().trim()).toBe("posture: no prose in this log, 0 of 0 turns hold words");
  });
});

describe("what it prints", () => {
  it("counts by seat, session and ending, joins what the log decided, and leaves a provider's words out", async () => {
    const log = logOf(30);
    const said = await postureOf(log, { store: join(scratch(), "store"), load: counted().load });
    expect(said[0]).toStartWith("posture: 31 units of prose in 33 turns");
    expect(said.some((line) => line.startsWith("seat build: 30 units of 30 turns"))).toBe(true);
    expect(said.some((line) => line.startsWith("seat solve: 1 units of 3 turns"))).toBe(true);
    expect(said.some((line) => line.startsWith("build b-1 finished: 30 units"))).toBe(true);
    expect(said.some((line) => line.startsWith("solve fail rejected: 1 units in 1 of 1 solves"))).toBe(true);
  });

  it("prints no prose, and keeps none in its store", async () => {
    const log = logOf(30);
    const store = join(scratch(), "store");
    const said = await postureOf(log, { store, load: counted().load });
    expect(said.join("\n")).not.toContain(CANARY);
    expect(said.join("\n")).not.toContain("words of turn");
    expect(readFileSync(vectorsIn(store, log), "utf8")).not.toContain(CANARY);
  });

  it("names a session that stays adrift, and no session whose run a confident unit breaks", async () => {
    // The anchors of one posture are its own nearest, so their text in a row is that posture in a row.
    const source = readFileSync(join(REPO, "tools", "wri", "posture.ts"), "utf8");
    const unsure = [
      ...source.slice(source.indexOf("  unsure: ["), source.indexOf("  sure: [")).matchAll(/^\s+"(.+)",$/gm),
    ];
    const sure = [
      ...source.slice(source.indexOf("  sure: ["), source.indexOf("  submit: [")).matchAll(/^\s+"(.+)",$/gm),
    ];
    const words = unsure.map(([, line]) => line ?? "").slice(0, 5);
    const turnsOf = (texts: readonly string[]) =>
      texts.map((text, turn) => event("build.turn", { session: "b-2", turn, text })).join("");
    const opening = event("build.started", { session: "b-2", parent: "" });
    const read = async (log: string) => {
      const folder = join(scratch(), "run");
      mkdirSync(folder, { recursive: true });
      const file = join(folder, "log.jsonl");
      writeFileSync(file, log);
      return postureOf(file, { store: join(scratch(), "store"), load: counted().load });
    };
    const adrift = await read(opening + turnsOf(words));
    expect(adrift.filter((line) => line.startsWith("adrift build b-2:"))).toHaveLength(1);
    expect(adrift.find((line) => line.startsWith("adrift"))).toContain(
      "the longest 5 units, turns 0 to 4, in unsure",
    );
    const broken = [...words.slice(0, 2), sure[0]?.[1] ?? "", ...words.slice(2)];
    expect((await read(opening + turnsOf(broken))).filter((line) => line.startsWith("adrift"))).toEqual([]);
  });
});

describe("that no seat reads it", () => {
  it("is imported by nothing in production, and neither is its dependency", () => {
    const tracked = lines(gitText(REPO, "ls-files", "src", "vendor", "packages", "tools"));
    expect(breaches(tracked, (file) => importsOf(REPO, file))).toEqual([]);
    // The nearest hostile case: an import of this reader from a seat's file would be named.
    expect(breaches(["src/builder/session.ts"], () => ["tools/wri/posture.ts"])).toHaveLength(1);
    const naming = tracked.filter(
      (file) =>
        /\.[cm]?tsx?$/.test(file) &&
        !file.startsWith("tools/wri/") &&
        readFileSync(join(REPO, file), "utf8").includes("@huggingface/transformers"),
    );
    expect(naming).toEqual([]);
  });
});

describe.skipIf(!osIsolationSupport().ok)("its vectors, through a seat's wall", () => {
  it("closes the store in the main tree to a seat in another worktree, while a seat's own file stays open", async () => {
    const context = BACKGROUND_CONTEXT;
    // The store lies in the main tree (`storeOf`), and a paid seat never runs there (`treeFault`).
    const mainTree = scratch();
    const repoRoot = scratch();
    const log = join(mainTree, ".ana", "d2", "the-run", "log.jsonl");
    mkdirSync(dirname(log), { recursive: true });
    writeFileSync(log, event("build.turn", { session: "b-1", turn: 1, text: `words ${CANARY}` }));
    const store = join(mainTree, ".ana", "pulse", "readers");
    await postureOf(log, { store, load: counted().load });
    const file = vectorsIn(store, log);
    expect(existsSync(file)).toBe(true);
    const readable = async (env: ExecutionEnv, path: string) => {
      const shell = await env.exec(["cat", path], {}, context);
      const opened = await env.readTextFile(path, context);
      return (shell.ok && shell.value.exitCode === 0) || opened.ok;
    };
    const dirs = solveDirs(`posture-wall-${crypto.randomUUID()}`);
    const release = claimRoot(dirs.root);
    let env: ExecutionEnv | undefined;
    try {
      const base = await walledBase(
        dirs,
        { repoRoot, otherTrees: [mainTree] },
        "the posture store's wall test",
      );
      const wall: CommandWall = {
        base,
        dirs,
        toolTree: null,
        limits: { shellDefaultSeconds: 1, shellMaxSeconds: 2 },
      };
      env = walledEnv(wall);
      expect(await readable(env, file)).toBe(false);
      const open = join(wall.dirs.home, "own.txt");
      writeFileSync(open, "a seat's own");
      expect(await readable(env, open)).toBe(true);
    } finally {
      await env?.cleanup(context);
      await release();
      rmSync(dirs.host, { recursive: true, force: true });
    }
  });
});
