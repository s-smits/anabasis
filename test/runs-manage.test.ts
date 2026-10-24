// Going on with a campaign: the flags it runs again on, the login it runs as, and the point a pause
// waits for.
// Launch and continuation dry runs reach the real campaign runtime guard before detaching.
import { afterAll, describe, expect, it } from "bun:test";
import { append, type EventKind, LOG_FILE, type LogEvent } from "../src/kernel/log.ts";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { launch, loginEnv, rerun, restsAfter } from "../tools/runs/manage.ts";
import { campaignRuntime, PROMPT_FLAGS } from "./helpers/campaign-runtime.ts";

const fixtures: ReturnType<typeof campaignRuntime>[] = [];
afterAll(() => {
  for (const made of fixtures) rmSync(made.root, { recursive: true, force: true });
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
    const env = { PATH: "/bin", [key]: "a", [`${key}3`]: "c", [`${key}4`]: "d" };
    // The numbered keys are the verb's to choose from, and no seat's to read.
    expect(loginEnv(env, "4")).toEqual({ PATH: "/bin", [key]: "d", ANA_LOGIN: "4" });
    expect(loginEnv(env, undefined)).toEqual({ PATH: "/bin", [key]: "a" });
    expect(() => loginEnv(env, "2")).toThrow(`${key}2 is not set`);
    // A file of one numbered login runs on it; of two, the verb asks which.
    expect(loginEnv({ PATH: "/bin", [`${key}3`]: "c" }, undefined)).toEqual({
      PATH: "/bin",
      [key]: "c",
      ANA_LOGIN: "3",
    });
    expect(() => loginEnv({ [`${key}3`]: "c", [`${key}4`]: "d" }, undefined)).toThrow(
      "name one with --login N",
    );
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
  it("refuses local launch and continuation at the campaign dry run before any detached campaign starts", () => {
    for (const verb of ["launch", "continueRun"]) {
      const made = campaignRuntime();
      fixtures.push(made);
      made.pin({ packageManager: "bun@0.0.1", engines: { bun: "0.0.1" } });
      const log = join(made.folder, LOG_FILE);
      if (verb === "continueRun") {
        made.seed();
        append(log, "comparison.started", { session: "g-1" });
        writeFileSync(
          join(made.folder, "launch-run-1.json"),
          JSON.stringify({ flags: PROMPT_FLAGS, commit: made.commit, dirty: false }),
        );
      }
      const before = existsSync(made.folder)
        ? readdirSync(made.folder).map((file) => [file, readFileSync(join(made.folder, file), "utf8")])
        : [];
      const result = made.run(
        `
        import { ${verb} } from "CAMPAIGN/tools/runs/manage.ts";
        await ${verb}(${JSON.stringify(["runtime", "--yes", "--", ...PROMPT_FLAGS])});
      `,
        { CLAUDE_CODE_OAUTH_TOKEN: "fixture" },
      );
      expect(result.code).toBe(1);
      expect(result.err).toContain("dry run");
      expect(result.err).toContain("nothing was started");
      const after = existsSync(made.folder)
        ? readdirSync(made.folder).map((file) => [file, readFileSync(join(made.folder, file), "utf8")])
        : [];
      expect(after).toEqual(before);
      expect(made.recorded().filter(({ tool, args }) => tool === "nice" && args.includes("19"))).toEqual([]);
      expect(made.recorded().some(({ tool, args }) => tool === "nice" && args.includes("install"))).toBe(
        true,
      );
    }
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
