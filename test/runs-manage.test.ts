// Campaign login isolation, clean-point pausing and dry-run refusals.
import { afterAll, describe, expect, it } from "bun:test";
import { append, type EventKind, type LogEvent } from "../src/kernel/log.ts";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "../src/meta/process.ts";
import { LIMITS } from "../tools/d2/campaign.ts";
import { loginEnv, restsAfter, solvesMs } from "../tools/runs/manage.ts";
import { type Receipt, writeReceipt } from "../tools/runs/receipt.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

const KEY = "CLAUDE_CODE_OAUTH_TOKEN";
const fixtures: string[] = [];
afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-10-15T12:00:00.000Z",
  kind,
  data,
});

describe("going on with a campaign", () => {
  it("isolates the chosen login and never chooses a numbered key implicitly", () => {
    const env = { PATH: "/bin", [KEY]: "a", [`${KEY}3`]: "c", [`${KEY}4`]: "d" };
    expect(loginEnv(env, "4")).toEqual({ PATH: "/bin", [KEY]: "d", ANA_LOGIN: "4" });
    for (const input of [env, { ...env, [`${KEY}2`]: "" }]) {
      expect(() => loginEnv(input, "2")).toThrow(`${KEY}2`);
    }
    for (const [input, expected] of [
      [
        { PATH: "/bin", [KEY]: "a", [`${KEY}3`]: "c" },
        { PATH: "/bin", [KEY]: "a" },
      ],
      [{ PATH: "/bin", [`${KEY}3`]: "c" }, { PATH: "/bin" }],
      [{ PATH: "/bin", [`${KEY}3`]: "c", [`${KEY}4`]: "d" }, { PATH: "/bin" }],
    ] as const) {
      expect(loginEnv(input, undefined)).toEqual(expected);
    }
  });

  it("pauses past one more of the event, once no comparison, Examiner session or draft is open", () => {
    const reported = [
      event("build.started", { session: "b-1" }),
      event("comparison.started", { session: "g-2" }),
      event("comparison.reported", { session: "g-2", reading: "no-step" }),
    ];
    // The Builder's conversation is open throughout a led campaign, and a pause cuts it: the
    // campaign run again opens a new one on its notes.
    expect(restsAfter(reported, "reported", 0)).toBe(true);
    expect(restsAfter(reported, "reported", 1)).toBe(false);
    // `next` joined to another point names nothing: taken as that other point it would write no
    // pause word and rest with a solve open.
    expect(restsAfter(reported, "reported|promoted", 0)).toBe(true);
    expect(() => restsAfter(reported, "next|reported", 0)).toThrow("--after takes");
    // An old ladder's reading left open is no comparison: no move goes on with it.
    const read = [...reported, event("comparison.started", { session: "l-1", ladder: true })];
    expect(restsAfter(read, "reported", 0)).toBe(true);
    for (const open of [
      event("comparison.started", { session: "g-3" }),
      event("exam.started", { session: "x-1" }),
      event("draft.started", { session: "d-1" }),
    ]) {
      expect(restsAfter([...read, open], "reported", 0)).toBe(false);
    }
  });

  it("holds a pause after a report from a promotion until its starter comparison has tallied", () => {
    const report = (session: string, fresh: string, data: JsonObject) => [
      event("comparison.started", { session, starter: "s" }),
      event("comparison.reported", { session, old: "h", fresh, ...data }),
    ];
    const promoted = [
      event("build.started", { session: "b-1" }),
      event("comparison.started", { session: "g-1", starter: "s" }),
      event("comparison.reported", { session: "g-1", old: "s", fresh: "h", reading: "step" }),
      event("harness.promoted", { harness: "h" }),
    ];
    // The report a pause waited for read a step and the host promoted in the same move: a rest
    // here would leave the promotion unread against the starter.
    expect(restsAfter(promoted, "reported", 0)).toBe(false);
    // A word that names the promotion rests at it, alone or joined.
    expect(restsAfter(promoted, "promoted", 0)).toBe(true);
    expect(restsAfter(promoted, "reported|promoted", 0)).toBe(true);
    // The Builder's own comparison can read first, and a starter comparison that scored nothing
    // leaves the pair owed: neither is the starter read.
    const own = report("g-2", "c", { reading: "no-step", scored: { differences: [1] } });
    expect(restsAfter([...promoted, ...own], "reported", 0)).toBe(false);
    const unscored = report("g-2", "s", { reading: "not-scored" });
    expect(restsAfter([...promoted, ...unscored], "reported", 0)).toBe(false);
    // The starter read rests the run whatever it read, and still only past the pause's own count.
    const starter = report("g-3", "s", { reading: "no-step", scored: { differences: [-1, 0] } });
    expect(restsAfter([...promoted, ...starter], "reported", 0)).toBe(true);
    expect(restsAfter([...promoted, ...starter], "reported", 2)).toBe(false);
    // An earlier promotion's read does not stand in for the newest promotion's.
    const again = [
      ...promoted,
      ...starter,
      ...report("g-4", "c", { reading: "step" }),
      event("harness.promoted", { harness: "c" }),
    ];
    expect(restsAfter(again, "reported", 0)).toBe(false);
  });

  it("pauses at a promotion or an Examiner session's end, or at the first of the words joined by |", () => {
    const climbing = [
      event("build.started", { session: "b-1" }),
      event("exam.started", { session: "x-1" }),
      event("exam.finished", { session: "x-1" }),
      event("comparison.started", { session: "g-1" }),
      event("comparison.reported", { session: "g-1", reading: "step" }),
      event("harness.promoted", { harness: "h" }),
    ];
    expect(restsAfter(climbing, "promoted", 0)).toBe(true);
    expect(restsAfter(climbing, "promoted", 1)).toBe(false);
    expect(restsAfter(climbing, "examined", 0)).toBe(true);
    // The first of the joined words is enough, and the count is of their events together.
    expect(restsAfter(climbing, "reported|promoted", 1)).toBe(true);
    expect(restsAfter(climbing, "reported|promoted", 2)).toBe(false);
    // The quiet point still binds: a comparison open since the promotion holds the pause.
    const reading = [...climbing, event("comparison.started", { session: "g-2" })];
    expect(restsAfter(reading, "promoted", 0)).toBe(false);
  });

  it("pauses after any seat's compaction, once the Builder's conversation is all that is open", () => {
    const open = [
      event("build.started", { session: "b-1" }),
      event("exam.started", { session: "x-1" }),
      event("exam.compacted", { session: "x-1", tokensBefore: 290_000 }),
    ];
    // The Examiner's ask holds the pause until it ends; its compaction counts from then.
    expect(restsAfter(open, "compacted", 0)).toBe(false);
    const rested = [...open, event("exam.finished", { session: "x-1" })];
    expect(restsAfter(rested, "compacted", 0)).toBe(true);
    for (const kind of [
      "build.compacted",
      "draft.compacted",
      "solve.compacted",
      "referee.compacted",
    ] as const) {
      expect(restsAfter([...rested, event(kind, {})], "compacted", 1)).toBe(true);
    }
    // A practice solve the Builder waits on, and the Referee's reading of its fail, hold it too:
    // stopped there, the solve is spent and the reading writes no finding.
    const practising = [...rested, event("solve.started", { solve: "s-1" })];
    expect(restsAfter(practising, "compacted", 0)).toBe(false);
    const ruling = [
      ...practising,
      event("solve.finished", { solve: "s-1" }),
      event("referee.turn", { reader: "r-1" }),
    ];
    expect(restsAfter(ruling, "compacted", 0)).toBe(false);
    expect(restsAfter([...ruling, event("referee.finding", { reader: "r-1" })], "compacted", 0)).toBe(true);
    // A solve a killed run left open began before the conversation open now and holds nothing,
    // where one begun inside that conversation still does.
    const orphan = { ...event("solve.started", { solve: "s-0" }), at: "2026-10-15T11:00:00.000Z" };
    expect(restsAfter([orphan, ...rested], "compacted", 0)).toBe(true);
    expect(restsAfter([orphan, ...practising], "compacted", 0)).toBe(false);
  });

  it("refuses a word it does not know, alone or among joined ones", async () => {
    const made = fakeHosts();
    fixtures.push(made.root);
    const name = "words";
    const folder = join(made.main, ".ana", "d2", name);
    mkdirSync(folder, { recursive: true });
    append(join(folder, "log.jsonl"), "campaign.opened", { name });
    for (const after of ["promotion", "reported|toString", "reported|"]) {
      const refused = made.run(
        `import { pause } from "REPOSITORY/tools/runs/manage.ts"; await pause(["${name}", "--after", "${after}", "--yes"]);`,
      );
      expect(refused.code).not.toBe(0);
      expect(refused.err).toContain("--after takes");
    }
  });

  it("refuses in the dry form of pause and continue the word --yes would refuse, and says a known one", () => {
    const made = fakeHosts();
    fixtures.push(made.root);
    const name = "dry";
    const folder = join(made.main, ".ana", "d2", name);
    mkdirSync(folder, { recursive: true });
    append(join(folder, "log.jsonl"), "campaign.opened", { name });
    const dry = (verb: "pause" | "continueRun", after: string) =>
      made.run(
        `import { ${verb} } from "REPOSITORY/tools/runs/manage.ts"; await ${verb}(${JSON.stringify([name, "--after", after, "--", "--budget", "5"])});`,
      );
    for (const verb of ["pause", "continueRun"] as const) {
      const refused = dry(verb, "reported|toString");
      expect(refused.code).not.toBe(0);
      expect(refused.err).toContain("--after takes");
      const told = dry(verb, "reported");
      expect({ code: told.code, err: told.err }).toEqual({ code: 0, err: "" });
      expect(told.out).toContain(
        verb === "pause" ? "would be stopped after its next reported" : "would go on after its next reported",
      );
    }
  });

  it("goes on under its last run's login where none is named, and under the one named", () => {
    const made = fakeHosts();
    fixtures.push(made.root);
    const launched = {
      at: "2026-11-11T02:43:00.000Z",
      pid: 42,
      flags: [],
      envFile: null,
      commit: "a".repeat(40),
      dirty: false,
      load: 0,
      cores: 2,
    };
    const said = (name: string, receipt: Receipt, args: readonly string[]) => {
      const log = join(made.main, ".ana", "d2", name, "log.jsonl");
      mkdirSync(join(made.main, ".ana", "d2", name), { recursive: true });
      append(log, "campaign.opened", { name });
      writeReceipt(log, "run-1", receipt);
      const told = made.run(
        `import { continueRun } from "REPOSITORY/tools/runs/manage.ts"; await continueRun(${JSON.stringify([name, ...args])});`,
      );
      expect({ code: told.code, err: told.err }).toEqual({ code: 0, err: "" });
      return told.out;
    };
    expect(said("numbered", { ...launched, login: "3" }, [])).toContain("on login 3 with");
    expect(said("moved", { ...launched, login: "3" }, ["--login", "1"])).toContain("on login 1 with");
    // A run launched on the unnumbered login is given no numbered one.
    expect(said("plain", launched, [])).toContain("on the unnumbered login with");
  });

  it("pauses at the next step only once no solve is open", () => {
    const solving = [
      event("solve.started", { solve: "s-1" }),
      event("solve.started", { solve: "s-2" }),
      event("solve.finished", { solve: "s-1" }),
    ];
    expect(restsAfter(solving, "next", 0)).toBe(false);
    expect(restsAfter([...solving, event("solve.finished", { solve: "s-2" })], "next", 0)).toBe(true);
  });

  it("allows open solves the limit the run recorded, and the default limit where it recorded none", () => {
    const setting = event("campaign.setting", { minutes: 45, target: 24, solver: null, modelTurns: 20 });
    expect(solvesMs([setting])).toBe(46 * 60_000);
    expect(solvesMs([])).toBe((LIMITS.wallSeconds + 60) * 1000);
  });

  it("pauses at the next finished solve or tool call, sessions open or not, and at no other event", () => {
    const drafting = [
      event("exam.started", { session: "x-1" }),
      event("exam.call", { session: "x-1", turn: 1 }),
      event("comparison.started", { session: "g-3" }),
    ];
    expect(restsAfter(drafting, "next", 1)).toBe(false);
    expect(restsAfter([...drafting, event("exam.turn", { session: "x-1", turn: 2 })], "next", 1)).toBe(false);
    for (const step of [
      event("exam.call", { session: "x-1", turn: 2 }),
      event("solve.call", { solve: "s-1" }),
      event("solve.finished", { solve: "s-1" }),
      event("build.call", { session: "b-1" }),
    ]) {
      expect(restsAfter([...drafting, step], "next", 1)).toBe(true);
    }
  });

  it("ends the keeper of a run no process writes, which would start it again under a move", async () => {
    const made = fakeHosts();
    fixtures.push(made.root);
    const name = "kept";
    const folder = join(made.main, ".ana", "d2", name);
    mkdirSync(folder, { recursive: true });
    append(join(folder, "log.jsonl"), "campaign.ended", { ending: "environment" });
    const keeper = capturedSpawn({
      cmd: ["sleep", "60"],
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    });
    // The fixture's `ps` lists this row: the keeper `keep.ts` starts, as it reads to `keepers`.
    const row = `${String(keeper.pid)} ${capturedExecPath} tools/runs/cli.ts keep ${name} --here`;
    try {
      const paused = made.run(
        `import { pause } from "REPOSITORY/tools/runs/manage.ts"; await pause(["${name}", "--yes"]);`,
        { FAKE_PS: row },
      );
      expect({ code: paused.code, err: paused.err }).toEqual({ code: 0, err: "" });
      expect(paused.out).toContain("its keeper");
      const ended = await Promise.race([keeper.exited.then(() => true), Bun.sleep(5000).then(() => false)]);
      expect(ended).toBe(true);
    } finally {
      keeper.kill();
    }
  });

  it("waits for a named point while a keeper holds a run between two starts, instead of stopping it early", () => {
    const made = fakeHosts();
    fixtures.push(made.root);
    const folder = join(made.main, ".ana", "d2", "between");
    mkdirSync(folder, { recursive: true });
    append(join(folder, "log.jsonl"), "campaign.ended", { ending: "environment" });
    const row = `${String(runtimeProcess.pid)} ${capturedExecPath} tools/runs/cli.ts keep between --here`;
    // The keeper is this test's own process, so the pause must still be waiting when the race ends.
    const raced = made.run(
      'import { pause } from "REPOSITORY/tools/runs/manage.ts"; const at = await Promise.race([pause(["between", "--after", "reported", "--yes"]).then(() => "stopped"), Bun.sleep(1500).then(() => "waits")]); console.log(at); process.exit(0);',
      { FAKE_PS: row },
    );
    expect(raced.out.trim().split("\n").at(-1)).toBe("waits");
  });

  it("refuses a second waiter on one run, which could start again a run the first had stopped", () => {
    const made = fakeHosts();
    fixtures.push(made.root);
    const folder = join(made.main, ".ana", "d2", "waited");
    mkdirSync(folder, { recursive: true });
    append(join(folder, "log.jsonl"), "campaign.ended", { ending: "environment" });
    const pauseOf = (row: string) =>
      made.run(
        'import { pause } from "REPOSITORY/tools/runs/manage.ts"; await pause(["waited", "--after", "compacted", "--yes"]);',
        { FAKE_PS: row },
      );
    const waiting = `99999 ${capturedExecPath} tools/runs/cli.ts pause waited --after reported --yes`;
    const refused = pauseOf(waiting);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("already waits to stop in process 99999");
    // The name may follow the flags, as `parseArgs` takes it.
    const flagFirst = pauseOf(
      `99999 ${capturedExecPath} tools/runs/cli.ts pause --after reported waited --yes`,
    );
    expect(flagFirst.err).toContain("already waits to stop in process 99999");
    // Another run's waiter, or a continue that waits for nothing, leaves this pause free.
    for (const row of [
      waiting.replace("waited", "other"),
      `99999 ${capturedExecPath} tools/runs/cli.ts continue waited --login 1 --yes`,
    ]) {
      expect(pauseOf(row)).toMatchObject({ code: 0, err: "" });
    }
    expect(
      pauseOf(`99999 ${capturedExecPath} tools/runs/cli.ts continue waited --after compacted --yes`).code,
    ).toBe(1);
  });
});

describe("starting a campaign", () => {
  it("shows the dry run's own refusal, and starts nothing after it", () => {
    const made = fakeHosts();
    fixtures.push(made.root);
    // The install passes and a detached start would leave its call; the fake tree holds no
    // campaign command, so its dry run refuses with Bun's own words on stderr.
    const nice = join(made.root, "bin", "nice");
    writeFileSync(
      nice,
      `#!${capturedExecPath}\nimport { appendFileSync } from "node:fs";\nappendFileSync(process.env.FAKE_CALLS, JSON.stringify({tool:"nice",args:process.argv.slice(2)}) + "\\n");\n`,
    );
    chmodSync(nice, 0o755);
    const result = made.run(
      'import { launch } from "REPOSITORY/tools/runs/manage.ts"; await launch(["refused", "--yes"]);',
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain("tools/d2/harness-builder.ts");
    expect(made.recorded().filter(({ tool, args }) => tool === "nice" && args.includes("19"))).toEqual([]);
  });
});
