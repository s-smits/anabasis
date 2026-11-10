// The vector store under the embedding readers: what a cut leaves, what a read says when it cannot go
// on, that it keeps no prose, and that neither the vectors nor their dependency can reach a seat. The
// embedder is always injected: no test here loads a model or needs the network.
import { afterAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { breaches } from "#skills/repository-practice/scripts/direction.ts";
import { gitText } from "#src/meta/git.ts";
import {
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
import type { Reader } from "../tools/wri/derive.ts";
import { passOver } from "../tools/wri/pass.ts";
import { type Embed, vectorLines } from "../tools/wri/embed.ts";
import { fakeEmbed } from "./helpers/fake-embed.ts";

const REPO = join(import.meta.dir, "..");
const CANARY = "hidden-value-71839";
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

function scratch(): string {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-vectors-")));
  folders.push(folder);
  return folder;
}

const event = (kind: string, data: Readonly<Record<string, JsonValue>>) =>
  `${JSON.stringify({ at: new Date(0).toISOString(), kind, data })}\n`;

const wordsOf = (count: number) =>
  Array.from({ length: count }, (_, turn) => `words of turn ${String(turn)} ${CANARY}`);

/** A log of one Builder session with these words, one turn each. */
function logOf(words: readonly string[]): string {
  const folder = join(scratch(), ".ana", "d2", "the-run");
  mkdirSync(folder, { recursive: true });
  const log = join(folder, "log.jsonl");
  writeFileSync(log, words.map((text, turn) => event("build.turn", { session: "b-1", turn, text })).join(""));
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
  it("embeds only what an earlier read did not, and gives the vectors an uncut read gives", async () => {
    const words = wordsOf(60);
    const log = logOf(words);
    const store = join(scratch(), "store");
    const first = counted(2);
    const stopped = await vectorLines("r", log, words, { store, load: first.load });
    expect(stopped.stopped).toContain("no reading");
    expect(first.asked).toHaveLength(32);
    const second = counted();
    const finished = await vectorLines("r", log, words, { store, load: second.load });
    expect(finished.stopped).toBeNull();
    expect(first.asked.filter((text) => second.asked.includes(text))).toEqual([]);
    const whole = counted();
    const uncut = await vectorLines("r", log, words, { store: join(scratch(), "store"), load: whole.load });
    expect(second.asked.length + first.asked.length).toBe(whole.asked.length);
    expect(words.map(finished.vectorOf)).toEqual(words.map(uncut.vectorOf));
  });

  it("loads no model on a read with nothing new, and embeds only what an append added after one", async () => {
    const words = wordsOf(20);
    const log = logOf(words);
    const store = join(scratch(), "store");
    await vectorLines("r", log, words, { store, load: counted().load });
    const load = async () => {
      throw new Error("no model should load");
    };
    expect((await vectorLines("r", log, words, { store, load })).embedded).toBe(0);
    const append = counted();
    await vectorLines("r", log, [...words, "one new sentence"], { store, load: append.load });
    expect(append.asked).toEqual(["one new sentence"]);
  });

  it("embeds again the line a kill tore, and keeps every line after it whole", async () => {
    const words = wordsOf(20);
    const log = logOf(words);
    const store = join(scratch(), "store");
    await vectorLines("r", log, words, { store, load: counted().load });
    const file = vectorsIn(store, log);
    const all = readFileSync(file, "utf8");
    writeFileSync(file, all.slice(0, all.lastIndexOf("\n") - 40));
    const again = counted();
    await vectorLines("r", log, words, { store, load: again.load });
    expect(again.asked).toHaveLength(1);
    const later = counted();
    await vectorLines("r", log, words, { store, load: later.load });
    expect(later.asked).toEqual([]);
  });

  it("finishes across two passes when the first is killed part-way, the second embedding only the rest", async () => {
    const root = scratch();
    const log = logOf(wordsOf(60));
    const store = join(root, "store");
    const count = join(root, "count");
    const slow: Reader = {
      name: "slow",
      answers: "",
      embeds: true,
      at: ["build.turn"],
      args: (at) => [
        "test/helpers/vectors-slow.ts",
        at,
        "--store",
        join(root, "vectors"),
        "--count",
        count,
        "--hang-after",
        "2",
      ],
    };
    // Long enough for a loaded host to reach the hang: the helper hangs, so the whole budget is spent.
    const budgetMs = 8000;
    await passOver(store, [log], { budgetMs, roomNow: () => true, readers: [slow] });
    const cut = resultOf(store, log, "slow");
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
    await passOver(store, [log], { budgetMs: 60_000, roomNow: () => true, readers: [slow] });
    expect(resultOf(store, log, "slow")).toMatchObject({ ok: true, size: Bun.file(log).size });
    const all = readFileSync(count, "utf8").trim().split("\n").map(Number);
    const later = all.slice(firstPass.length).reduce((sum, n) => sum + n, 0);
    expect(later).toBe(60 - 32);
  }, 90_000);
});

describe("when it cannot go on", () => {
  it("says so in one line where no model can be had, and leaves the store as it was", async () => {
    const store = join(scratch(), "store");
    const words = wordsOf(3);
    const { stopped } = await vectorLines("r", logOf(words), words, {
      store,
      load: async () => {
        throw new Error("fetch failed\nand a second line");
      },
    });
    expect(stopped).toMatch(/^r: no reading, .* 0 of \d+ texts embedded: fetch failed$/);
    expect(existsSync(store)).toBe(false);
  });

  it("gives every vector where the store cannot be written, and says so in one line", async () => {
    const blocker = join(scratch(), "a-file");
    writeFileSync(blocker, "");
    const words = wordsOf(20);
    const said = await vectorLines("r", logOf(words), words, {
      store: join(blocker, "store"),
      load: counted().load,
    });
    expect(said.stopped).toBeNull();
    expect(said.unkept).toHaveLength(1);
    expect(said.unkept[0]).toContain("cannot be written");
    expect(said.vectorOf(words[0] ?? "").length).toBeGreaterThan(0);
  });
});

describe("what it keeps", () => {
  it("keeps no prose in its store", async () => {
    const words = wordsOf(30);
    const log = logOf(words);
    const store = join(scratch(), "store");
    await vectorLines("r", log, words, { store, load: counted().load });
    expect(readFileSync(vectorsIn(store, log), "utf8")).not.toContain(CANARY);
  });
});

describe("that no seat reads it", () => {
  it("is imported by nothing in production, and neither is its dependency", () => {
    const tracked = lines(gitText(REPO, "ls-files", "src", "vendor", "packages", "tools"));
    expect(breaches(tracked, (file) => importsOf(REPO, file))).toEqual([]);
    // The nearest hostile case: an import of this reader from a seat's file would be named.
    expect(breaches(["src/builder/session.ts"], () => ["tools/wri/embed.ts"])).toHaveLength(1);
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
    const words = [`words ${CANARY}`];
    writeFileSync(log, event("build.turn", { session: "b-1", turn: 1, text: words[0] ?? "" }));
    const store = join(mainTree, ".ana", "pulse", "readers");
    await vectorLines("r", log, words, { store, load: counted().load });
    const file = vectorsIn(store, log);
    expect(existsSync(file)).toBe(true);
    const readable = async (env: ExecutionEnv, path: string) => {
      const shell = await env.exec(["cat", path], {}, context);
      const opened = await env.readTextFile(path, context);
      return (shell.ok && shell.value.exitCode === 0) || opened.ok;
    };
    const dirs = solveDirs(`vectors-wall-${crypto.randomUUID()}`);
    const release = claimRoot(dirs.root);
    let env: ExecutionEnv | undefined;
    try {
      const base = await walledBase(
        dirs,
        { repoRoot, otherTrees: [mainTree] },
        "the vector store's wall test",
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
