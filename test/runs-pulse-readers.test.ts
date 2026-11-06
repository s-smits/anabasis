// A look's readers: what they say once, what a cut look says it did not read, what a kill leaves, what
// a pass costs a host, and that no seat can read what they wrote.
import { afterAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn } from "../src/meta/process.ts";
import { type CommandWall, solveDirs, walledBase } from "../src/tools/command.ts";
import { walledEnv } from "../src/tools/env.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";
import { claimRoot } from "../src/wall/seat-root.ts";
import {
  dropLock,
  endPass,
  keepNames,
  keepResult,
  newsIn,
  notRead,
  passRunning,
  pastMilestone,
  readersSaid,
  resultOf,
  room,
  startPass,
  takeLock,
  withinDeadline,
} from "../tools/runs/pulse-readers.ts";
import { READERS } from "../tools/wri/derive.ts";
import { type Due, passOver, queueOf, runQueue } from "../tools/wri/pass.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

const CLI = "tools/runs/cli.ts";
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

/** A store that holds `names`, and a look at `log` as an observer that remembers `before`. */
function world(names: readonly string[]) {
  const root = scratch();
  const store = join(root, "store");
  mkdirSync(store, { recursive: true });
  keepNames(store, names);
  const log = join(root, "log.jsonl");
  writeFileSync(log, "x".repeat(100));
  const files = join(root, "observer.json.d", "the-run");
  const look = (over: Partial<Parameters<typeof readersSaid>[0]> = {}) =>
    readersSaid({
      store,
      log,
      size: 100,
      lastSize: undefined,
      before: undefined,
      milestoneAt: undefined,
      files,
      spare: 30,
      saidElsewhere: () => false,
      ...over,
    });
  return { root, store, log, files, look };
}

describe("what a reader says", () => {
  it("says a new row at once, holds a line that moved in a number, and never says a line twice", () => {
    const first = newsIn(["task t-1 pass", "solves 3"], undefined, { milestone: false });
    const grown = newsIn(["task t-1 pass", "task t-2 pass", "solves 4"], first, { milestone: false });
    expect(grown.fresh).toEqual(["task t-2 pass"]);
    expect(grown.moved).toEqual(["solves 4"]);
    const same = newsIn(["task t-1 pass", "task t-2 pass", "solves 4"], grown, { milestone: false });
    expect(same.fresh).toEqual([]);
    // Withheld, not lost: the milestone says it, and then it is held.
    const milestone = newsIn(["task t-1 pass", "task t-2 pass", "solves 4"], same, { milestone: true });
    expect(milestone.moved).toEqual(["solves 4"]);
    const after = newsIn(["task t-1 pass", "task t-2 pass", "solves 4"], milestone, { milestone: false });
    expect([after.fresh, after.moved]).toEqual([[], []]);
  });

  it("fires nothing new for a line that went and came back", () => {
    const first = newsIn(["alarm one", "alarm two"], undefined, { milestone: false });
    const gone = newsIn(["alarm one"], first, { milestone: true });
    expect([gone.fresh, gone.moved]).toEqual([[], []]);
    const back = newsIn(["alarm one", "alarm two"], gone, { milestone: false });
    expect(back.fresh).toEqual([]);
  });

  it("masks digits and digests, so a line that moved in one is one line", () => {
    const first = newsIn(["harness 0123abcd cost 1.50"], undefined, { milestone: false });
    const moved = newsIn(["harness 89ab4567 cost 2.75"], first, { milestone: false });
    expect([moved.fresh, moved.moved]).toEqual([[], ["harness 89ab4567 cost 2.75"]]);
  });

  it("reads a pass's result once per observer, bounds a wake, and leaves the full text in the file it names", () => {
    const { store, log, files, look } = world(["table"]);
    keepResult(store, log, "table", result(100), "row 0\n");
    const baseline = look();
    expect(baseline.said).toEqual([]);
    const rows = Array.from({ length: 41 }, (_, at) => `row ${String(at)} of a table`).join("\n");
    keepResult(store, log, "table", result(200), `${rows}\n`);
    const moved = look({ size: 200, lastSize: 100, before: baseline.seen });
    expect(moved.said.filter((line) => line.startsWith("◆ table: row"))).toHaveLength(3);
    expect(moved.said).toContain("◆ table: 38 more");
    expect(moved.said.at(-1)).toContain(files);
    expect(readFileSync(join(files, "table.txt"), "utf8")).toContain("row 40 of a table");
    expect(look({ size: 200, lastSize: 200, before: moved.seen }).said).toEqual([]);
  });

  it("shares one result between observers, each comparing against what it last saw", () => {
    const { store, log, look } = world(["table"]);
    keepResult(store, log, "table", result(100), "row 0\n");
    const [one, other] = [look(), look()];
    keepResult(store, log, "table", result(200), "row 0\nrow 1\n");
    for (const seen of [one.seen, other.seen]) {
      expect(look({ size: 200, lastSize: 100, before: seen }).said[0]).toBe("◆ table: row 1");
    }
  });

  it("bounds a run and a look, and leaves out what the look says itself", () => {
    const names = ["a", "b", "c", "d", "e", "f"];
    const { store, log, look } = world(names);
    for (const name of names) keepResult(store, log, name, result(100), "keep\n");
    const before = look().seen;
    const lines = Array.from({ length: 4 }, (_, at) => `new ${String(at)} line`).join("\n");
    for (const name of names) keepResult(store, log, name, result(200), `keep\n${lines}\n`);
    const full = look({ size: 200, lastSize: 100, before }).said;
    expect(full.filter((line) => /^◆ [a-f]: new/.test(line)).length).toBeLessThanOrEqual(12);
    expect(full.some((line) => /^◆ \d+ more lines, of .*f$/.test(line))).toBe(true);
    const spent = look({ size: 200, lastSize: 100, before, spare: 2 }).said;
    expect(spent.filter((line) => /^◆ [a-f]: /.test(line))).toHaveLength(2);
    const elsewhere = look({ size: 200, lastSize: 100, before, saidElsewhere: () => true }).said;
    expect(elsewhere).toEqual([]);
  });

  it("says a moved line only with the first result past a milestone, even one that lags the event", () => {
    expect(pastMilestone(undefined, 50, 100)).toBe(false);
    expect(pastMilestone(90, 50, 80)).toBe(false);
    expect(pastMilestone(90, 50, 100)).toBe(true);
    expect(pastMilestone(90, 95, 100)).toBe(false);
    const { store, log, look } = world(["view"]);
    keepResult(store, log, "view", result(50), "solves 3\n");
    const before = look({ size: 50 }).seen;
    // The look that saw the milestone at 100 bytes has a result of only 80 bytes.
    keepResult(store, log, "view", result(80), "solves 4\n");
    const behind = look({ size: 100, lastSize: 50, before, milestoneAt: 100 });
    expect(behind.said.filter((line) => line.includes("solves"))).toEqual([]);
    keepResult(store, log, "view", result(120), "solves 5\n");
    const past = look({ size: 120, lastSize: 100, before: behind.seen, milestoneAt: 100 });
    expect(past.said[0]).toBe("◆ view: solves 5");
  });

  it("says a failed reader once a failure, with its last line", () => {
    const { store, log, look } = world(["gap"]);
    keepResult(
      store,
      log,
      "gap",
      result(100, false),
      "\n-- gap ended with exit 1\n-- stderr\nno such file\n",
    );
    const failed = look();
    expect(failed.said).toEqual(["⚠ gap failed: no such file"]);
    keepResult(
      store,
      log,
      "gap",
      result(200, false),
      "\n-- gap ended with exit 1\n-- stderr\nno such file\n",
    );
    expect(look({ size: 200, lastSize: 100, before: failed.seen }).said).toEqual([]);
    keepResult(store, log, "gap", result(300, false), "\n-- gap ended with exit 1\n-- stderr\nit changed\n");
    expect(look({ size: 300, lastSize: 200, before: failed.seen }).said[0]).toBe("⚠ gap failed: it changed");
  });
});

describe("a reader that was not read never reads as nothing new", () => {
  it("names a reader that read nothing past this observer's last look, and no other", () => {
    const { store, log } = world(["ahead", "at-end", "behind", "never"]);
    keepResult(store, log, "ahead", result(150), "a\n");
    keepResult(store, log, "at-end", result(200), "a\n");
    keepResult(store, log, "behind", result(100), "a\n");
    const names = ["ahead", "at-end", "behind", "never"];
    expect(notRead(store, log, names, 200, 100)).toEqual(["behind", "never"]);
    // No claim on a first look, and none of a log that stands where it was read.
    expect(notRead(store, log, names, 200, undefined)).toEqual([]);
    expect(notRead(store, log, ["at-end", "behind"], 200, 200)).toEqual([]);
  });

  it("names it though the pass says it finished, and says why from what it can see", () => {
    const { store, log, look } = world(["rows", "chain"]);
    keepResult(store, log, "rows", result(200), "a\n");
    keepResult(store, log, "chain", result(100), "a\n");
    endPass(store, "finished");
    const said = look({ size: 200, lastSize: 100 });
    expect(said.said.at(-1)).toMatch(/^⚠ not read since the last look: chain; /);
    expect(said.owed).toBe(true);
    endPass(store, "budget");
    const budget = look({ size: 200, lastSize: 100 }).said.at(-1) ?? "";
    // A loaded test host says the load instead of the limit, and either is the reason.
    expect(budget).toMatch(/limit of 30 s|shed for the load/);
    endPass(store, "load");
    expect(look({ size: 200, lastSize: 100 }).said.at(-1)).toContain("load");
  });

  it("names every reader where no result exists, and keeps a closed run owed until each has read it", () => {
    const { store, log, look } = world(["rows", "chain"]);
    const nothing = look({ size: 200, lastSize: 100 });
    expect(nothing.said).toEqual([expect.stringMatching(/^⚠ not read since the last look: every reader; /)]);
    expect(nothing.owed).toBe(true);
    keepResult(store, log, "rows", result(200), "a\n");
    keepResult(store, log, "chain", result(200), "a\n");
    expect(look({ size: 200, lastSize: 200 }).owed).toBe(false);
  });

  it("says no reader where a host has never finished a pass, and why", () => {
    const root = scratch();
    const said = readersSaid({
      store: join(root, "store"),
      log: join(root, "log.jsonl"),
      size: 200,
      lastSize: 100,
      before: undefined,
      milestoneAt: undefined,
      files: join(root, "d"),
      spare: 30,
      saidElsewhere: () => false,
    });
    expect(said.said[0]).toMatch(/^⚠ not read since the last look: every reader; /);
  });
});

describe("what a pass costs a host", () => {
  const reader = (name: string) => ({ name, args: () => [] });
  const due = (name: string, ms = 0): Due => ({ log: "l", reader: reader(name), at: 0, ms });

  it("reads each log's rows first and then the oldest, and reuses a result whose log stands", () => {
    const { root, store, log } = world([]);
    const other = join(root, "other.jsonl");
    writeFileSync(other, "y".repeat(50));
    const readers = ["rows", "ending", "chain"].map(reader);
    keepResult(store, log, "ending", { ...result(1), at: 2000 }, "");
    keepResult(store, log, "chain", { ...result(1), at: 1000 }, "");
    keepResult(store, other, "rows", result(50), "");
    const queue = queueOf(store, [log, other], readers).map(
      (one) => `${one.log === log ? "l" : "o"}:${one.reader.name}`,
    );
    expect(queue[0]).toBe("l:rows");
    expect(queue.indexOf("l:chain")).toBeLessThan(queue.indexOf("l:ending"));
    expect(queue).not.toContain("o:rows");
    // Nothing is due of a log every reader has read at its size.
    for (const each of readers) keepResult(store, other, each.name, result(50), "");
    expect(queueOf(store, [other], readers)).toEqual([]);
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

  it("gives a log's rows no more than half the budget, so the others get a turn", async () => {
    const read: string[] = [];
    let clock = 0;
    await runQueue([due("rows"), due("rows"), due("ending")], {
      budgetMs: 1000,
      room: () => true,
      now: () => clock,
      read: async ({ reader: { name } }) => {
        read.push(name);
        clock += 600;
      },
    });
    expect(read).toEqual(["rows", "ending"]);
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
    const at = new Date().toISOString();
    writeFileSync(log, `${JSON.stringify({ at, kind: "build.started", data: { session: "b-1" } })}\n`);
    await passOver(store, [log], { budgetMs: 45_000, roomNow: () => true });
    const rows = resultOf(store, log, "rows");
    // A spawn that refused its limit failed every reader in 0 ms, which only a real pass shows.
    expect(rows).toMatchObject({ ok: true, size: statSync(log).size });
    const read = READERS.flatMap(({ name }) => resultOf(store, log, name) ?? []);
    expect(read.filter(({ ok }) => ok).length).toBeGreaterThan(READERS.length / 2);
    expect(read.every(({ ms }) => ms > 0)).toBe(true);
    expect(passRunning(store)).toBe(false);
  }, 60_000);

  it("lets one pass hold a host, and frees the lock of one that died", async () => {
    const store = join(scratch(), "store");
    expect(takeLock(store)).toBe(true);
    expect(takeLock(store)).toBe(false);
    expect(passRunning(store)).toBe(true);
    dropLock(store);
    expect(passRunning(store)).toBe(false);
    const gone = capturedSpawn(["true"]);
    await gone.exited;
    writeFileSync(join(store, "pass.lock"), String(gone.pid));
    expect(passRunning(store)).toBe(false);
    expect(takeLock(store)).toBe(true);
    dropLock(store);
    writeFileSync(join(store, "pass.lock"), String(process.pid));
    expect(passRunning(store, Date.now() + 120_000)).toBe(false);
  });

  /** A tree whose `tools/wri/pass.ts` stands in for the real one, recording each start. */
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
    const log = join(root, "log.jsonl");
    writeFileSync(log, "x".repeat(10));
    const started = () => (existsSync(marks) ? readFileSync(marks, "utf8").split("\n").filter(Boolean) : []);
    return { root, tree, store, log, marks, started };
  }

  async function until(test: () => boolean, ms = 10_000): Promise<void> {
    const deadline = performance.now() + ms;
    while (!test() && performance.now() < deadline) await Bun.sleep(25);
    expect(test()).toBe(true);
  }

  it("waits at most its limit for a pass, which outlives the wait and leaves its result for the next look", async () => {
    const { tree, store, log, started } = stubTree("await Bun.sleep(600);");
    const begun = performance.now();
    await startPass(store, [log], { tree, waitMs: 50, roomNow: () => true });
    expect(performance.now() - begun).toBeLessThan(500);
    await until(() => started().includes("ended"));
  });

  it("starts no pass within the rest between passes, nor one nothing is due of", async () => {
    const rest = stubTree("");
    mkdirSync(rest.store, { recursive: true });
    endPass(rest.store, "finished");
    await startPass(rest.store, [rest.log], { tree: rest.tree, waitMs: 2000, roomNow: () => true });
    expect(rest.started()).toEqual([]);
    const read = stubTree("");
    keepNames((mkdirSync(read.store, { recursive: true }), read.store), ["rows"]);
    keepResult(read.store, read.log, "rows", result(10), "");
    await startPass(read.store, [read.log], { tree: read.tree, waitMs: 2000, roomNow: () => true });
    expect(read.started()).toEqual([]);
    const none = stubTree("");
    await startPass(none.store, [], { tree: none.tree, waitMs: 2000, roomNow: () => true });
    expect(none.started()).toEqual([]);
  });

  it("keeps a pass going when the hook's limit kills the look's whole group", async () => {
    const { root, tree, store, log, started } = stubTree("await Bun.sleep(1200);");
    const driver = join(root, "driver.ts");
    writeFileSync(
      driver,
      `import { startPass } from ${JSON.stringify(join(import.meta.dir, "..", "tools", "runs", "pulse-readers.ts"))};
await startPass(${JSON.stringify(store)}, [${JSON.stringify(log)}], { tree: ${JSON.stringify(tree)}, waitMs: 30000, roomNow: () => true });`,
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
  function host(names: readonly string[] = ["rows"], extra: Record<string, string> = { ANA_HOSTS: "[]" }) {
    const made = fakeHosts();
    folders.push(made.root);
    const folder = join(made.main, ".ana", "d2", "the-run");
    mkdirSync(folder, { recursive: true });
    const log = join(folder, "log.jsonl");
    const event = (kind: string, data: JsonObject) =>
      writeFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), kind, data })}\n`, { flag: "a" });
    event("campaign.waited", { for: "provider", until: "2099-01-01T00:00:00.000Z", ms: 1 });
    const store = join(made.main, ".ana", "pulse", "readers");
    mkdirSync(store, { recursive: true });
    keepNames(store, names);
    endPass(store, "finished");
    const state = join(made.root, "session.pulse.json");
    const look = (...args: string[]) => made.runScript(CLI, ["pulse", "--once", ...args], extra);
    return { made, log, event, store, state, look };
  }
  const linesOf = (state: string, log: string) =>
    parseJsonAs<{ logs: Record<string, { lines: number }> }>(readFileSync(state, "utf8")).logs[log]?.lines;

  it("loses no event when the hook's limit kills it before it prints, and the next look says them", async () => {
    const { made, log, event, store, state, look } = host();
    look("--state", state, "the-run");
    expect(linesOf(state, log)).toBe(1);
    event("comparison.reported", { reading: "no-step" });
    const before = readFileSync(state, "utf8");
    // A running pass holds the look in its wait, where the hook's kill finds it.
    writeFileSync(join(store, "pass.lock"), String(process.pid));
    const cut = capturedSpawn(
      [capturedExecPath, join(import.meta.dir, "..", CLI), "pulse", "--once", "--state", state, "the-run"],
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
    dropLock(store);
    const next = look("--state", state, "the-run");
    expect(next.out).toContain("reported no-step");
    expect(next.out).toContain("⚠ not read since the last look: every reader;");
    expect(linesOf(state, log)).toBe(2);
    expect(look("--state", state, "the-run").out).not.toContain("reported no-step");
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
  });

  it("keeps a peer's look from counting as read until its caller returns the token", () => {
    const { event, log, made, look } = host();
    const state = join(made.main, ".ana", "pulse", "observer.json");
    const here = ["--no-readers", "--here", "--state", ".ana/pulse/observer.json", "the-run"];
    const tokenIn = (out: string) => /^ack ([0-9a-f]+)$/m.exec(out)?.[1] ?? "";
    const first = look(...here, "--ack", "none");
    expect(tokenIn(first.out)).not.toBe("");
    expect(existsSync(state)).toBe(false);
    event("comparison.reported", { reading: "no-step" });
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
    event("comparison.reported", { reading: "step" });
    const lost = look(...here, "--ack", "none");
    expect(lost.out).toContain("reported step");
    const stale = look(...here, "--ack", "none");
    expect(stale.out).toContain("reported step");
    // A hand's `--here`, with no token, remembers at once as it always did.
    const hand = look("--no-readers", "--here", "--state", ".ana/pulse/hand.json", "the-run");
    expect(hand.out).not.toContain("ack ");
    expect(linesOf(join(made.main, ".ana", "pulse", "hand.json"), log)).toBe(3);
  });

  it("returns each host's token, hides it, and keeps it for a host that gave no answer", () => {
    const made = fakeHosts();
    folders.push(made.root);
    const state = join(made.root, "session.pulse.json");
    const fleet = (pulse: string) => ({
      FAKE_FLEET: JSON.stringify({ [made.host.ssh]: { pulse } }),
    });
    const look = (env: Record<string, string>) =>
      made.runScript(CLI, ["pulse", "--once", "--no-readers", "--state", state], env);
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
    expect(offline.code).toBe(1);
    // The hook's filter keeps an indented warning and drops an unindented line.
    expect(offline.out).toContain("── runner");
    expect(offline.out).toContain("  ⚠ no answer: its lines carry to the next look");
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
      join(repoRoot, ".ana", "pulse", "readers", "0123456789abcdef", "rows.txt"),
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
