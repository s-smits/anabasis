/**
 * `condition-evidence.mts` keeps every distinct state of a condition's live CLI transcript and its
 * durable Builder records, and never lets a later, shorter state replace an earlier one.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.ts";
import type {
  SessionSummary,
  Snapshot,
} from "../.claude/skills/system-path-simulation/scripts/condition-evidence.mts";

let scratch = "";
let campaign = "";
let tmp = "";
let transcript = "";

const jsonl = (rows: JsonObject[]) => `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

function session(cwd: string): JsonObject[] {
  return [
    { type: "queue-operation", timestamp: "2026-09-30T10:00:00Z" },
    { type: "user", cwd, timestamp: "2026-09-30T10:00:01Z", message: { content: "Build the harness." } },
    {
      type: "assistant",
      cwd,
      timestamp: "2026-09-30T10:01:00Z",
      message: {
        content: [
          { type: "text", text: "The parser drops the last row.\nI will rebuild it before the rehearsal." },
          { type: "tool_use", name: "mcp__custom-tools__harness_trial", input: {} },
        ],
      },
    },
    {
      type: "assistant",
      cwd,
      timestamp: "2026-09-30T10:02:00Z",
      message: { content: [{ type: "tool_use", name: "Bash", input: {} }] },
    },
  ];
}

beforeAll(() => {
  scratch = realpathSync(scratchDir("sps-condition-evidence-"));
  campaign = join(scratch, "campaigns", "sim-a");
  mkdirSync(join(campaign, "epoch-1", "workspace"), { recursive: true });
  writeFileSync(
    join(campaign, "epoch-1", "builder-prose.jsonl"),
    jsonl([{ schema: "builder-prose/v2", kind: "message" }]),
  );
  writeFileSync(
    join(campaign, "seed.json"),
    JSON.stringify({
      mode: "republish",
      fromRoot: "/checkout",
      slug: "uppercase-29",
      selectedProductId: "v7",
    }),
  );
  tmp = join(scratch, "tmp");
  transcript = join(tmp, "ana-claude-cli-AAA", "projects", "-sim-a", "4744d313.jsonl");
  mkdirSync(join(transcript, ".."), { recursive: true });
  writeFileSync(transcript, jsonl(session(join(campaign, "epoch-1", "workspace"))));
  mkdirSync(join(tmp, "ana-claude-cli-AAA", "sessions"), { recursive: true });
  writeFileSync(join(tmp, "ana-claude-cli-AAA", "sessions", "1.key"), "never copied");
  mkdirSync(join(tmp, "ana-claude-cli-BBB", "projects", "-elsewhere"), { recursive: true });
  writeFileSync(
    join(tmp, "ana-claude-cli-BBB", "projects", "-elsewhere", "other.jsonl"),
    jsonl(session("/elsewhere")),
  );
});
afterAll(cleanupScratch);

function collect(out: string, ...extra: string[]) {
  return runTypeScript("condition-evidence.mts", [
    "--campaign",
    campaign,
    "--out",
    out,
    "--tmp",
    tmp,
    ...extra,
  ]);
}

describe("condition-evidence", () => {
  it("keeps the full transcript beside the stub the CLI leaves at close, and summarises the fuller one", () => {
    const out = join(scratch, "evidence");
    const first = collect(out, "--json");
    expect(first.exitCode).toBe(0);
    const taken = parseJsonAs<{ snapshots: Snapshot[] }>(first.stdout).snapshots;
    expect(taken.map((snap) => [snap.session, snap.fresh])).toEqual([
      ["4744d313", true],
      ["epoch-1/builder-prose.jsonl", true],
    ]);

    writeFileSync(transcript, jsonl(session(join(campaign, "epoch-1", "workspace")).slice(0, 2)));
    const second = parseJsonAs<{ snapshots: Snapshot[]; sessions: SessionSummary[] }>(
      collect(out, "--json").stdout,
    );
    expect(second.snapshots.map((snap) => snap.fresh)).toEqual([true, false]);
    const kept = readdirSync(join(out, "transcripts", "ana-claude-cli-AAA")).sort();
    expect(kept).toHaveLength(2);
    expect(kept.every((name) => name.startsWith("4744d313."))).toBe(true);
    expect(second.sessions).toEqual([
      expect.objectContaining({
        session: "4744d313",
        rows: 4,
        assistantTurns: 2,
        tools: { harness_trial: 1, Bash: 1 },
      }),
    ]);
    expect(existsSync(join(out, "transcripts", "ana-claude-cli-BBB"))).toBe(false);
    expect(readFileSync(second.sessions[0]?.file ?? "", "utf8")).toContain("harness_trial");
  });

  it("names the seed source and prints the prose lines that match --grep", () => {
    writeFileSync(transcript, jsonl(session(join(campaign, "epoch-1", "workspace"))));
    const result = collect(join(scratch, "grep"), "--grep", "rebuild");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("seeded     republish from /checkout/campaigns/uppercase-29, product v7");
    expect(result.stdout).toContain(
      "  grep     2026-09-30T10:01:00Z  I will rebuild it before the rehearsal.",
    );
    expect(result.stdout).not.toContain("The parser drops the last row.");
  });
});
