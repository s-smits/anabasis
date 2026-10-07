/**
 * Every simulation script refuses an argument it cannot use with one line naming itself, exit 2,
 * before it opens a model, a campaign or a report.
 *
 * The strict parser behind every script (`.claude/skills/main/cli.ts`) owns unknown options,
 * repeated singletons, missing values and `--name=value`, and `test/meta-cli.test.ts` holds those;
 * `ana/no-hand-read-argv` holds every script to that parser. What stays per script is what each one
 * declares: which options are paths and must be absolute, which are required, and which inputs must
 * exist. One row per declaration.
 */
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.ts";

let scratch = "";
let prompt = "";

beforeAll(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = scratchDir("sps-refusals-", join(REPO_ROOT, ".scratch"));
  prompt = join(scratch, "prompt.txt");
  writeFileSync(prompt, "Build a harness.\n");
  writeFileSync(join(scratch, "contested-object.json"), "{}");
  const brief = join(scratch, "campaigns", "s", "versions", "r", "correctness-model");
  mkdirSync(brief, { recursive: true });
  writeFileSync(join(brief, "brief.json"), "{}");
});
afterAll(cleanupScratch);

const replay = () => ["--repo", scratch, "--slug", "s", "--run", "r"];
/** A slug nothing was recorded under, so staging names the first missing input. */
const settle = () => [
  "--repo",
  scratch,
  "--slug",
  "unrecorded",
  "--run",
  "r",
  "--scratch",
  join(scratch, "sim"),
];

/** [script, argv, the one-line refusal it must print]. */
const ROWS: [string, () => string[], string][] = [
  [
    "condition-evidence",
    () => ["--campaign", "campaigns/demo", "--out", scratch],
    "--campaign must be an absolute path",
  ],
  [
    "condition-evidence",
    () => ["--campaign", scratch, "--out", join(scratch, "evidence"), "--follow", "0"],
    "--follow takes a whole number of seconds, at least 1",
  ],
  ["credential-use", () => ["--root", "checkout"], "--root must be an absolute path"],
  ["difficulty-watch", () => ["--campaign", "campaigns/demo"], "--campaign must be an absolute path"],
  ["difficulty-watch", () => ["--campaign", join(scratch, "nope")], "does not exist"],
  [
    "host-panel",
    () => ["--candidate", "candidate", "--task", "t1", "--panel", prompt, "--out", scratch],
    "--candidate must be an absolute path",
  ],
  ["judge-replay", () => [...replay(), "--task", "t", "--out", "relative"], "--out must be an absolute path"],
  ["judge-replay", () => [...replay(), "--out", scratch], "--task is required"],
  [
    "judge-replay",
    () => [...replay(), "--task", "t", "--out", join(scratch, "out")],
    "brief missing or invalid",
  ],
  ["pick-run", () => ["--notes", "notes/runs"], "--notes must be an absolute path"],
  ["pick-run", () => ["--notes", join(scratch, "absent")], "does not exist"],
  [
    "position-packet",
    () => ["--transcript", "session.jsonl", "--summary-file", prompt],
    "--transcript must be an absolute path",
  ],
  ["predictions", () => ["--file", "predictions.md", "--hash"], "--file must be an absolute path"],
  ["review-settle", () => [...replay(), "--scratch", "relative"], "--scratch must be an absolute path"],
  [
    "review-settle",
    () => [...settle(), "--contested", "contested.json"],
    "--contested must be an absolute path",
  ],
  ["review-settle", () => [...settle(), "--contested", join(scratch, "none.json")], "none.json: missing"],
  [
    "review-settle",
    () => [...settle(), "--contested", join(scratch, "contested-object.json")],
    "contested-object.json: expected a ContestedCase array",
  ],
  // An absent --contested is the ordinary replay, over the recorded Judge's disagreements: it reaches
  // staging instead of being refused as missing.
  ["review-settle", () => settle(), "versions/r: missing"],
  [
    "run-condition",
    () => [
      "--project",
      "p",
      "--run",
      "r",
      "--prompt-file",
      prompt,
      "--expected-tasks",
      "6",
      "--provider-turn-budget",
      "1",
      "--out",
      "relative",
    ],
    "--out must be an absolute path",
  ],
  [
    "run-condition",
    () => [
      "--project",
      "p",
      "--run",
      "r",
      "--prompt-file",
      prompt,
      "--expected-tasks",
      "6",
      "--provider-turn-budget",
      "1",
      "--out",
      join(scratch, "report"),
      "--review",
      "off",
      "--answer-agent",
      "yes",
    ],
    "--answer-agent must be true or false",
  ],
  [
    "run-segment",
    () => ["--step", `builder:${prompt}`, "--effort", "high", "--campaign-dir", "relative"],
    "--campaign-dir must be an absolute path",
  ],
  ["seed-campaign", () => ["--from-root", "source", "--slug", "s"], "--from-root must be an absolute path"],
  [
    "seed-campaign",
    () => ["--from-root", scratch, "--slug", "s"],
    "--into-root (clone) or --as-slug (republish) is required",
  ],
  [
    "seed-campaign",
    () => ["--from-root", scratch, "--slug", "s", "--as-slug", "t", "--tool-tree", join(scratch, "swept")],
    "swept does not exist",
  ],
  [
    "seed-campaign",
    () => ["--from-root", scratch, "--slug", "s", "--into-root", join(scratch, "i"), "--tool-tree", scratch],
    "--tool-tree needs --as-slug",
  ],
  ["seed-kickoff", () => ["--prompt-file", "prompt.txt"], "--prompt-file must be an absolute path"],
  ["show-prompt-surfaces", () => [], "pass --surface system or built"],
  ["tool-tree", () => ["--campaign", "campaigns/demo"], "--campaign must be an absolute path"],
  ["tool-tree", () => ["--campaign", join(scratch, "campaigns", "absent")], "absent does not exist"],
  [
    "tool-tree",
    () => ["--campaign", scratch, "--search", "campaigns"],
    "--search must be an absolute path: campaigns",
  ],
  ["workspace-changes", () => [], "expected 1 positional argument"],
];

describe("simulation script refusals", () => {
  it.each(ROWS.map(([script, argv, message]) => ({ script, argv, message })))(
    "$script refuses: $message",
    ({ script, argv, message }) => {
      const result = runTypeScript(`${script}.mts`, argv());
      expect(result.exitCode).toBe(2);
      expect(result.stderr.trimEnd().split("\n")).toEqual([expect.stringContaining(message)]);
      expect(result.stderr.startsWith(`${script}: `)).toBe(true);
    },
  );
});
