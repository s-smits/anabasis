// The Harness² study's container solve on Claude Code, end to end without a model: `pi-solve.ts`
// runs the real bundled CLI against a local stand-in for the API at the address the benchmark's
// proxy would hold, so what the model is offered and where the CLI puts the route's token are read
// from the requests themselves, on a Claude Code login and on an API key. The stub calls `submit`
// and then answers in text.
import { afterAll, describe, expect, it } from "bun:test";
import { claudeExecutable } from "../src/agent/backends/claude.ts";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import { asRecord, isString } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { runCaptured } from "../src/meta/subprocess.ts";
import { writeStarter } from "../src/harness/starter.ts";
import { RESULT_FILE } from "../studies/shared/pi-solve.ts";
import { anthropicStub } from "./helpers/anthropic-stub.ts";

const SOLVER = join(import.meta.dir, "..", "studies", "shared", "pi-solve.ts");
const ROUTE_TOKEN = "fake-trial::anabasis/claude";
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-pi-solve-claude-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** One solve through `pi-solve.ts` on Claude Code's account `provider` at `url`, in a fresh working
 *  directory. */
async function solveAt(url: string, provider: string, name: string, extra: readonly string[] = []) {
  const dir = join(root, name);
  const harness = join(dir, "harness");
  const logs = join(dir, "logs");
  const work = join(dir, "work");
  writeStarter(harness);
  for (const folder of [logs, work]) mkdirSync(folder, { recursive: true });
  const instruction = join(dir, "instruction.md");
  writeFileSync(instruction, "Write hello.txt and submit.");
  const said = await runCaptured(
    [
      capturedExecPath,
      SOLVER,
      "--harness",
      harness,
      "--instruction",
      instruction,
      "--model",
      "claude-haiku-4-5",
      "--provider",
      provider,
      "--claude",
      claudeExecutable(),
      "--base-url",
      url,
      "--key",
      ROUTE_TOKEN,
      "--effort",
      "low",
      "--model-turns",
      "4",
      "--wall-minutes",
      "5",
      "--prompts",
      "1",
      "--logs",
      logs,
      ...extra,
    ],
    { cwd: work, timeout: 110_000 },
  );
  expect(said.exitCode).toBe(0);
  return asRecord(capturedJsonParse(readFileSync(join(logs, RESULT_FILE), "utf8"))) ?? {};
}

describe("the study's container solve on Claude Code", () => {
  it.each([
    ["claude", "bearer"],
    ["claude-api", "apiKey"],
  ] as const)(
    "on %s, offers the model the harness's tools alone, sends the route's token as its credential and ends submitted",
    async (provider, held) => {
      const stub = anthropicStub([{ tool: "mcp__custom-tools__submit", input: {} }, { text: "Done." }]);
      try {
        const result = await solveAt(stub.url, provider, `solve-${provider}`);
        expect(result).toMatchObject({ ending: "submitted", crash: null, provider });
        const offered = stub.offered().flat();
        // The hostile case: any tool of Claude Code's own, Bash, Read or WebSearch among them, fails here.
        expect(offered.filter((name) => !name.startsWith("mcp__custom-tools__"))).toStrictEqual([]);
        for (const name of ["bash", "read", "edit", "write", "submit"]) {
          expect(offered).toContain(`mcp__custom-tools__${name}`);
        }
        const asked = stub.heard.filter(({ path }) => path === "/v1/messages");
        expect(asked.length).toBeGreaterThan(0);
        // The route's token stands where the account's credential goes, and only there, so the proxy
        // reads it as the route either way (a login's `Authorization: Bearer`, a key's `x-api-key`).
        const other = held === "bearer" ? "apiKey" : "bearer";
        expect(asked.map((request) => [request[held], request[other]])).toStrictEqual(
          asked.map(() => [ROUTE_TOKEN, null]),
        );
        // A login's requests name the OAuth beta, which the proxy passes on beside the login it holds.
        if (held === "bearer") {
          expect(asked.every(({ beta }) => beta?.includes("oauth-") === true)).toBe(true);
        }
      } finally {
        await stub.stop();
      }
    },
    120_000,
  );

  it("asks the CLI its version on a dry run and sends the API nothing", async () => {
    const stub = anthropicStub([{ text: "Done." }]);
    try {
      const result = await solveAt(stub.url, "claude", "dry", ["--dry-run"]);
      expect(result.ending).toBe("dry-run");
      expect(isString(result.claude) && /\d+\.\d+\.\d+/u.test(result.claude)).toBe(true);
      expect(stub.heard).toStrictEqual([]);
    } finally {
      await stub.stop();
    }
  }, 120_000);
});
