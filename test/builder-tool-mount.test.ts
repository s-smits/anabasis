import { afterAll, describe, expect, it } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, toToolDeclaration } from "@earendil-works/pi-ai";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { WORKSPACE_DIR } from "../src/author/builder-memory.ts";
import { BUILDER_WORKSPACE_CARD } from "../src/author/builder-start-prompt.ts";
import { openHostSession } from "../src/backends/pi-session.ts";
import { double } from "./helpers/doubles.ts";
import { mountRepo } from "./helpers/builder-mount-repo.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

/**
 * The tool roster a mounted Builder session actually receives, exercised against temporary files.
 * These cases run the mounted filesystem and workshop tools; they measure no Builder's ability to
 * author a harness, which needs a separately recorded model run.
 *
 * Isolation capability behaviour lives in builder-tools and candidate-isolation. What this file
 * owns is the mount: that the campaign factory reaches the live session roster, with the names the
 * Builder is promised and the evidence wall it is held to.
 */

afterAll(cleanupScratch);

const SCRATCH_ROOT = scratchDir(".ana-scratch-tool-mount-", import.meta.dir);

const MOUNT_NAMES = [
  "bash",
  "edit",
  "find",
  "grep",
  "ls",
  "public_source",
  "read",
  "verifier_workshop",
  "write",
] as const;

describe("the production Builder tool contract", () => {
  // Every transport receives the one roster, so the mount is exercised once rather than per kind.
  it("filesystem tools refuse evidence created after mounting", async () => {
    const { campaignDir, tools } = mountRepo(SCRATCH_ROOT, "late-evidence");
    const workspace = join(campaignDir, WORKSPACE_DIR);
    const run = (name: string, args: Record<string, JsonValue>) => {
      const tool = tools.find((entry) => entry.name === name);
      if (!tool) throw new Error(`missing ${name}`);
      return tool.execute("probe", double<never>(args));
    };
    await run("write", { path: "public.txt", content: "PUBLIC_WORKSPACE" });
    expect(JSON.stringify(await run("read", { path: "public.txt" }))).toContain("PUBLIC_WORKSPACE");
    expect(JSON.stringify(await run("read", { path: join(campaignDir, "builder-session.json") }))).toContain(
      "builder-session-evidence/v4",
    );
    writeFileSync(join(campaignDir, "backends.json"), '{"public":"CONDITION"}');
    expect(JSON.stringify(await run("read", { path: join(campaignDir, "backends.json") }))).toContain(
      "CONDITION",
    );
    const late = [
      join(campaignDir, "late-panel.txt"),
      join(campaignDir, "02-late", "census.json"),
      join(workspace, "census.json"),
    ];
    mkdirSync(join(campaignDir, "02-late"), { recursive: true });
    for (const path of late) {
      writeFileSync(path, "PRIVATE_LATE_EVIDENCE");
      await expect(run("read", { path })).rejects.toThrow();
      const error = await run("bash", { command: `/bin/cat '${path}'` }).catch(String);
      // Seatbelt refuses the open; the Bubblewrap namespace has no such node, or a closed one.
      expect(error).toMatch(/Operation not permitted|No such file or directory|Permission denied/);
      expect(error).not.toContain("PRIVATE_LATE_EVIDENCE");
    }
    // The declarations the provider receives keep every policy-enforced file tool and its schema
    // through pi's JSON round trip, so no mounted tool reaches the model without its contract.
    const exposed = tools.map(toToolDeclaration);
    expect(exposed.map((tool) => tool.name).sort()).toEqual([...MOUNT_NAMES].sort());
    for (const tool of tools) {
      expect(exposed.find((entry) => entry.name === tool.name)?.parameters).toEqual(
        JSON.parse(JSON.stringify(tool.parameters)),
      );
    }
  });

  it.concurrent("mounts the controlled filesystem tools, public source and workshop", async () => {
    const { campaignDir, tools } = mountRepo(SCRATCH_ROOT, "mount");
    expect(tools.map((t) => t.name).sort()).toEqual([...MOUNT_NAMES].sort());
    expect(existsSync(join(campaignDir, WORKSPACE_DIR))).toBe(true);
    // The mount partitions what it composed and leaves the session evidence beside the record.
    const evidence = JSON.parse(readFileSync(join(campaignDir, "builder-session.json"), "utf8"));
    expect(evidence.pathRecordSessionId).toBe("builder-primary");
    expect(evidence.isolated).toEqual({
      read: ["read"],
      grep: ["read"],
      find: ["read"],
      ls: ["read"],
      write: ["write"],
      edit: ["write"],
      bash: ["exec"],
      public_source: ["write"],
      verifier_workshop: ["read", "write", "exec"],
    });
    expect(evidence.research).toEqual([]);
    expect(evidence.schema).toBe("builder-session-evidence/v4");
    expect(evidence.isolations).toHaveLength(3);
    expect(
      evidence.isolations.every((isolation: { policyDigest: string }) =>
        /^[0-9a-f]{64}$/.test(isolation.policyDigest),
      ),
    ).toBe(true);
    expect(evidence.isolations.map((isolation: { network: string }) => isolation.network).sort()).toEqual([
      "allow",
      "deny",
      "deny",
    ]);
    expect(
      evidence.isolations.filter((isolation: { capabilities: string[] }) =>
        isolation.capabilities.includes("verifier_workshop"),
      ),
    ).toHaveLength(2);
    expect(
      evidence.isolations.filter((isolation: { capabilities: string[] }) =>
        isolation.capabilities.includes("public_source"),
      ),
    ).toHaveLength(1);
    expect(evidence.framingDigest).toBe(
      new Bun.CryptoHasher("sha256").update(BUILDER_WORKSPACE_CARD).digest("hex"),
    );
    const workshop = tools.find((tool) => tool.name === "verifier_workshop");
    if (workshop === undefined) throw new Error("missing workshop");
    await workshop.execute(
      "write",
      double<never>({ action: "write", path: "package", content: "public bytes" }),
    );
    const exported = await workshop.execute(
      "export",
      double<never>({ action: "export", path: "package", destination: "packages/package" }),
    );
    const part = exported.content[0];
    if (part?.type !== "text") throw new Error("missing export result");
    const result = JSON.parse(part.text);
    expect(result.status).toBe("completed");
    const action = JSON.parse(
      readFileSync(join(campaignDir, "verifier-workshop.jsonl"), "utf8").trim().split("\n").at(-1)!,
    );
    expect(
      evidence.isolations.some((row: { policyDigest: string }) => row.policyDigest === action.policyDigest),
    ).toBe(true);
    expect(readFileSync(join(campaignDir, WORKSPACE_DIR, ".toolchain/packages/package"), "utf8")).toBe(
      "public bytes",
    );
  });

  // The roster reaches the live host session: a scripted provider response calls the mounted
  // tools by name, and the session runs them in the workspace under the workspace card.
  it.concurrent("runs the mounted roster inside the host session the Builder opens", async () => {
    const { campaignDir, tools } = mountRepo(SCRATCH_ROOT, "mount-session");
    const session = await openHostSession({
      slot: {
        profile: {
          provider: "openrouter",
          transport: "openrouter",
          model: "faux-builder",
          thinkingLevel: "off",
        },
        auth: async () => ({ type: "api_key", key: "fake" }),
      },
      tools,
      systemPrompt: BUILDER_WORKSPACE_CARD,
      cwd: join(campaignDir, WORKSPACE_DIR),
      fakeResponses: [
        fauxAssistantMessage(
          [fauxToolCall("write", { path: "hosted.txt", content: "HOSTED" }, { id: "w" })],
          {
            stopReason: "toolUse",
          },
        ),
        fauxAssistantMessage([fauxToolCall("read", { path: "hosted.txt" }, { id: "r" })], {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage([{ type: "text", text: "done" }], { stopReason: "stop" }),
      ],
    });
    try {
      const result = await session.runTurn({ prompt: "Write and read one file." });
      expect(result.status).toBe("completed");
      expect(result.toolCalls).toMatchObject({ byName: { write: 1, read: 1 }, failed: 0, total: 2 });
      expect(readFileSync(join(campaignDir, WORKSPACE_DIR, "hosted.txt"), "utf8")).toBe("HOSTED");
    } finally {
      await session.dispose();
    }
  });
});
