// Going on with a campaign: the flags it runs again on, the login it runs as, and the point a pause
// waits for. A launch whose dry run refuses shows the campaign command's own reason.
import { afterAll, describe, expect, it } from "bun:test";
import { type EventKind, LOG_FILE, type LogEvent } from "../src/kernel/log.ts";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { billsLogin, launch, loginEnv, rerun, restsAfter, seatModels } from "../tools/runs/manage.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

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
  it("runs again on the flags its last run kept, less its name and the total the record now holds", () => {
    // A budget word may have set another total since: the old flag would set it back.
    expect(rerun(["--name", "m", "--project", "p", "--budget", "300", "--builder", "b"], undefined)).toEqual([
      "--project",
      "p",
      "--builder",
      "b",
    ]);
    expect(rerun(["--name=m", "--budget=300", "--cap", "5"], "800")).toEqual([
      "--cap",
      "5",
      "--budget",
      "800",
    ]);
  });

  it("runs as the named login alone, and refuses one the environment does not hold", () => {
    const key = "CLAUDE_CODE_OAUTH_TOKEN";
    const [opus, gpt] = [["claude/claude-opus-5-5"], "openai-codex/gpt-6.1-sol"];
    const env = { PATH: "/bin", [key]: "a", [`${key}3`]: "c", [`${key}4`]: "d" };
    // The numbered keys are the verb's to choose from, and no seat's to read.
    expect(loginEnv(env, "4", opus)).toEqual({ PATH: "/bin", [key]: "d", ANA_LOGIN: "4" });
    expect(loginEnv(env, undefined, opus)).toEqual({ PATH: "/bin", [key]: "a" });
    expect(() => loginEnv(env, "2", opus)).toThrow(`${key}2 is not set`);
    // A file of one numbered login runs on it; of two, the verb asks which.
    expect(loginEnv({ PATH: "/bin", [`${key}3`]: "c" }, undefined, opus)).toEqual({
      PATH: "/bin",
      [key]: "c",
      ANA_LOGIN: "3",
    });
    expect(() => loginEnv({ [`${key}3`]: "c", [`${key}4`]: "d" }, undefined, opus)).toThrow(
      "name one with --login N",
    );
    // A run whose seats bill no Claude login starts without one, unless one is named.
    expect(loginEnv({ PATH: "/bin", [`${key}3`]: "c", [`${key}4`]: "d" }, undefined, [gpt])).toEqual({
      PATH: "/bin",
    });
    expect(loginEnv({ [`${key}3`]: "c", [`${key}4`]: "d" }, "4", [gpt])).toEqual({
      [key]: "d",
      ANA_LOGIN: "4",
    });
  });

  it("bills a login only for a run with a claude seat, as its flags or its log name it", () => {
    const gpt = "openai-codex/gpt-6.1-sol";
    expect(billsLogin(seatModels([], ["--builder", gpt, "--solver", gpt, "--budget", "800"]))).toBe(false);
    expect(billsLogin(seatModels([], ["--builder", gpt, "--solver=claude/claude-opus-5-5"]))).toBe(true);
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
    expect(restsAfter(promoted, "harness.promoted", 0)).toBe(true);
    expect(restsAfter(promoted, "harness.promoted", 1)).toBe(false);
    // An old ladder's reading left open is no comparison: no move goes on with it.
    const read = [...promoted, event("comparison.started", { session: "l-1", ladder: true })];
    expect(restsAfter(read, "harness.promoted", 0)).toBe(true);
    expect(
      restsAfter([...read, event("comparison.started", { session: "g-3" })], "harness.promoted", 0),
    ).toBe(false);
    expect(restsAfter([...read, event("exam.started", { session: "x-1" })], "harness.promoted", 0)).toBe(
      false,
    );
    expect(restsAfter([...read, event("draft.started", { session: "d-1" })], "harness.promoted", 0)).toBe(
      false,
    );
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
    expect(result.err).toContain("nothing was started");
    expect(made.recorded().filter(({ tool, args }) => tool === "nice" && args.includes("19"))).toEqual([]);
  });

  it("refuses a name that differs from a held campaign's only by case, which macOS reads as one folder", async () => {
    const name = `hunt-alias-${String(runtimeProcess.pid)}`;
    const folder = join(resolve(import.meta.dir, ".."), ".ana", "d2", name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, LOG_FILE), "");
    try {
      await expect(launch([name.toUpperCase(), "--", "--project", "p"])).rejects.toThrow(
        `names a campaign in ${folder}`,
      );
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
