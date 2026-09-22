import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

let scratch;
let transcript;
let summary;

function row(type, content, timestamp) {
  return JSON.stringify({ type, timestamp, message: { role: type, content } });
}

beforeEach(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = mkdtempSync(join(REPO_ROOT, ".scratch", "position-packet-test-"));
  transcript = join(scratch, "session.jsonl");
  summary = join(scratch, "summary.md");
  const lines = [
    JSON.stringify({ type: "ai-title", title: "ignored" }),
    row("user", "Build a harness.", "2026-08-23T14:26:00.000Z"),
  ];
  for (let index = 1; index <= 7; index += 1) {
    lines.push(
      row(
        "assistant",
        [{ type: "tool_use", name: "Read", input: { path: `f${index}.ts` } }],
        `2026-08-23T14:27:0${index}.000Z`,
      ),
    );
    lines.push(
      row(
        "user",
        [{ type: "tool_result", content: `contents of f${index}.ts ${"x".repeat(300)}` }],
        `2026-08-23T14:27:0${index}.500Z`,
      ),
    );
  }
  lines.push(
    row(
      "assistant",
      [
        { type: "text", text: "Submitting." },
        { type: "tool_use", name: "mcp__harness__submit", input: {} },
      ],
      "2026-08-23T14:28:00.000Z",
    ),
  );
  lines.push(
    row(
      "user",
      [{ type: "tool_result", content: [{ type: "text", text: "refused: verifier-required" }] }],
      "2026-08-23T14:28:05.000Z",
    ),
  );
  lines.push(row("user", "One steering line.", "2026-08-23T14:28:05.100Z"));
  writeFileSync(transcript, `${lines.join("\n")}\n`);
  writeFileSync(summary, "The Builder read seven files and submitted once.\n");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("position-packet", () => {
  it("renders the last exchanges with marked truncation under a labelled summary and names the source bytes", () => {
    const result = runTypeScript("position-packet.mts", [
      "--transcript",
      transcript,
      "--summary-file",
      summary,
      "--exchanges",
      "3",
      "--result-chars",
      "100",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("## Summary (authored by the steward, not transcript bytes)");
    expect(result.stdout).toContain("## Last 3 of 8 exchanges (copied from the transcript)");
    expect(result.stdout).toContain("### Exchange 6 — 2026-08-23T14:27:06.000Z");
    expect(result.stdout).not.toContain("### Exchange 5 ");
    expect(result.stdout).toContain('tool Read {"path":"f7.ts"}');
    expect(result.stdout).toContain("[cut: 218 more characters]");
    expect(result.stdout).toContain("tool mcp__harness__submit {}");
    expect(result.stdout).toContain('result [{"type":"text","text":"refused: verifier-required"}]');
    expect(result.stdout).toContain("One steering line.");
    expect(result.stdout).toMatch(/Derived from .*session\.jsonl \(sha256 [0-9a-f]{64}\), exchanges 6–8\./);
  });

  it("defaults to five exchanges and refuses more", () => {
    const five = runTypeScript("position-packet.mts", [
      "--transcript",
      transcript,
      "--summary-file",
      summary,
    ]);
    expect(five.stdout).toContain("## Last 5 of 8 exchanges");
    const ten = runTypeScript("position-packet.mts", [
      "--transcript",
      transcript,
      "--summary-file",
      summary,
      "--exchanges",
      "10",
    ]);
    expect(ten.exitCode).toBe(2);
    expect(ten.stderr).toContain("1 to 5");
  });

  it("refuses a relative path, an empty summary and a Codex rollout", () => {
    expect(
      runTypeScript("position-packet.mts", ["--transcript", "session.jsonl", "--summary-file", summary])
        .stderr,
    ).toContain("absolute");
    writeFileSync(summary, "\n");
    expect(
      runTypeScript("position-packet.mts", ["--transcript", transcript, "--summary-file", summary]).stderr,
    ).toContain("empty");
    writeFileSync(summary, "ok\n");
    writeFileSync(
      transcript,
      '{"timestamp":"2026-08-23T14:26:00.000Z","type":"session_meta","payload":{}}\n{"timestamp":"2026-08-23T14:26:01.000Z","type":"response_item","payload":{}}\n',
    );
    expect(
      runTypeScript("position-packet.mts", ["--transcript", transcript, "--summary-file", summary]).stderr,
    ).toContain("Codex rollout");
  });
});
