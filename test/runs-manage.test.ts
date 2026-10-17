// Going on with a campaign: the flags it runs again on, the login it runs as, and the point a pause
// waits for.
import { describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { loginEnv, rerun, restsAfter } from "../tools/runs/manage.ts";

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
