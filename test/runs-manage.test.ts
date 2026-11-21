// Campaign login isolation, clean-point pausing and dry-run refusals.
import { afterAll, describe, expect, it } from "bun:test";
import { append, type EventKind, LOG_FILE, type LogEvent, read as readLog } from "../src/kernel/log.ts";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn } from "../src/meta/process.ts";
import { heldBy, loginEnv } from "../tools/runs/manage.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

/** Driver code run as a waiting verb reaches its point, given the log and a writer of a fake's state. */
type Meanwhile = (log: string, set: (name: string, text: string) => string) => string;

const KEY = "CLAUDE_CODE_OAUTH_TOKEN";
const fixtures: string[] = [];
const sleepers: { kill: () => void }[] = [];
afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
  for (const each of sleepers) each.kill();
});
/** A process that lives a minute, as a keeper or a writer the `ps` fake names. */
function sleeper(cwd = ".") {
  const child = capturedSpawn(["sleep", "60"], { detached: true, cwd });
  sleepers.push(child);
  return child;
}

/** Whether a pause may stop the run: nothing holds it (`heldBy`). */
const restsAfter = (events: readonly LogEvent[], after: string, base: number) =>
  heldBy(events, after, base).length === 0;

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
    const starter = report("g-3", "s", { reading: "no-step", scored: { differences: [-1, 0] } });
    const own = report("g-2", "c", { reading: "no-step", scored: { differences: [1] } });
    const newer = [...report("g-4", "c", { reading: "step" }), event("harness.promoted", { harness: "c" })];
    // A step promoted in the move the pause waited for is unread against the starter, which a word
    // naming the promotion does not wait for; neither the Builder's own comparison nor a starter one
    // that scored nothing is that read; it rests the run whatever it read, past the pause's own count;
    // an earlier promotion's read stands for no newer one.
    for (const [events, after, base, rests] of [
      [promoted, "reported", 0, false],
      [promoted, "promoted", 0, true],
      [promoted, "reported|promoted", 0, true],
      [[...promoted, ...own], "reported", 0, false],
      [[...promoted, ...report("g-2", "s", { reading: "not-scored" })], "reported", 0, false],
      [[...promoted, ...starter], "reported", 0, true],
      [[...promoted, ...starter], "reported", 2, false],
      [[...promoted, ...starter, ...newer], "reported", 0, false],
    ] satisfies [LogEvent[], string, number, boolean][]) {
      expect(restsAfter(events, after, base)).toBe(rests);
    }
    // The dry form names each hold apart: the unread promotion for `reported` alone, and once a read
    // tallied, only the next report.
    const read = (held: string[]) => held.map((hold) => hold.includes("a starter comparison"));
    expect(read(heldBy(promoted, "reported", 1))).toEqual([false, true]);
    expect(read(heldBy(promoted, "promoted", 1))).toEqual([false]);
    expect(heldBy([...promoted, ...starter], "reported", 2)).toEqual([
      "one more comparison.reported, past 2",
    ]);
    const open = [...promoted, event("comparison.started", { session: "g-2", starter: "s" })];
    expect(heldBy(open, "reported", 1)).toHaveLength(3);
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
    expect(readLog(join(folder, "log.jsonl")).map(({ kind }) => kind)).toEqual(["campaign.opened"]);
  });

  /** A campaign a keeper holds and `verb` on `flags` waiting for its next report, which the log gains
   *  once the verb says it waits, after the driver code `meanwhile` returns (`set` writes a fake). */
  function pointed(flags: readonly string[], meanwhile: Meanwhile = () => "", verb = "continueRun") {
    const made = fakeHosts();
    fixtures.push(made.root);
    const folder = join(made.main, ".ana", "d2", "pointed");
    mkdirSync(folder, { recursive: true });
    const log = join(folder, LOG_FILE);
    append(log, "build.started", { session: "b-1" });
    mkdirSync(join(made.main, "tools", "d2"), { recursive: true });
    writeFileSync(join(made.main, "tools", "d2", "harness-builder.ts"), "process.exit(0);\n");
    const keeper = sleeper();
    const set = (name: string, text: string) =>
      `writeFileSync(${JSON.stringify(join(made.root, "now", name))}, ${JSON.stringify(text)});`;
    const driver = [
      'import { existsSync, writeFileSync } from "node:fs";',
      'import { append } from "REPOSITORY/src/kernel/log.ts";',
      "const sleep = Bun.sleep; Bun.sleep = (ms) => sleep(Math.min(Number(ms), 100));",
      `const { ${verb} } = await import("REPOSITORY/tools/runs/manage.ts");`,
      `const report = () => { ${meanwhile(log, set)} append(${JSON.stringify(log)}, "comparison.reported", { session: "g-1", reading: "no-step" }); };`,
      'const say = console.log; console.log = (line) => { say(line); if (String(line).includes("waiting for")) report(); };',
      `await ${verb}(${JSON.stringify(["pointed", "--after", "reported", ...flags, "--yes", "--", "--target", "8"])});`,
    ].join("\n");
    const row = `${String(keeper.pid)} ${capturedExecPath} tools/runs/cli.ts keep pointed --here`;
    return {
      made,
      log,
      row,
      go: (extra: Record<string, string> = {}) => made.run(driver, { FAKE_PS: row, ...extra }),
      ended: () => Promise.race([keeper.exited.then(() => true), Bun.sleep(500).then(() => false)]),
    };
  }
  const words = (log: string) =>
    readLog(log).flatMap(({ kind, data }, at) =>
      kind === "campaign.word" ? [{ at, word: data.word, why: data.why }] : [],
    );
  const filled = JSON.stringify([{ name: "other", login: "2", host: "runner" }]);
  const capped = { ANA_LOGIN_RUNS: "1", [`${KEY}2`]: "a" };

  it("asks at the point, before the stop, what the start would refuse, and leaves a refused run running with no word", async () => {
    for (const [flags, meanwhile, extra, refusal] of [
      [[], () => "", { FAKE_FETCH_FAIL: "1" }, "git exited 1"],
      [["--login", "2"], (_log, set) => set("FAKE_ACTIVE", filled), capped, "login 2 is at its live-run cap"],
      [[], (_log, set) => set("FAKE_DIRTY", " M src/kernel/log.ts"), {}, "holds a change no commit names"],
    ] satisfies [string[], Meanwhile, Record<string, string>, string][]) {
      const { log, go, ended } = pointed(flags, meanwhile);
      const refused = go(extra);
      expect(refused.code).not.toBe(0);
      expect(refused.out).toContain("waiting for comparison.reported past 0");
      expect(refused.err).toContain(refusal);
      expect(await ended()).toBe(false);
      expect(words(log)).toEqual([]);
    }
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
    expect(readLog(join(folder, "log.jsonl")).map(({ kind }) => kind)).toEqual(["campaign.ended"]);
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
