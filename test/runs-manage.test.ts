// Campaign login isolation, clean-point pausing and dry-run refusals.
import { afterAll, describe, expect, it } from "bun:test";
import { append, type EventKind, type LogEvent } from "../src/kernel/log.ts";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn } from "../src/meta/process.ts";
import { loginEnv, restsAfter } from "../tools/runs/manage.ts";
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
    const promoted = [
      event("build.started", { session: "b-1" }),
      event("comparison.started", { session: "g-2" }),
      event("comparison.reported", { session: "g-2", reading: "step" }),
      event("harness.promoted", { harness: "h" }),
    ];
    // The Builder's conversation is open throughout a led campaign, and a pause cuts it: the
    // campaign run again opens a new one on its notes.
    expect(restsAfter(promoted, "promoted", 0)).toBe(true);
    expect(restsAfter(promoted, "promoted", 1)).toBe(false);
    // An old ladder's reading left open is no comparison: no move goes on with it.
    const read = [...promoted, event("comparison.started", { session: "l-1", ladder: true })];
    expect(restsAfter(read, "promoted", 0)).toBe(true);
    for (const open of [
      event("comparison.started", { session: "g-3" }),
      event("exam.started", { session: "x-1" }),
      event("draft.started", { session: "d-1" }),
    ]) {
      expect(restsAfter([...read, open], "promoted", 0)).toBe(false);
    }
  });

  it("pauses at the next finished solve or tool call, whatever is open, and at no other event", () => {
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
        `import { pause } from "REPOSITORY/tools/runs/manage.ts"; await pause(["${name}", "--after", "finished", "--yes"]);`,
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
