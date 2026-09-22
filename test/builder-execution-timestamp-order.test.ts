import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { latestClosedInvocation } from "../src/run/builder-execution-closure.ts";

const cleanups: string[] = [];

afterEach(() => {
  for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true });
});

function campaign(): string {
  const root = mkdtempSync(join(tmpdir(), "ana-execution-timestamp-order-"));
  cleanups.push(root);
  return root;
}

function opening(root: string, runId: string, writtenAt: string): string {
  const dir = join(root, "controller", runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "opening.json"), JSON.stringify({ writtenAt }));
  return dir;
}

function terminal(root: string, runId: string, writtenAt: string): void {
  writeFileSync(join(opening(root, runId, writtenAt), "terminal.json"), JSON.stringify({ writtenAt }));
}

describe("Builder execution controller timestamp order", () => {
  it("orders parseable timestamps by their instant rather than their spelling", () => {
    const root = campaign();
    terminal(root, "latest", "2026-08-25T01:30:00.000Z");
    // 03:00 at +02:00 is 01:00Z: chronologically older but lexicographically newer.
    terminal(root, "older-offset", "2026-08-25T03:00:00+02:00");
    // The same lexical inversion on an orphan opening must not make the campaign read as live.
    opening(root, "older-open", "2026-08-25T03:00:00+02:00");

    expect(latestClosedInvocation(root)).toEqual({
      runId: "latest",
      closedAt: "2026-08-25T01:30:00.000Z",
    });
  });
});
