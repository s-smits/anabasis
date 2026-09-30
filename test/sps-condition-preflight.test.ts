/**
 * The two preflight readings `run-condition.mts` takes of its own process before a live call: the
 * calling session's variables it strips, and the credential file it was started on.
 */
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import type { OptionalEnvValues } from "../src/backends/scrub-env.ts";
import { scrubSessionEnv } from "../.claude/skills/system-path-simulation/scripts/session-env.mts";
import {
  credentialFileOf,
  receiptCredential,
} from "../.claude/skills/system-path-simulation/scripts/credential-use.mts";
import { LAUNCH_RECEIPT_PATH } from "../tools/runs/discover.ts";

afterAll(cleanupScratch);

describe("session env", () => {
  it("strips the calling session's CLAUDE variables and keeps every one the product reads", () => {
    const env = {
      CLAUDECODE: "1",
      CLAUDE_EFFORT: "xhigh",
      CLAUDE_CONFIG_DIR: "/parent/config",
      CLAUDE_CODE_SESSION_ID: "s",
      CLAUDE_CODE_MESSAGING_SOCKET: "/parent/socket",
      CLAUDE_PID: "1",
      CLAUDE_CODE_OAUTH_TOKEN: "kept",
      CLAUDE_COMPACTION: "kept",
      CLAUDE_MODEL: "kept",
      CLAUDE_BUILDER_MODEL: "kept",
      CLAUDE_BUILT_REASONING_EFFORT: "kept",
      CLAUDE_REVIEW_MODEL: "kept",
      PATH: "/usr/bin",
    } satisfies OptionalEnvValues;
    expect(scrubSessionEnv(env)).toEqual([
      "CLAUDECODE",
      "CLAUDE_CODE_MESSAGING_SOCKET",
      "CLAUDE_CODE_SESSION_ID",
      "CLAUDE_CONFIG_DIR",
      "CLAUDE_EFFORT",
      "CLAUDE_PID",
    ]);
    expect(Object.keys(env).sort()).toEqual([
      "CLAUDE_BUILDER_MODEL",
      "CLAUDE_BUILT_REASONING_EFFORT",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_COMPACTION",
      "CLAUDE_MODEL",
      "CLAUDE_REVIEW_MODEL",
      "PATH",
    ]);
  });
});

describe("credential use", () => {
  it("names a launch receipt's credential file by its file name and nothing else", () => {
    const run = scratchDir("sps-credential-");
    expect(receiptCredential(run)).toBeNull();
    mkdirSync(join(run, LAUNCH_RECEIPT_PATH, ".."), { recursive: true });
    writeFileSync(
      join(run, LAUNCH_RECEIPT_PATH),
      JSON.stringify({ credentialSource: "/fake/home/.accounts/claude3.env" }),
    );
    expect(receiptCredential(run)).toBe("claude3.env");
    writeFileSync(join(run, LAUNCH_RECEIPT_PATH), "not json");
    expect(receiptCredential(run)).toBeNull();
  });

  it.each([
    [["--env-file=/home/op/.accounts/claude1.env", "run.mts"], "claude1.env"],
    [["--env-file", "/home/op/.accounts/claude2.env"], "claude2.env"],
    [["--smol"], null],
  ])("reads Bun's --env-file from %o", (execArgv, expected) => {
    expect(credentialFileOf(execArgv)).toBe(expected);
  });
});
