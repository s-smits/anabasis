// A look's readers, by moment: what a reader says of the event it answers and when, what a look says
// it has not read, what a pass runs and costs a host, what a kill leaves, and that no seat can read
// what they wrote.
import { afterAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { hostname, tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn } from "../src/meta/process.ts";
import { type CommandWall, solveDirs, walledBase } from "../src/tools/command.ts";
import { walledEnv } from "../src/tools/env.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";
import { claimRoot } from "../src/wall/seat-root.ts";
import {
  endPass,
  keepReaders,
  keepResult,
  type Moment,
  pruneObservers,
  readersSaid,
  resultOf,
  room,
  startPass,
  underLock,
  withinDeadline,
} from "../tools/runs/pulse-readers.ts";
import { READERS, type Reader } from "../tools/wri/derive.ts";
import { type Due, dueOf, passOver, runQueue } from "../tools/wri/pass.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

interface Listed {
  readonly name: string;
  readonly at?: readonly EventKind[];
  readonly gist?: RegExp;
}

const CLI = "tools/runs/cli.ts";
const REPORTED = "comparison.reported";
const PROMOTED = "harness.promoted";
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

function scratch(): string {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-pulse-readers-")));
  folders.push(folder);
  return folder;
}

const result = (size: number, ok = true) => ({ size, at: Date.now(), ms: 5, ok });
const eventOf = (kind: EventKind, data: JsonObject = {}): LogEvent => ({
  at: new Date().toISOString(),
  kind,
  data,
});
const lineOf = (kind: EventKind, data: JsonObject = {}) => `${JSON.stringify(eventOf(kind, data))}\n`;
const DIGEST = "0123abcd".padEnd(64, "e");

/** A store whose last pass named `listed`, a log of 100 bytes, and a look at it as one observer. */
function world(listed: readonly Listed[]) {
  const root = scratch();
  const store = join(root, "store");
  mkdirSync(store, { recursive: true });
  keepReaders(store, listed);
  const log = join(root, "log.jsonl");
  writeFileSync(log, "x".repeat(100));
  const files = join(root, "observer.json.d", "the-run");
  const look = (over: Partial<Parameters<typeof readersSaid>[0]> = {}) =>
    readersSaid({
      store,
      log,
      size: 100,
      fresh: [],
      owed: undefined,
      said: undefined,
      files,
      spare: 30,
      watched: new Set(),
      ...over,
    });
  return { root, store, log, files, look };
}

/** Every line a look says of the readers, under its events and after them. */
const allOf = (said: ReturnType<typeof readersSaid>) => [
  ...said.placed.flatMap(({ lines }) => lines),
  ...said.lines,
];

describe("what a reader says of a moment", () => {
  it("says under the event the lines that name its session, at most three a reader, with the full text beside", () => {
    const { store, log, files, look } = world([{ name: "readings", at: [REPORTED] }]);
    const named = Array.from({ length: 5 }, (_, at) => `g-2 row ${String(at)}`);
    keepResult(store, log, "readings", result(100), [...named, "g-1 earlier", "g-21 later", ""].join("\n"));
    const said = look({
      fresh: [eventOf("build.started", { session: "b-1" }), eventOf(REPORTED, { session: "g-2" })],
    });
    expect(said.placed).toEqual([
      { at: 1, lines: ["◆ readings: g-2 row 0", "◆ readings: g-2 row 1", "◆ readings: g-2 row 2"] },
    ]);
    expect(said.lines[0]).toBe("◆ 2 more lines, of readings");
    expect(said.lines.at(-1)).toContain(files);
    expect(readFileSync(join(files, "readings.txt"), "utf8")).toContain("g-2 row 4");
    expect(said.owed).toEqual([]);
  });

  it("names a promotion by its harness's first eight characters", () => {
    const { store, log, look } = world([{ name: "replay", at: [PROMOTED] }]);
    keepResult(store, log, "replay", result(100), "promoted 0123abcd on g-3\nanother 89abcdef\n");
    const said = look({ fresh: [eventOf(PROMOTED, { harness: DIGEST })] });
    expect(allOf(said)).toContain("◆ replay: promoted 0123abcd on g-3");
    expect(allOf(said).join("\n")).not.toContain("89abcdef");
  });

  it("takes the lines its gist picks only where the text names neither the session nor the harness", () => {
    const { store, log, look } = world([{ name: "cost", at: [REPORTED], gist: /^row\t/ }]);
    keepResult(store, log, "cost", result(100), "head\tcols\nrow\t1\t2\n");
    expect(allOf(look({ fresh: [eventOf(REPORTED, { session: "g-2" })] }))).toContain("◆ cost: row 1 2");
    keepResult(store, log, "cost", result(100), "head\tcols\nrow\t1\t2\ng-2 of its own\n");
    const named = allOf(look({ fresh: [eventOf(REPORTED, { session: "g-2" })] }));
    expect(named).toContain("◆ cost: g-2 of its own");
    expect(named.join("\n")).not.toContain("row 1 2");
  });

  it("says each line once to an observer, whatever moment asks for it again, and once to each observer", () => {
    const { store, log, look } = world([{ name: "rows", at: [REPORTED, PROMOTED] }]);
    keepResult(store, log, "rows", result(100), "g-2 at 0123abcd\n");
    const fresh = [eventOf(REPORTED, { session: "g-2" }), eventOf(PROMOTED, { harness: DIGEST })];
    const [one, other] = [look({ fresh }), look({ fresh })];
    for (const seen of [one, other]) {
      expect(allOf(seen).filter((line) => line.startsWith("◆ rows:"))).toEqual(["◆ rows: g-2 at 0123abcd"]);
    }
    keepResult(store, log, "rows", result(200), "g-2 at 0123abcd\n");
    const again = look({ size: 200, fresh: [eventOf(REPORTED, { session: "g-2" })], said: one.said });
    expect(allOf(again)).toEqual([]);
  });

  it("says nothing and names no reader where the new events hold no moment", () => {
    const { store, log, look } = world([{ name: "rows", at: [REPORTED] }]);
    keepResult(store, log, "rows", result(10), "g-2 line\n");
    const said = look({ fresh: [eventOf("solve.finished", { session: "g-2" }), eventOf("build.started")] });
    expect(allOf(said)).toEqual([]);
    expect(said.owed).toEqual([]);
  });

  it("bounds a run and a look, and leaves out a trigger the look says itself", () => {
    const names = ["a", "b", "c", "d", "e", "f"];
    const { store, log, look } = world(names.map((name) => ({ name, at: [REPORTED] })));
    const lines = Array.from({ length: 4 }, (_, at) => `g-2 new ${String(at)}`).join("\n");
    for (const name of names) keepResult(store, log, name, result(100), `${lines}\n`);
    const fresh = [eventOf(REPORTED, { session: "g-2" })];
    const full = allOf(look({ fresh }));
    expect(full.filter((line) => /^◆ [a-f]: g-2/.test(line))).toHaveLength(12);
    expect(full.some((line) => /^◆ \d+ more lines, of .*f$/.test(line))).toBe(true);
    const spent = allOf(look({ fresh, spare: 2 }));
    expect(spent.filter((line) => /^◆ [a-f]: /.test(line))).toHaveLength(2);
    const rows = world([{ name: "rows", at: [REPORTED] }]);
    keepResult(rows.store, rows.log, "rows", result(100), "SUPPLY THIN (lane 1): g-2 short\ng-2 own row\n");
    const kept = allOf(rows.look({ fresh, watched: new Set(["SUPPLY THIN"]) }));
    expect(kept.filter((line) => line.startsWith("◆ rows:"))).toEqual(["◆ rows: g-2 own row"]);
  });

  it("says a row whole where it fits 200 characters with its columns one space apart, and cuts a longer one there", () => {
    const { store, log, look } = world([{ name: "rejections", at: [REPORTED] }]);
    // A rejection's row under a campaign name of 53 characters: 167 once its columns close up, and
    // its last column says whether the task is set aside.
    const row = ["s".repeat(67), "x-2-016", "g-2", "c".repeat(83), "yes"].join("\t  ");
    keepResult(store, log, "rejections", result(100), `${row}\n${"g-2 ".repeat(60)}\n`);
    const said = allOf(look({ fresh: [eventOf(REPORTED, { session: "g-2" })] }));
    expect(said).toContain(`◆ rejections: ${"s".repeat(67)} x-2-016 g-2 ${"c".repeat(83)} yes`);
    expect(said).toContain(`◆ rejections: ${"g-2 ".repeat(50)}`);
  });

  it("says a failed reader once a failure, with its last line", () => {
    const { store, log, look } = world([{ name: "gap", at: [REPORTED] }]);
    const failing = (why: string) => `\n-- gap ended with exit 1\n-- stderr\n${why}\n`;
    keepResult(store, log, "gap", result(100, false), failing("no such file"));
    const fresh = [eventOf(REPORTED, { session: "g-2" })];
    const failed = look({ fresh });
    expect(allOf(failed)).toEqual(["⚠ gap failed: no such file"]);
    keepResult(store, log, "gap", result(200, false), failing("no such file"));
    expect(allOf(look({ size: 200, fresh, said: failed.said }))).toEqual([]);
    keepResult(store, log, "gap", result(300, false), failing("it changed"));
    expect(allOf(look({ size: 300, fresh, said: failed.said }))).toEqual(["⚠ gap failed: it changed"]);
  });
});

describe("a moment its readers have not read never reads as nothing new", () => {
  it("names the readers behind a moment once, keeps it owed, and says their lines at the look that finds them", () => {
    const { store, log, look } = world([
      { name: "rows", at: [REPORTED] },
      { name: "gap", at: [REPORTED] },
    ]);
    keepResult(store, log, "gap", result(100), "g-2 gap row\n");
    keepResult(store, log, "rows", result(60), "g-1 old row\n");
    endPass(store, "finished");
    const first = look({ fresh: [eventOf(REPORTED, { session: "g-2" })] });
    expect(allOf(first)).toContain("◆ gap: g-2 gap row");
    expect(first.lines.at(-1)).toMatch(/^· not read yet: rows of comparison\.reported g-2; /);
    expect(first.owed).toMatchObject([{ kind: REPORTED, session: "g-2", size: 100, left: ["rows"] }]);
    const still = look({ size: 120, owed: first.owed, said: first.said });
    expect(allOf(still)).toEqual([]);
    expect(still.owed).toHaveLength(1);
    keepResult(store, log, "rows", result(120), "g-2 rows row\n");
    const read = look({ size: 120, owed: still.owed, said: still.said });
    expect(allOf(read)).toContain("◆ rows on comparison.reported g-2: g-2 rows row");
    expect(allOf(read).join("\n")).not.toContain("gap row");
    expect(read.owed).toEqual([]);
  });

  it("says why from what the look can see: the limit, the load, the rest between passes", () => {
    const { store, look } = world([{ name: "chain", at: [REPORTED] }]);
    const why = () => look({ fresh: [eventOf(REPORTED)] }).lines.at(-1) ?? "";
    endPass(store, "budget");
    // A loaded test host says the load instead of the limit, and either is the reason.
    expect(why()).toMatch(/limit of 30 s|shed for the load/);
    endPass(store, "load");
    expect(why()).toContain("load");
    endPass(store, "finished");
    expect(why()).toMatch(/passes rest 4 minutes|shed for the load/);
  });

  it("says a pass failed until a later pass ends, and not after", async () => {
    const { store, look } = world([{ name: "chain", at: [REPORTED] }]);
    const why = () => look({ fresh: [eventOf(REPORTED)] }).lines.at(-1) ?? "";
    endPass(store, "finished");
    await Bun.sleep(5);
    writeFileSync(join(store, "pass.err"), "a trace\nthe runtime's last line\n");
    // A failed pass is the one reason for an unread moment that is something to look at.
    expect(why()).toMatch(/^⚠ not read yet: .*the last pass failed: the runtime's last line/);
    await Bun.sleep(5);
    endPass(store, "budget");
    expect(why()).not.toContain("the last pass failed");
    expect(why()).toStartWith("· not read yet: ");
  });

  it("names the readers as a whole where no pass has finished on this host", () => {
    const root = scratch();
    const said = readersSaid({
      store: join(root, "store"),
      log: join(root, "log.jsonl"),
      size: 200,
      fresh: [eventOf(REPORTED, { session: "g-2" })],
      owed: undefined,
      said: undefined,
      files: join(root, "d"),
      spare: 30,
      watched: new Set(),
    });
    // A loaded host starts no pass, and the look names the load first.
    expect(said.lines).toHaveLength(1);
    expect(said.lines[0]).toMatch(
      /^· not read yet: the readers of comparison\.reported g-2; (no pass has finished on this host|shed for the load, )/,
    );
    expect(said.owed).toHaveLength(1);
  });
});

describe("what a pass runs", () => {
  /** A reader that prints its name, at `at`. */
  const printing = (name: string, at?: readonly EventKind[]): Reader => ({
    name,
    answers: "",
    ...keyIfDefined("at", at),
    args: () => ["-e", `console.log(${JSON.stringify(name)})`],
  });

  it("runs a reader on a log only where one of its moments lies past what it last read", async () => {
    const root = scratch();
    const store = join(root, "store");
    const log = join(root, "log.jsonl");
    writeFileSync(log, lineOf("build.started", { session: "b-1" }));
    const readers = [printing("reported", [REPORTED]), printing("promoted", [PROMOTED]), printing("plain")];
    const pass = () => passOver(store, [log], { budgetMs: 20_000, roomNow: () => true, readers });
    const at = (name: string) => resultOf(store, log, name)?.at ?? null;
    await pass();
    expect(readers.map(({ name }) => at(name))).toEqual([null, null, null]);
    appendFileSync(log, lineOf(REPORTED, { session: "g-1" }));
    await pass();
    expect(resultOf(store, log, "reported")).toMatchObject({ ok: true, size: statSync(log).size });
    expect([at("promoted"), at("plain")]).toEqual([null, null]);
    const once = at("reported");
    appendFileSync(log, lineOf("solve.finished"));
    await pass();
    expect(at("reported")).toBe(once);
    appendFileSync(log, lineOf(PROMOTED, { harness: DIGEST }));
    await pass();
    expect(at("reported")).toBe(once);
    expect(resultOf(store, log, "promoted")).toMatchObject({ ok: true, size: statSync(log).size });
    // It names the readers it ran with their moments, for the looks.
    const listed = parseJsonAs<readonly { name: string }[]>(
      readFileSync(join(store, "readers.json"), "utf8"),
    );
    expect(listed.map(({ name }) => name)).toEqual(["reported", "promoted"]);
  }, 60_000);

  it("takes the logs as given, and each log's due readers in the list's order", () => {
    const root = scratch();
    const store = join(root, "store");
    const [one, other] = ["one.jsonl", "other.jsonl"].map((name) => join(root, name));
    writeFileSync(one ?? "", lineOf(PROMOTED, { harness: DIGEST }) + lineOf(REPORTED));
    writeFileSync(other ?? "", lineOf(REPORTED));
    const readers = [
      printing("a", [REPORTED]),
      printing("b", [PROMOTED]),
      printing("c", [REPORTED, PROMOTED]),
    ];
    const queue = dueOf(store, [other ?? "", one ?? ""], readers).map(
      ({ log, reader }) => `${log === one ? "one" : "other"}:${reader.name}`,
    );
    expect(queue).toEqual(["other:a", "other:c", "one:a", "one:b", "one:c"]);
  });
});

describe("what a pass costs a host", () => {
  const due = (name: string, ms = 0): Due => ({
    log: "l",
    reader: { name, answers: "", args: () => [] },
    ms,
  });

  it("stops at the load, before the reader it would have started", async () => {
    const read: string[] = [];
    let readings = 0;
    const ended = await runQueue([due("a"), due("b"), due("c")], {
      budgetMs: 1000,
      room: () => {
        readings += 1;
        return readings <= 1;
      },
      now: () => 0,
      read: async ({ reader: { name } }) => {
        read.push(name);
      },
    });
    expect(ended).toBe("load");
    expect(read).toEqual(["a"]);
  });

  it("leaves a reader that would not fit, and stops at the budget", async () => {
    const read: string[] = [];
    let clock = 0;
    const ended = await runQueue([due("rows"), due("big", 900), due("small", 100), due("late")], {
      budgetMs: 1000,
      room: () => true,
      now: () => clock,
      read: async ({ reader: { name } }) => {
        read.push(name);
        clock += 400;
      },
    });
    expect(read).toEqual(["rows", "small", "late"]);
    expect(ended).toBe("budget");
  });

  it("starts a reader only a core under the line where a solve waits", () => {
    expect(room(6.9, 8)).toBe(true);
    expect(room(7.1, 8)).toBe(false);
  });

  it("runs the real readers over a real log, into results a look can read", async () => {
    const root = scratch();
    const store = join(root, "store");
    const folder = join(root, ".ana", "d2", "the-run");
    mkdirSync(folder, { recursive: true });
    const log = join(folder, "log.jsonl");
    const kinds: readonly EventKind[] = ["campaign.opened", "comparison.started", REPORTED, PROMOTED];
    writeFileSync(log, kinds.map((kind) => lineOf(kind, { session: "g-1", harness: DIGEST })).join(""));
    await passOver(store, [log], { budgetMs: 45_000, roomNow: () => true });
    const named = READERS.filter(({ at }) => at?.some((kind) => kinds.includes(kind)) === true);
    const read = named.flatMap(({ name }) => resultOf(store, log, name) ?? []);
    // A spawn that refused its limit failed every reader in 0 ms, which only a real pass shows.
    expect(resultOf(store, log, "rows")).toMatchObject({ ok: true, size: statSync(log).size });
    expect(read).toHaveLength(named.length);
    expect(read.filter(({ ok }) => ok).length).toBeGreaterThan(named.length / 2);
    expect(read.every(({ ms }) => ms > 0)).toBe(true);
    for (const { name } of READERS.filter(({ at }) => at === undefined)) {
      expect(resultOf(store, log, name)).toBeNull();
    }
    const said = readersSaid({
      store,
      log,
      size: statSync(log).size,
      fresh: kinds.map((kind) => eventOf(kind, { session: "g-1", harness: DIGEST })),
      owed: undefined,
      said: undefined,
      files: join(root, "observer.json.d", "the-run"),
      spare: 30,
      watched: new Set(),
    });
    expect(said.owed).toEqual([]);
    expect(allOf(said).length).toBeGreaterThan(0);
  }, 60_000);

  it("lets one pass hold a host however long it reads, and frees the lock of one that died", async () => {
    const store = join(scratch(), "store");
    const inner = await underLock(store, async () => await underLock(store, async () => "second"));
    expect(inner).toBeNull();
    expect(await underLock(store, async () => "after")).toBe("after");
    const gone = capturedSpawn(["true"]);
    await gone.exited;
    symlinkSync(`${String(gone.pid)} ${hostname()} Thu Jan  1 00:00:00 1970`, join(store, "pass.lock"));
    expect(await underLock(store, async () => "taken")).toBe("taken");
  });

  /** A tree whose `tools/wri/pass.ts` stands in for the real one, recording each start, and a look's
   *  ask of a log whose new events hold a moment no reader has read. */
  function stubTree(body: string) {
    const root = scratch();
    const tree = join(root, "tree");
    mkdirSync(join(tree, "tools", "wri"), { recursive: true });
    const marks = join(root, "marks");
    writeFileSync(
      join(tree, "tools", "wri", "pass.ts"),
      `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(marks)}, "started\\n");
${body}
appendFileSync(${JSON.stringify(marks)}, "ended\\n");`,
    );
    const store = join(root, "store");
    mkdirSync(store, { recursive: true });
    keepReaders(store, [{ name: "rows", at: [REPORTED] }]);
    const log = join(root, "log.jsonl");
    writeFileSync(log, "x".repeat(10));
    const ask = { log, size: 10, fresh: [eventOf(REPORTED)], owed: undefined };
    const started = () => (existsSync(marks) ? readFileSync(marks, "utf8").split("\n").filter(Boolean) : []);
    return { root, tree, store, log, ask, started };
  }

  async function until(test: () => boolean, ms = 10_000): Promise<void> {
    const deadline = performance.now() + ms;
    while (!test() && performance.now() < deadline) await Bun.sleep(25);
    expect(test()).toBe(true);
  }

  it("waits at most its limit for a pass, which outlives the wait and leaves its result for the next look", async () => {
    const { tree, store, ask, started } = stubTree("await Bun.sleep(600);");
    const begun = performance.now();
    await startPass(store, [ask], { tree, waitMs: 50, roomNow: () => true });
    expect(performance.now() - begun).toBeLessThan(500);
    await until(() => started().includes("ended"));
  });

  it("starts no pass and waits for none where the look holds no moment not yet read, nor within the rest", async () => {
    const quiet = stubTree("");
    const other = { ...quiet.ask, fresh: [eventOf("solve.finished"), eventOf("build.started")] };
    await startPass(quiet.store, [other], { tree: quiet.tree, waitMs: 2000, roomNow: () => true });
    keepResult(quiet.store, quiet.log, "rows", result(10), "");
    await startPass(quiet.store, [quiet.ask], { tree: quiet.tree, waitMs: 2000, roomNow: () => true });
    const owedRead: Moment = { kind: REPORTED, size: 10, left: ["rows"] };
    await startPass(quiet.store, [{ ...other, owed: [owedRead] }], {
      tree: quiet.tree,
      waitMs: 2000,
      roomNow: () => true,
    });
    await startPass(quiet.store, [], { tree: quiet.tree, waitMs: 2000, roomNow: () => true });
    expect(quiet.started()).toEqual([]);
    // A held lock is waited for only where a moment is owed.
    const held = stubTree("");
    const waited = await underLock(held.store, async () => {
      const begun = performance.now();
      await startPass(held.store, [{ ...held.ask, fresh: [] }], {
        tree: held.tree,
        waitMs: 2000,
        roomNow: () => true,
      });
      return performance.now() - begun;
    });
    expect(waited).toBeLessThan(500);
    const rest = stubTree("");
    endPass(rest.store, "finished");
    await startPass(rest.store, [rest.ask], { tree: rest.tree, waitMs: 2000, roomNow: () => true });
    expect(rest.started()).toEqual([]);
    const owed = stubTree("");
    await startPass(owed.store, [{ ...owed.ask, fresh: [], owed: [{ kind: REPORTED, size: 10 }] }], {
      tree: owed.tree,
      waitMs: 5000,
      roomNow: () => true,
    });
    await until(() => owed.started().includes("ended"));
  });

  it("keeps a pass going when the hook's limit kills the look's whole group", async () => {
    const { root, tree, store, ask, started } = stubTree("await Bun.sleep(1200);");
    const driver = join(root, "driver.ts");
    writeFileSync(
      driver,
      `import { startPass } from ${JSON.stringify(join(import.meta.dir, "..", "tools", "runs", "pulse-readers.ts"))};
await startPass(${JSON.stringify(store)}, [${JSON.stringify({ ...ask, fresh: ask.fresh })}], { tree: ${JSON.stringify(tree)}, waitMs: 30000, roomNow: () => true });`,
    );
    const look = capturedSpawn([capturedExecPath, driver], {
      detached: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    await until(() => started().includes("started"));
    process.kill(-look.pid, "SIGTERM");
    await look.exited;
    expect(started()).not.toContain("ended");
    await until(() => started().includes("ended"));
  });
});

describe("a look that was cut", () => {
  /** A fixture host with one campaign, a store whose pass has just ended, so no real pass starts. */
  function host(extra: Record<string, string> = { ANA_HOSTS: "[]" }) {
    const made = fakeHosts();
    folders.push(made.root);
    const folder = join(made.main, ".ana", "d2", "the-run");
    mkdirSync(folder, { recursive: true });
    const log = join(folder, "log.jsonl");
    const event = (kind: EventKind, data: JsonObject) => {
      appendFileSync(log, lineOf(kind, data));
    };
    event("campaign.waited", { for: "provider", until: "2099-01-01T00:00:00.000Z", ms: 1 });
    const store = join(made.main, ".ana", "pulse", "moments");
    mkdirSync(store, { recursive: true });
    keepReaders(store, [{ name: "rows", at: [REPORTED] }]);
    endPass(store, "finished");
    const state = join(made.root, "session.pulse.json");
    const look = (...args: string[]) => made.runScript(CLI, ["pulse", ...args], extra);
    return { made, log, event, store, state, look };
  }
  const linesOf = (state: string, log: string) =>
    parseJsonAs<{ logs: Record<string, { lines: number }> }>(readFileSync(state, "utf8")).logs[log]?.lines;

  it("loses no event when the hook's limit kills it before it prints, and the next look says them", async () => {
    const { made, log, event, store, state, look } = host();
    look("--state", state, "the-run");
    expect(linesOf(state, log)).toBe(1);
    event(REPORTED, { reading: "no-step" });
    const before = readFileSync(state, "utf8");
    // A running pass holds the look in its wait, where the hook's kill finds it.
    const release = Promise.withResolvers<null>();
    const holding = underLock(store, async () => await release.promise);
    const cut = capturedSpawn(
      [capturedExecPath, join(import.meta.dir, "..", CLI), "pulse", "--state", state, "the-run"],
      {
        cwd: made.main,
        env: { ...made.env, ANA_HOSTS: "[]" },
        detached: true,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    await Bun.sleep(1500);
    process.kill(-cut.pid, "SIGTERM");
    expect(await new Response(cut.stdout).text()).not.toContain("reported");
    await cut.exited;
    expect(readFileSync(state, "utf8")).toBe(before);
    release.resolve(null);
    await holding;
    const next = look("--state", state, "the-run");
    expect(next.out).toContain("reported no-step");
    expect(next.out).toContain("· not read yet: rows of comparison.reported;");
    expect(linesOf(state, log)).toBe(2);
    expect(look("--state", state, "the-run").out).not.toContain("reported no-step");
  });

  it("starts no pass and waits for none where its new events hold no moment, and keeps a closed run in the looks while one is owed", () => {
    const { event, log, store, state, look } = host();
    writeFileSync(join(store, "pass.json"), JSON.stringify({ at: 0, ended: "finished" }));
    look("--state", state, "the-run");
    event("campaign.waited", { for: "provider", until: "2099-01-01T00:00:00.000Z", ms: 2 });
    const begun = performance.now();
    look("--state", state, "the-run");
    expect(performance.now() - begun).toBeLessThan(15_000);
    expect(existsSync(join(store, "pass.err"))).toBe(false);
    expect(parseJsonAs<{ at: number }>(readFileSync(join(store, "pass.json"), "utf8")).at).toBe(0);
    // A moment no reader has read keeps the closed run in looks that name no run.
    endPass(store, "finished");
    event(REPORTED, { reading: "no-step", session: "g-1" });
    expect(look("--state", state, "the-run").out).toContain(
      "· not read yet: rows of comparison.reported g-1;",
    );
    expect(look("--state", state).out).toBe("");
    keepResult(store, log, "rows", result(statSync(log).size), "g-1 rows row\n");
    const read = look("--state", state).out;
    expect(read).toContain("the-run");
    expect(read).toContain("◆ rows on comparison.reported g-1: g-1 rows row");
    expect(look("--state", state).out).toBe("");
  });

  it("takes one look and ends, and keeps looking only where --every asks", async () => {
    const { made, state } = host();
    const start = (...args: string[]) =>
      capturedSpawn(
        [capturedExecPath, join(import.meta.dir, "..", CLI), "pulse", "--state", state, ...args],
        {
          cwd: made.main,
          env: { ...made.env, ANA_HOSTS: "[]" },
          detached: true,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        },
      );
    const bare = start("the-run");
    const ended = await Promise.race([bare.exited, Bun.sleep(20_000).then(() => "still looking")]);
    if (ended === "still looking") process.kill(-bare.pid, "SIGTERM");
    expect(ended).toBe(0);
    const watching = start("--every", "0.1", "the-run");
    const early = await Promise.race([watching.exited, Bun.sleep(3000).then(() => "still looking")]);
    process.kill(-watching.pid, "SIGTERM");
    await watching.exited;
    expect(early).toBe("still looking");
    // A wait that is no number of seconds above 0 is refused before the first look, not looped on.
    for (const wait of ["0", "-5", "soon"]) {
      const refused = start("--every", wait, "the-run");
      const code = await Promise.race([refused.exited, Bun.sleep(20_000).then(() => "still looking")]);
      if (code === "still looking") process.kill(-refused.pid, "SIGTERM");
      expect(code).toBe(1);
    }
  });

  it("keeps a peer's look from counting as read until its caller returns the token", () => {
    const { event, log, made, look } = host();
    const state = join(made.main, ".ana", "pulse", "observer.json");
    const here = ["--no-readers", "--here", "--state", ".ana/pulse/observer.json", "the-run"];
    const tokenIn = (out: string) => /^ack ([0-9a-f]+)$/m.exec(out)?.[1] ?? "";
    const first = look(...here, "--ack", "none");
    expect(tokenIn(first.out)).not.toBe("");
    expect(existsSync(state)).toBe(false);
    event(REPORTED, { reading: "no-step" });
    // The caller was killed: it returns no token, and every line comes again.
    const again = look(...here, "--ack", "none");
    expect(again.out).toContain("the-run");
    const token = tokenIn(again.out);
    expect(token).not.toBe(tokenIn(first.out));
    expect(existsSync(state)).toBe(false);
    // It read that answer: the cursor moves, and a look with nothing new prints no token.
    const read = look(...here, "--ack", token);
    expect(read.out).toBe("");
    expect(linesOf(state, log)).toBe(2);
    expect(existsSync(`${state}.pending`)).toBe(false);
    // A later answer it never read is said again from where the last one left off.
    event(REPORTED, { reading: "step" });
    const lost = look(...here, "--ack", "none");
    expect(lost.out).toContain("reported step");
    const stale = look(...here, "--ack", "none");
    expect(stale.out).toContain("reported step");
    // A hand's `--here`, with no token, remembers at once as it always did.
    const hand = look("--no-readers", "--here", "--state", ".ana/pulse/hand.json", "the-run");
    expect(hand.out).not.toContain("ack ");
    expect(linesOf(join(made.main, ".ana", "pulse", "hand.json"), log)).toBe(3);
  });

  it("drops a peer's pending answer that a kill cut part way, and says its lines again", () => {
    const { made, look } = host();
    const state = join(made.main, ".ana", "pulse", "observer.json");
    mkdirSync(dirname(state), { recursive: true });
    writeFileSync(`${state}.pending`, '{"memory":{"logs":');
    const here = ["--no-readers", "--here", "--state", ".ana/pulse/observer.json", "the-run"];
    const after = look(...here, "--ack", "none");
    expect(after.code).toBe(0);
    expect(after.out).toContain("the-run");
    expect(existsSync(state)).toBe(false);
  });

  it("keeps the state whole while several looks remember it at once", async () => {
    const state = join(scratch(), "runs-pulse.json");
    const pulse = JSON.stringify(join(import.meta.dir, "..", "tools", "runs", "pulse-readers.ts"));
    const writers = Array.from({ length: 4 }, (_, one) =>
      capturedSpawn(
        [
          capturedExecPath,
          "-e",
          `import { remember } from ${pulse}; const text = JSON.stringify({ writer: ${String(one)}, pad: "x".repeat(200_000) }); for (let i = 0; i < 100; i++) remember(${JSON.stringify(state)}, text);`,
        ],
        { stdout: "ignore", stderr: "ignore" },
      ),
    );
    expect(await Promise.all(writers.map(async (one) => await one.exited))).toEqual([0, 0, 0, 0]);
    expect(parseJsonAs<{ pad: string }>(readFileSync(state, "utf8")).pad).toHaveLength(200_000);
  }, 60_000);

  it("drops a gone observer's files, and the half-written ones of a dead writer at any age", async () => {
    const folder = scratch();
    const dead = capturedSpawn(["true"]);
    await dead.exited;
    const live = String(process.pid);
    const cut = [`gone.json.pending.${String(dead.pid)}.tmp`, `gone.json.${String(dead.pid)}.tmp`];
    for (const file of ["gone.json", ...cut, `slow.json.${live}.tmp`, "notes.txt"]) {
      writeFileSync(join(folder, file), "{}");
    }
    pruneObservers(join(folder, "observer.json"));
    expect(readdirSync(folder).toSorted()).toEqual(["gone.json", "notes.txt", `slow.json.${live}.tmp`]);
    pruneObservers(join(folder, "observer.json"), Date.now() + 8 * 24 * 60 * 60_000);
    expect(readdirSync(folder).toSorted()).toEqual(["notes.txt", `slow.json.${live}.tmp`]);
  });

  it("returns each host's token, hides it, and keeps it for a host that gave no answer", () => {
    const made = fakeHosts();
    folders.push(made.root);
    const state = join(made.root, "session.pulse.json");
    const fleet = (pulse: string) => ({
      FAKE_FLEET: JSON.stringify({ [made.host.ssh]: { pulse } }),
    });
    const look = (env: Record<string, string>) =>
      made.runScript(CLI, ["pulse", "--no-readers", "--state", state], env);
    const said = look(fleet("◆ reported step\nack 0123abcd"));
    expect(said.code).toBe(0);
    expect(said.out).toContain("── runner");
    expect(said.out).toContain("◆ reported step");
    expect(said.out).not.toContain("ack 0123abcd");
    const remote = () =>
      made
        .recorded()
        .findLast((call) => call.tool === "ssh" && (call.args.at(-1) ?? "").includes("pulse"))
        ?.args.at(-1)
        ?.replaceAll(String.raw`'\''`, "") ?? "";
    const offline = look({ FAKE_OFFLINE: "1" });
    expect(offline.code).toBe(0);
    // The hook's filter shows a line that opens with a warning on its own.
    expect(offline.out).toMatch(/^⚠ runner is offline: no answer in /mu);
    look(fleet("◆ reported no-step\nack 89abcdef"));
    expect(remote()).toContain("--ack 0123abcd");
    look(fleet(""));
    expect(remote()).toContain("--ack 89abcdef");
  });

  it("works as one host with no ssh, no hosts set and no new file", () => {
    const { made, look, state } = host();
    const first = look("--state", state, "the-run");
    expect(first.code).toBe(0);
    expect(first.out).toContain("the-run");
    expect(first.out).not.toContain("── here");
    expect(made.recorded().filter((call) => call.tool === "ssh")).toHaveLength(0);
  });

  it("gives up on a peer at its deadline, with no answer standing for one", async () => {
    expect(
      await withinDeadline(
        Bun.sleep(5000).then(() => "late"),
        20,
      ),
    ).toBeNull();
    expect(await withinDeadline(Promise.resolve("soon"), 20)).toBe("soon");
    expect(await withinDeadline(Promise.resolve("spent"), -5)).toBe("spent");
    // Its timer goes with the answer: one left running held every finished look for its 33 s.
    const driver = join(scratch(), "driver.ts");
    writeFileSync(
      driver,
      `import { withinDeadline } from ${JSON.stringify(join(import.meta.dir, "..", "tools", "runs", "pulse-readers.ts"))};
await withinDeadline(Promise.resolve(1), 30000);`,
    );
    const begun = performance.now();
    await capturedSpawn([capturedExecPath, driver], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      .exited;
    expect(performance.now() - begun).toBeLessThan(15_000);
  });
});

describe("the readers' list", () => {
  it("names each reader once, the rows first and the readers of kept harnesses last", () => {
    const names = READERS.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]).toBe("rows");
    expect(names.slice(-2)).toEqual(["versions", "chain"]);
  });

  it("leaves to `derive` alone the readers no moment names, the embedding and kept-harness ones among them", () => {
    const unnamed = READERS.filter(({ at }) => at === undefined).map(({ name }) => name);
    for (const name of ["degradations", "restated", "nearness", "versions", "chain"]) {
      expect(unnamed).toContain(name);
    }
    expect(READERS.filter(({ embeds, at }) => embeds === true && at !== undefined)).toEqual([]);
    const rows = READERS.find(({ name }) => name === "rows")?.at ?? [];
    for (const kind of [REPORTED, PROMOTED, "exam.finished", "build.finished", "campaign.ended"] as const) {
      expect(rows).toContain(kind);
    }
  });

  it("reads a log's campaign by the folder that holds it", () => {
    const view = READERS.find(({ name }) => name === "view");
    expect(view?.args("/a/b/the-run/log.jsonl", "/repo")).toEqual(["tools/runs/cli.ts", "view", "the-run"]);
  });
});

describe.skipIf(!osIsolationSupport().ok)("what a look wrote, through a seat's wall", () => {
  const SECRET = "reader-output-must-stay-hidden";
  const context = BACKGROUND_CONTEXT;

  /** Whether a seat can read `path`, in a shell and by its file tools. */
  async function readable(env: ExecutionEnv, path: string): Promise<boolean> {
    let output = "";
    const shell = await env.exec(
      ["cat", path],
      {
        onOutput: (text) => {
          output += text;
        },
      },
      context,
    );
    const file = await env.readTextFile(path, context);
    return (shell.ok && shell.value.exitCode === 0) || output.includes(SECRET) || file.ok;
  }

  it("closes the store and an observer's files, under the main tree and the host's temporary folder", async () => {
    const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-pulse-wall-")));
    const elsewhere = join(realpathSync.native(tmpdir()), `claude-anti-stall-${crypto.randomUUID()}`);
    folders.push(repoRoot, elsewhere);
    const files = [
      join(repoRoot, ".ana", "pulse", "moments", "0123456789abcdef", "rows.txt"),
      join(repoRoot, ".ana", "pulse", "observer.json"),
      join(repoRoot, ".ana", "pulse", "observer.json.pending"),
      join(repoRoot, ".ana", "pulse", "observer.json.d", "the-run", "rows.txt"),
      join(elsewhere, "session.pulse.json"),
      join(elsewhere, "session.pulse.json.d", "the-run", "rows.txt"),
    ];
    for (const file of files) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, SECRET);
    }
    const dirs = solveDirs(`pulse-wall-${crypto.randomUUID()}`);
    const release = claimRoot(dirs.root);
    let env: ExecutionEnv | undefined;
    try {
      const base = await walledBase(dirs, { repoRoot }, "the pulse's wall test");
      const wall: CommandWall = {
        base,
        dirs,
        toolTree: null,
        limits: { shellDefaultSeconds: 1, shellMaxSeconds: 2 },
      };
      env = walledEnv(wall);
      for (const file of files) expect(await readable(env, file)).toBe(false);
      // The nearest hostile case: the wall's own check of a path it leaves open.
      const open = join(wall.dirs.home, "own.txt");
      writeFileSync(open, SECRET);
      expect(await readable(env, open)).toBe(true);
    } finally {
      await env?.cleanup(context);
      await release();
      rmSync(dirs.host, { recursive: true, force: true });
    }
    expect(statSync(files[0] ?? "").size).toBe(SECRET.length);
  });
});
