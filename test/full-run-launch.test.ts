// What a paid run is allowed to start as, and who is allowed to start it.
//
// A flag parsed wrongly does not fail the run. It measures a different condition and records it as
// the intended one, which is the exact failure a frozen prediction exists to catch, and it is why
// every refusal here has to arrive before the first paid call rather than at the first battery.
//
// The launch path is three modules and this file takes them one group at a time. `parseFullRunArgs`
// (src/run/launch-arguments.ts) reads the operator's argv into the condition the run is measured
// under. `slugForDirectInput` (src/run/launch-project.ts) derives the project slug, which decides
// which campaign tree the run's evidence joins. And `lockHolderState` (src/run/campaign-lock.ts)
// decides whether another controller already owns that campaign, where "undeterminable" must never
// read as "dead": breaking a live controller's lock puts two controllers on one campaign.

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { lockHolderState, lockToken } from "../src/run/campaign-lock.ts";
import { parseFullRunArgs } from "../src/run/launch-arguments.ts";
import { slugForDirectInput } from "../src/run/launch-project.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";

const MIN = ["--prompt", "Design steel connections", "--provider-turn-budget", "12"];

/** The message a refusal carried, or a failure saying the argv was accepted. */
function refusal(argv: string[]): string {
  try {
    parseFullRunArgs(argv);
  } catch (error) {
    return errorMessage(error);
  }
  throw new Error(`expected "${argv.join(" ")}" to be refused`);
}

/** A lock file holding exactly these bytes, or no file at all. */
function scratch(contents: string | null): string {
  const path = join(mkdtempSync(join(tmpdir(), "ana-launch-")), "lock.json");
  if (contents !== null) writeFileSync(path, contents);
  return path;
}

describe("the condition an operator may ask for", () => {
  it("reads the smallest launch there is", () => {
    const args = parseFullRunArgs(MIN);
    expect(args.prompt).toBe("Design steel connections");
    expect(args.providerTurnBudget).toBe(12);
  });

  it("leaves the command guard on unless the operator turns it off", () => {
    expect(parseFullRunArgs(MIN).dcg).toBe(true);
    expect(parseFullRunArgs([...MIN, "--dcg", "false"]).dcg).toBe(false);
  });

  it("collects every --context path and keeps their order", () => {
    expect(parseFullRunArgs([...MIN, "--context", "a.md", "--context", "b.md"]).contextPaths).toEqual([
      "a.md",
      "b.md",
    ]);
  });

  it("refuses a second copy of a flag that carries one value", () => {
    expect(refusal([...MIN, "--project", "x", "--project", "y"])).toContain("only once");
  });

  it("refuses a prompt that names no domain", () => {
    expect(refusal(["--prompt", "   ", "--provider-turn-budget", "1"])).toContain("--prompt");
  });

  it("refuses a flag with no value rather than reading the next flag as one", () => {
    expect(refusal([...MIN, "--project"])).toContain("missing value");
  });

  it("refuses a count that is zero, negative, fractional, padded or exponential", () => {
    for (const value of ["0", "-1", "1.5", " 2", "2 ", "1e3", "0x2", ""]) {
      expect(refusal(["--prompt", "p", "--provider-turn-budget", value])).toContain("positive integer");
    }
  });

  it("takes `none` for the iteration budget, and nothing else that is not a count", () => {
    expect(parseFullRunArgs([...MIN, "--iteration-budget", "none"]).turnBudget).toBeNull();
    expect(parseFullRunArgs([...MIN, "--iteration-budget", "4"]).turnBudget).toBe(4);
    expect(refusal([...MIN, "--iteration-budget", "all"])).toContain("positive integer");
  });

  it("takes only `fixed` as a product policy, since it is the only one the loop admits", () => {
    expect(parseFullRunArgs([...MIN, "--product-policy", "fixed"]).productPolicy).toBe("fixed");
    expect(refusal([...MIN, "--product-policy", "open"])).toContain("expected fixed");
  });

  it("takes a boolean spelled exactly, not `1` or `yes`", () => {
    for (const value of ["1", "yes", "TRUE", ""]) {
      expect(refusal([...MIN, "--dcg", value])).toContain("true | false");
    }
  });

  it("splits an expected source into its commit and its digest", () => {
    const commit = "a".repeat(40);
    const sourceDigest = "b".repeat(64);
    expect(
      parseFullRunArgs([...MIN, "--expected-source", `${commit}:${sourceDigest}`]).expectedSource,
    ).toEqual({
      commit,
      sourceDigest,
    });
  });

  it("refuses an expected source in any other shape, including an uppercase one", () => {
    // The digest is compared byte for byte against the recorded identity. An uppercase spelling
    // accepted here would mismatch there, at launch, after the composed gate has already run.
    for (const value of [
      "abc",
      `${"a".repeat(40)}:${"b".repeat(63)}`,
      `${"A".repeat(40)}:${"b".repeat(64)}`,
      "a".repeat(40),
    ]) {
      expect(refusal([...MIN, "--expected-source", value])).toContain("--expected-source");
    }
  });

  it("names the replacement when a removed flag is used, not just that it is unknown", () => {
    expect(refusal([...MIN, "--max-turns", "8"])).toContain("--max-builder-turns");
    expect(refusal([...MIN, "--turn-budget", "8"])).toContain("--iteration-budget");
  });

  it("prints the usage line with an unknown flag, so the operator can fix it in one step", () => {
    const message = refusal([...MIN, "--tasks", "25"]);
    expect(message).toContain("unknown flag --tasks");
    expect(message).toContain("--provider-turn-budget");
  });
});

describe("the project a run's evidence joins", () => {
  it("keeps the first four words that say something, in order", () => {
    expect(slugForDirectInput("Design lightweight steel trusses around irregular supports", "d")).toStartWith(
      "design-lightweight-steel-trusses-",
    );
  });

  it("drops the words that would name every project the same", () => {
    expect(slugForDirectInput("Build a harness for the task of welding", "d")).toStartWith("welding-");
  });

  it("falls back to `request` when every word was generic", () => {
    expect(slugForDirectInput("build the task with this agent", "d")).toStartWith("request-");
  });

  it("ends in eight digest characters, so two requests cannot collide on one tree", () => {
    const a = slugForDirectInput("Design steel trusses", "ctx-1");
    const b = slugForDirectInput("Design steel trusses", "ctx-2");
    expect(a).not.toBe(b);
    expect(a.slice(0, -8)).toBe(b.slice(0, -8));
  });

  it("gives one request one slug, so a relaunch names the same campaign", () => {
    expect(slugForDirectInput("Design steel trusses", "ctx")).toBe(
      slugForDirectInput("Design steel trusses", "ctx"),
    );
  });

  it("leaves no dangling separator when the length ceiling cuts on a word boundary", () => {
    // Three fifteen-character words put a separator exactly at the 48-character cut.
    const slug = slugForDirectInput("aaaaaaaaaaaaaaa bbbbbbbbbbbbbbb ccccccccccccccc ddddd", "d");
    expect(slug).not.toContain("--");
  });
});

describe("whether another controller still owns the campaign", () => {
  it("reads the token a lock file carries", () => {
    expect(lockToken(scratch('{"token":"abc"}'))).toBe("abc");
  });

  it("answers null for a lock file that is not there", () => {
    expect(lockToken(scratch(null))).toBeNull();
  });

  it("gives an unreadable lock file the answer its caller asked for", () => {
    // The launcher treats unreadable as no token and refuses; the evidence reader wants a
    // sentinel it can print. One reader, two answers, chosen by the caller.
    const path = scratch("{not json");
    expect(lockToken(path)).toBeNull();
    expect(lockToken(path, "unreadable")).toBe("unreadable");
  });

  it("treats an empty token as no token", () => {
    expect(lockToken(scratch('{"token":""}'))).toBeNull();
  });

  it("calls a missing lock absent", () => {
    expect(lockHolderState(scratch(null))).toBe("absent");
  });

  it("calls a lock this very process holds held", () => {
    expect(lockHolderState(scratch(JSON.stringify({ pid: process.pid, hostname: hostname() })))).toBe("held");
  });

  it("proves a lock dead when its pid is gone", () => {
    // 4194304 is above every default pid ceiling this runs on, so no process can hold it.
    expect(lockHolderState(scratch(JSON.stringify({ pid: 4194304, hostname: hostname() })))).toBe(
      "proved-dead",
    );
  });

  it("proves a lock dead when the pid was reused by a process that started later", () => {
    const record = { pid: process.pid, hostname: hostname(), startTime: "Thu Jan  1 00:00:00 1970" };
    expect(lockHolderState(scratch(JSON.stringify(record)))).toBe("proved-dead");
  });

  it("refuses to call another host's lock dead, whatever its pid says here", () => {
    // The pid means nothing on this machine. Breaking the lock would put two controllers on one
    // campaign, which is the thing the lock exists to prevent.
    const record = { pid: 4194304, hostname: `${hostname()}-elsewhere` };
    expect(lockHolderState(scratch(JSON.stringify(record)))).toBe("held");
  });

  it("calls an unparseable lock unreadable, which is a refusal and not a death", () => {
    expect(lockHolderState(scratch("{not json"))).toBe("unreadable");
  });

  it("calls a lock whose body is not an object unreadable, rather than throwing on it", () => {
    // `null`, `3`, `"held"` and `[]` all parse. Asserting each of them to be a lock record made the
    // first reader throw: `.token` off null, `Number(record.pid)` off null. A throw reaches the
    // caller as a crash instead of as "undeterminable", which is the one rule this file keeps.
    for (const bytes of ["null", "3", '"held"', "[]"]) {
      const path = scratch(bytes);
      expect(lockHolderState(path)).toBe("unreadable");
      expect(lockToken(path)).toBeNull();
      expect(lockToken(path, "unreadable")).toBe("unreadable");
    }
  });

  it("calls a lock with no pid held, since nothing was proved about its holder", () => {
    expect(lockHolderState(scratch('{"token":"abc"}'))).toBe("held");
  });

  it("calls a lock whose pid is not a pid held, rather than reading it as absent", () => {
    for (const pid of [0, -1, 1.5, "abc", null]) {
      expect(lockHolderState(scratch(JSON.stringify({ pid, hostname: hostname() })))).toBe("held");
    }
  });
});
