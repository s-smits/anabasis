import { mkdtempSync, readFileSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { double } from "./helpers/doubles.ts";
import { toToolDeclaration } from "@earendil-works/pi-ai";
import type { PathRecord } from "../src/builder/candidate-isolation-runtime.ts";
import type { CandidateAccessPolicy } from "../src/builder/candidate-isolation.ts";
import { writeBuilderSessionEvidence } from "../src/builder/session-evidence.ts";
import { builderShellWall } from "../src/run/builder-backend.ts";

const dirs: string[] = [];
const names = [
  "read",
  "grep",
  "find",
  "ls",
  "edit",
  "write",
  "bash",
  "context",
  "correctness_check",
  "harness_inspect",
  "harness_reset",
  "harness_trial",
  "public_source",
  "verifier_workshop",
  "submit",
];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function input(epochDir: string, roster = names) {
  const policy = double<CandidateAccessPolicy>({ digest: "a".repeat(64), network: "deny" });
  const record = double<PathRecord>({ sessionId: "builder-primary" });
  const tools = roster.map((name) => ({ name, description: `tool ${name}`, parameters: { type: "object" } }));
  // The declarations the provider receives, exactly as the production recorder projects them.
  return {
    epochDir,
    tools,
    policy,
    capabilityPolicies: {},
    record,
    framing: "builder",
    contract: {
      backend: "claude" as const,
      backendExposed: tools.map(toToolDeclaration),
    },
  };
}

describe("the Builder entry gate evidence", () => {
  it("records equality from catalogue through backend exposure and refuses a missing submission path", () => {
    const epochDir = mkdtempSync(join(tmpdir(), "ana-builder-session-"));
    dirs.push(epochDir);
    const evidence = writeBuilderSessionEvidence(input(epochDir));
    expect(evidence.schema).toBe("builder-session-evidence/v4");
    expect(evidence.contract?.catalogued).toEqual(evidence.contract?.backendExposed);
    expect(evidence.contract?.registered).toEqual(evidence.contract?.backendExposed);
    expect(evidence.contract?.registeredSchemaDigest).toBe(evidence.contract?.backendExposedSchemaDigest);
    expect(JSON.parse(readFileSync(join(epochDir, "builder-session.json"), "utf8")).contract.digest).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(() =>
      writeBuilderSessionEvidence(
        input(
          epochDir,
          names.filter((name) => name !== "submit"),
        ),
      ),
    ).toThrow(/Builder entry gate/);
    expect(() =>
      writeBuilderSessionEvidence({
        ...input(epochDir),
        contract: {
          backend: "claude",
          backendExposed: input(epochDir).tools.map((tool) => ({
            ...tool,
            description: tool.name === "submit" ? "changed meaning" : tool.description,
          })),
        },
      }),
    ).toThrow(/descriptions or schemas differ/);
  });

  // The per-backend projection used to drop a tool outside the catalogue without saying so; the
  // entry gate now refuses the session, so an unregistered tool never reaches a provider.
  it("refuses a roster carrying a tool outside the catalogue", () => {
    const epochDir = mkdtempSync(join(tmpdir(), "ana-builder-session-"));
    dirs.push(epochDir);
    expect(() => writeBuilderSessionEvidence(input(epochDir, [...names, "unregistered"]))).toThrow(
      /Builder entry gate: .* registered=[^ ]*,unregistered,/,
    );
  });
});

describe("the Builder shell wall is recorded", () => {
  it("names every walled path with its verb, so a denial can be read against a rule", () => {
    const epochDir = mkdtempSync(join(tmpdir(), "wall-"));
    dirs.push(epochDir);
    const workspace = join(epochDir, "workspace");
    const wall = builderShellWall("claude", workspace, { allow: ["/opt/deps"] });
    expect(wall.execution).toBe("host-tools");
    expect(wall.hostAccess[workspace]).toBe("write");
    expect(Object.values(wall.hostAccess)).toContain("deny");
    expect(wall.readGrant).toEqual(["/opt/deps"]);
    // The digest separates two walls that differ only in the read closure.
    expect(builderShellWall("claude", workspace, { allow: [] }).digest).not.toBe(wall.digest);
    writeBuilderSessionEvidence({ ...input(epochDir), shellWall: wall });
    const written = JSON.parse(readFileSync(join(epochDir, "builder-session.json"), "utf8"));
    expect(written.shellWall).toEqual(wall);
    // A composition probe builds no backend and records no wall rather than an empty one.
    writeBuilderSessionEvidence(input(epochDir));
    expect(
      Object.hasOwn(JSON.parse(readFileSync(join(epochDir, "builder-session.json"), "utf8")), "shellWall"),
    ).toBe(false);
  });
});
