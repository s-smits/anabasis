/**
 * The Builder's file toolkit as a model sees it: the roster `createBuilderTools` returns, and the
 * edit tool's refusal of the flat argument shape before any file is touched. Isolation behaviour
 * itself belongs to builder-tools.test.ts and the candidate-isolation files, which spawn real
 * sandboxed children.
 */
import { describe, expect, it } from "bun:test";
import type { PathRecord } from "../src/builder/candidate-isolation-runtime.ts";
import {
  CANDIDATE_ISOLATION_SCHEMA,
  type CandidateAccessPolicy,
} from "../src/builder/candidate-isolation.ts";
import { type BuilderIsolation, createBuilderTools } from "../src/builder/tools.ts";

// What the cases below read are contract facts — the roster, the options shape, and a refusal that
// lands before any file is touched — so a hand-built policy value is enough and no tool here ever
// reaches an OS child. The `append` deliberately throws: if a case ever did reach the isolation,
// the throw says so rather than letting a silent write pass for a contract check. Isolation
// behaviour itself belongs elsewhere, to candidate-isolation-policy.test.ts against a fixture repo
// and to the darwin and linux files, which spawn real sandboxed children.
function stubIsolation(): BuilderIsolation {
  const policy: CandidateAccessPolicy = {
    schema: CANDIDATE_ISOLATION_SCHEMA,
    repoRoot: "/stub/repo",
    epochDir: "/stub/repo/campaigns/bb3/epoch-1",
    allow: { read: [], write: [], exec: [] },
    measuredNamePrefixes: [],
    network: "deny",
    profile: "candidate",
    scratchWriteRoots: [],
    readDenyRoots: [],
    writeDenyRoots: [],
    cellRuntimeRoots: [],
    digest: "stub-digest",
  };
  const record: PathRecord = {
    path: "/stub/record.jsonl",
    sessionId: "stub",
    append() {
      throw new Error("roster tests never reach the isolation");
    },
    count: () => 0,
  };
  return { policy, record, workDir: "/stub/repo/campaigns/bb3/epoch-1/02-bb3" };
}

describe("the Builder file toolkit", () => {
  it("offers exactly the seven file and command tools", () => {
    const names = createBuilderTools(stubIsolation()).map((t) => t.name);
    expect(names.sort()).toEqual(["bash", "edit", "find", "grep", "ls", "read", "write"]);
  });

  it("requires an edits array and refuses the flat edit arguments before touching a file", async () => {
    const edit = createBuilderTools(stubIsolation()).find((t) => t.name === "edit");
    if (!edit) throw new Error("edit tool not found");
    expect(edit.prepareArguments).toBeUndefined();
    await expect(edit.execute("t", { path: "domains/bb3/a.ts", oldText: "1", newText: "2" })).rejects.toThrow(
      /edits must contain at least one replacement/,
    );
  });
});
