import { afterAll, describe, expect, it } from "bun:test";
import { append, type EventKind, LOG_FILE, type LogEvent, read as readLog } from "../src/kernel/log.ts";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn } from "../src/meta/process.ts";
import { heldBy, loginEnv } from "../tools/runs/manage.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

type Meanwhile = (log: string, set: (name: string, text: string) => string) => string;

const KEY = "CLAUDE_CODE_OAUTH_TOKEN";
const fixtures: string[] = [];
const sleepers: { kill: () => void }[] = [];
afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
  for (const each of sleepers) each.kill();
});
function sleeper(cwd = ".") {
  const child = capturedSpawn(["sleep", "60"], { detached: true, cwd });
  sleepers.push(child);
  return child;
}

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
    // A pause cuts the Builder's open conversation, so the campaign run again opens a new one on its
    // notes.
    expect(restsAfter(reported, "reported", 0)).toBe(true);
    expect(restsAfter(reported, "reported", 1)).toBe(false);
    expect(restsAfter(reported, "reported|promoted", 0)).toBe(true);
    expect(() => restsAfter(reported, "next|reported", 0)).toThrow("--after takes");
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
    // A step promoted in the move the pause waited for is unread against the starter; neither the
    // Builder's own comparison nor an empty starter one is that read, and an earlier promotion's read
    // stands for no newer one.
    for (const [events, after, base, rests] of [
      [promoted.slice(0, -1), "reported", 0, false],
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
    const results = await Promise.all(
      ["promotion", "reported|toString", "reported|"].map((after) =>
        made.runAsync(
          `import { pause } from "REPOSITORY/tools/runs/manage.ts"; await pause(["${name}", "--after", "${after}", "--yes"]);`,
        ),
      ),
    );
    for (const refused of results) {
      expect(refused.code).not.toBe(0);
      expect(refused.err).toContain("--after takes");
    }
    expect(readLog(join(folder, "log.jsonl")).map(({ kind }) => kind)).toEqual(["campaign.opened"]);
  });

  function pointed(flags: readonly string[], meanwhile: Meanwhile = () => "", verb = "continueRun") {
    const made = fakeHosts();
    fixtures.push(made.root);
    const folder = join(made.main, ".ana", "d2", "pointed");
    mkdirSync(folder, { recursive: true });
    const log = join(folder, LOG_FILE);
    append(log, "build.started", { session: "b-1" });
    mkdirSync(join(made.main, "tools", "campaign"), { recursive: true });
    writeFileSync(join(made.main, "tools", "campaign", "harness-builder.ts"), "process.exit(0);\n");
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
      go: (extra: Record<string, string> = {}) => made.runAsync(driver, { FAKE_PS: row, ...extra }),
      ended: () => Promise.race([keeper.exited.then(() => true), Bun.sleep(200).then(() => false)]),
    };
  }
  const words = (log: string) =>
    readLog(log).flatMap(({ kind, data }, at) =>
      kind === "campaign.word" ? [{ at, word: data.word, why: data.why }] : [],
    );
  const filled = JSON.stringify([{ name: "other", login: "2", host: "runner" }]);
  const capped = { ANA_LOGIN_RUNS: "1", [`${KEY}2`]: "a" };

  it("asks at the point, before the stop, what the start would refuse, and leaves a refused run running with no word", async () => {
    const cases: [string[], Meanwhile, Record<string, string>, string][] = [
      [[], () => "", { FAKE_FETCH_FAIL: "1" }, "git exited 1"],
      [["--login", "2"], (_log, set) => set("FAKE_ACTIVE", filled), capped, "login 2 is at its live-run cap"],
      [[], (_log, set) => set("FAKE_DIRTY", " M src/kernel/log.ts"), {}, "holds a change no commit names"],
    ];
    await Promise.all(
      cases.map(async ([flags, meanwhile, extra, refusal]) => {
        const { log, go, ended } = pointed(flags, meanwhile);
        const refused = await go(extra);
        expect(refused.code).not.toBe(0);
        expect(refused.out).toContain("waiting for comparison.reported past 0");
        expect(refused.err).toContain(refusal);
        expect(await ended()).toBe(false);
        expect(words(log)).toEqual([]);
      }),
    );
  });

  it("refuses a second waiter on one run, which could start again a run the first had stopped", async () => {
    const made = fakeHosts();
    fixtures.push(made.root);
    const folder = join(made.main, ".ana", "d2", "waited");
    mkdirSync(folder, { recursive: true });
    append(join(folder, "log.jsonl"), "campaign.ended", { ending: "environment" });
    const pauseOf = (row: string) =>
      made.runAsync(
        'import { pause } from "REPOSITORY/tools/runs/manage.ts"; await pause(["waited", "--after", "compacted", "--yes"]);',
        { FAKE_PS: row },
      );
    const waiting = `99999 ${capturedExecPath} tools/runs/cli.ts pause waited --after reported --yes`;
    const [refused, flagFirst, contWait] = await Promise.all([
      pauseOf(waiting),
      pauseOf(`99999 ${capturedExecPath} tools/runs/cli.ts pause --after reported waited --yes`),
      pauseOf(`99999 ${capturedExecPath} tools/runs/cli.ts continue waited --after compacted --yes`),
    ]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("already waits to stop in process 99999");
    expect(flagFirst.err).toContain("already waits to stop in process 99999");
    expect(contWait.code).toBe(1);
    expect(readLog(join(folder, "log.jsonl")).map(({ kind }) => kind)).toEqual(["campaign.ended"]);
    for (const row of [
      waiting.replace("waited", "other"),
      `99999 ${capturedExecPath} tools/runs/cli.ts continue waited --login 1 --yes`,
    ]) {
      expect(await pauseOf(row)).toMatchObject({ code: 0, err: "" });
    }
  });
});

describe.concurrent("starting a campaign", () => {
  it("shows the dry run's own refusal, and starts nothing after it", async () => {
    const made = fakeHosts();
    fixtures.push(made.root);
    const nice = join(made.root, "bin", "nice");
    writeFileSync(
      nice,
      `#!${capturedExecPath}\nimport { appendFileSync } from "node:fs";\nappendFileSync(process.env.FAKE_CALLS, JSON.stringify({tool:"nice",args:process.argv.slice(2)}) + "\\n");\n`,
    );
    chmodSync(nice, 0o755);
    const result = await made.runAsync(
      'import { launch } from "REPOSITORY/tools/runs/manage.ts"; await launch(["refused", "--yes"]);',
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain("tools/campaign/harness-builder.ts");
    expect(made.recorded().filter(({ tool, args }) => tool === "nice" && args.includes("19"))).toEqual([]);
  });
});

describe("a pause that reads benchmarks", () => {
  it("reads --eval on the machine it is typed on, before the pause is routed", async () => {
    const child = capturedSpawn([capturedExecPath, "tools/runs/cli.ts", "pause", "--eval"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [said, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(code).toBe(1);
    expect(said).toContain("pause --eval names no run");
  });
});
