// A look's readers, by moment: what a reader says of the event it answers and when, what a look says
// it has not read, what a pass runs and costs a host, what a kill leaves, and that no seat can read
// what they wrote.
import { afterAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import {
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
import { hostname, tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn } from "../src/meta/process.ts";
import { type CommandSandbox, solveDirs, sandboxBase } from "../src/tools/command.ts";
import { walledEnv } from "../src/tools/env.ts";
import { osIsolationSupport } from "../src/sandbox/os-isolation.ts";
import { claimRoot } from "../src/sandbox/sandbox-root.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { pulse } from "../tools/runs/pulse.ts";
import { formatReaderLines, pruneObservers, resultOf, underLock } from "../tools/runs/pulse-readers.ts";
import type { Run } from "../tools/runs/registry.ts";
import { READERS } from "../tools/wri/derive.ts";
import { passOver } from "../tools/wri/pass.ts";
import { wriCampaign } from "./helpers/wri-campaign.ts";

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

function scratch(): string {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-pulse-readers-")));
  folders.push(folder);
  return folder;
}

describe("what a pass costs a host", () => {
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

  it("keeps the state whole while several looks remember it at once", async () => {
    const state = join(scratch(), "runs-pulse.json");
    const pulseMod = JSON.stringify(join(import.meta.dir, "..", "tools", "runs", "pulse-readers.ts"));
    const writers = Array.from({ length: 4 }, (_, one) =>
      capturedSpawn(
        [
          capturedExecPath,
          "-e",
          `import { remember } from ${pulseMod}; const text = JSON.stringify({ writer: ${String(one)}, pad: "x".repeat(200_000) }); for (let i = 0; i < 100; i++) remember(${JSON.stringify(state)}, text);`,
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

  it("runs moment-wrapped WRI readers through passOver + formatReaderLines and surfaces watched pulse alarms", async () => {
    const root = scratch();
    const camp = join(root, "camp");
    const store = join(root, "store");
    const files = join(root, "files");
    const digest = "b".repeat(64);
    mkdirSync(join(camp, "states", digest, "agent"), { recursive: true });
    writeFileSync(join(camp, "states", digest, "agent", "BUILT_AGENTS.md"), "Use /Users/x/bin.\n");
    const AT = "2026-11-22T12:00:00.000Z";
    const events: readonly LogEvent[] = [
      ...wriCampaign((tag) => `secret ${tag}`),
      { at: AT, kind: "contract.frozen", data: { checks: "chk1", admitted: [] } },
      { at: AT, kind: "harness.promoted", data: { harness: digest, from: "hd" } },
      {
        at: AT,
        kind: "build.compacted",
        data: { session: "b-1", tokensBefore: 40_000, seconds: 2, usages: [] },
      },
      {
        at: AT,
        kind: "build.call",
        data: { session: "b-1", turn: 9, tool: "bash", args: {}, text: "", isError: false, ms: 1 },
      },
      { at: AT, kind: "build.finished", data: { session: "b-1", ended: "finished" } },
    ];
    const log = join(camp, "log.jsonl");
    writeFileSync(log, events.map((each) => `${JSON.stringify(each)}\n`).join(""));

    const inProcess = READERS.filter((each) => !("args" in each) && each.at !== undefined);
    await passOver(store, [log], { budgetMs: 30_000, roomNow: () => true, readers: inProcess });
    for (const name of [
      "diagnostics",
      "execution",
      "continuity",
      "scores",
      "deliverables",
      "transfer",
      "portability",
      "checks",
      "epoch-spend",
    ]) {
      expect({ name, ok: resultOf(store, log, name)?.ok }).toEqual({ name, ok: true });
    }
    const read = formatReaderLines({
      store,
      log,
      size: Bun.file(log).size,
      fresh: events.slice(-4),
      owed: undefined,
      said: undefined,
      files,
      spare: 30,
      watched: new Set(),
    });
    const surfaced = [...read.placed.flatMap(({ lines }) => lines), ...read.lines].join("\n");
    expect(surfaced).toContain("portability:");
    expect(surfaced).toContain("host-paths 1");
    expect(surfaced).toContain("diagnostics:");
    expect(surfaced).toContain("compaction amnesia");

    const run: Run = { name: "camp", path: log, tree: root, end: "comparison.reported" };
    const life = { writing: true, kept: false };
    const first = pulse(run, events, life, undefined, { now: Date.parse(AT), alarms: [] });
    const second = pulse(run, events, life, first.seen, {
      now: Date.parse(AT),
      alarms: [
        { name: "EXAMINER ZERO YIELD", lane: 13, detail: "x-2 (finished, 0 proposed, 3 try_reference)" },
        { name: "BILLING RESIDUAL", lane: 19, detail: "billed $10.00 (+12%)" },
      ],
    });
    expect(second.said.join("\n")).toContain("⚠ supply: EXAMINER ZERO YIELD (lane 13)");
    expect(second.said.join("\n")).toContain("⚠ economy: BILLING RESIDUAL (lane 19)");
    // ONCE_TRIGGERS suppresses re-firing BILLING RESIDUAL when only the dollar figure moves.
    const third = pulse(run, events, life, second.seen, {
      now: Date.parse(AT),
      alarms: [{ name: "BILLING RESIDUAL", lane: 19, detail: "billed $25.00 (+14%)" }],
    });
    expect(third.said.join("\n")).not.toContain("BILLING RESIDUAL");
  });
});

describe.skipIf(!osIsolationSupport().ok)("what a look wrote, through a seat's wall", () => {
  const SECRET = "reader-output-must-stay-hidden";
  const context = BACKGROUND_CONTEXT;

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
    const release = await claimRoot(dirs.root);
    let env: ExecutionEnv | undefined;
    try {
      const base = await sandboxBase(dirs, { repoRoot }, "the pulse's wall test");
      const wall: CommandSandbox = {
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
