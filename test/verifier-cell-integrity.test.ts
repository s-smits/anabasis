import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
import { hashJsonBytes } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import { createVerifierLifetime, type VerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import type { ToolRunRequest } from "../src/verify/verifier-port.ts";

const roots: string[] = [];
const lifetimes: VerifierLifetime[] = [];
afterEach(async () => {
  for (const lifetime of lifetimes.splice(0)) expect(await lifetime.close()).toEqual([]);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** These tests exercise the real cell writer and process owner, not OS confinement. OS sandbox
 *  coverage remains in host.test.ts and evaluator-process.test.ts. All canaries are test-owned. */
function fixture(artifact: JsonObject = { first: "A", second: "B" }) {
  const root = mkdtempSync(join(tmpdir(), "ana-cell-integrity-"));
  roots.push(root);
  const cells = join(root, "cells");
  mkdirSync(cells);
  const wait = join(root, "wait-cat");
  writeFileSync(wait, '#!/bin/sh\nwhile [ ! -e release ]; do /bin/sleep 0.01; done\nexec /bin/cat "$1"\n', {
    mode: 0o755,
  });
  const inventory = {
    cat: {
      id: "cat",
      path: "/bin/cat",
      digest: sha256OfFile("/bin/cat"),
      source: "host",
      kind: "binary",
      interpreter: null,
    },
    sh: {
      id: "sh",
      path: "/bin/sh",
      digest: sha256OfFile("/bin/sh"),
      source: "host",
      kind: "binary",
      interpreter: null,
    },
    wait: {
      id: "wait",
      path: wait,
      digest: sha256OfFile(wait),
      source: "host",
      kind: "script",
      interpreter: "sh",
    },
  } as const;
  const lifetime = createVerifierLifetime({ root: join(root, "receipts") });
  lifetimes.push(lifetime);
  const host = createVerifierHost({ baseDir: cells, requireOsSandbox: false, inventory, lifetime });
  const scope = host.openSubject({
    checks: [
      {
        id: "cell-check",
        assertion: "exercise the cell",
        execution: {
          families: "all",
          artifactPaths: ["$"],
          publicInputPaths: [],
          hidden: "none",
          evidence: { kind: "external", requiredToolIds: ["cat", "sh", "wait"] },
        },
      },
    ],
    runId: "cell-review",
    phase: "battery",
    subjectId: "t",
    attempt: 1,
    artifact,
    publicTask: { taskId: "t", family: "f", publicInput: {} },
  });
  const entries = readdirSync(cells);
  const name = entries[0];
  if (entries.length !== 1 || name === undefined) throw new Error("expected exactly one fresh cell");
  return { root, cell: join(cells, name), host, scope };
}

function fileRun(content: string): ToolRunRequest {
  return {
    toolId: "wait",
    checkId: "cell-check",
    args: ["payload.txt"],
    files: { "payload.txt": content },
    timeoutMs: 10_000,
  };
}

describe("one writer and process at a time in a verifier cell", () => {
  it("does not let parallel calls overwrite another invocation's recorded inputs", async () => {
    const fx = fixture();
    try {
      const first = fx.scope.port.run(fileRun("A"));
      const second = fx.scope.port.run(fileRun("B"));
      // Neither reader can consume its file before both requests have arrived. This is a
      // shared release signal: the earlier implementation had already overwritten A with B here.
      writeFileSync(join(fx.cell, "release"), "ready");
      const [a, b] = await Promise.all([first, second]);
      expect([a.executed, b.executed]).toEqual([true, true]);
      expect([a.stdout, b.stdout]).toEqual(["A", "B"]);
      expect(a.evidence.filesDigest).toBe(hashJsonBytes({ "payload.txt": "A" }));
      expect(b.evidence.filesDigest).toBe(hashJsonBytes({ "payload.txt": "B" }));
    } finally {
      await fx.scope.close();
    }
  }, 15_000);

  it("captures request bytes before a queued caller can mutate them", async () => {
    const fx = fixture();
    try {
      const files = { "payload.txt": "A" };
      const args = ["payload.txt"];
      const pending = fx.scope.port.run({ ...fileRun("A"), files, args });
      files["payload.txt"] = "B";
      args[0] = "missing.txt";
      writeFileSync(join(fx.cell, "release"), "ready");
      const result = await pending;
      expect(result.executed).toBe(true);
      expect(result.stdout).toBe("A");
      expect(result.evidence.filesDigest).toBe(hashJsonBytes({ "payload.txt": "A" }));
    } finally {
      await fx.scope.close();
    }
  }, 15_000);

  it("does not poison the queue when an earlier request is rejected", async () => {
    const fx = fixture();
    try {
      const refused = fx.scope.port.run({ toolId: "missing", checkId: "cell-check" });
      const valid = fx.scope.port.run({ toolId: "cat", checkId: "cell-check", stdin: "A" });
      await expect(refused).rejects.toThrow("not in the resolved tool inventory");
      expect((await valid).stdout).toBe("A");
    } finally {
      await fx.scope.close();
    }
  });

  it("closes queued calls without spawning them or losing the pending count", async () => {
    const fx = fixture();
    const pending = fx.scope.port.run({ toolId: "cat", checkId: "cell-check", stdin: "A" });
    const closing = fx.scope.close();
    const result = await pending;
    expect(result.executed).toBe(false);
    expect(result.nonResult?.kind).toBe("sandbox");
    expect(result.evidence.command).toBe("");
    expect((await closing).pendingInvocations).toBe(1);
    expect(fx.host.executedBindings()).toEqual([]);
  });
});

describe("tool-created paths cannot redirect controller writes", () => {
  for (const kind of ["symbolic", "hard"] as const) {
    it(`replaces a final ${kind} link without modifying its outside target`, async () => {
      const fx = fixture();
      const outside = join(fx.root, "outside.txt");
      writeFileSync(outside, "private canary");
      const target = join(fx.cell, "payload.txt");
      if (kind === "symbolic") symlinkSync(outside, target);
      else linkSync(outside, target);
      try {
        const result = await fx.scope.port.run({
          toolId: "cat",
          checkId: "cell-check",
          args: ["payload.txt"],
          files: { "payload.txt": "A" },
        });
        expect(result.executed).toBe(true);
        expect(result.stdout).toBe("A");
        expect(readFileSync(outside, "utf8")).toBe("private canary");
        expect(lstatSync(target).isSymbolicLink()).toBe(false);
      } finally {
        await fx.scope.close();
      }
    });
  }

  it("refuses a linked parent before creating directories outside the cell", async () => {
    const fx = fixture();
    const outside = join(fx.root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(fx.cell, "escape"));
    try {
      await expect(
        fx.scope.port.run({
          toolId: "cat",
          checkId: "cell-check",
          args: ["escape/new/payload.txt"],
          files: { "escape/new/payload.txt": "A" },
        }),
      ).rejects.toThrow("not an ordinary directory");
      expect(existsSync(join(outside, "new"))).toBe(false);
      expect(fx.host.evidence()).toEqual([]);
    } finally {
      await fx.scope.close();
    }
  });

  it("refuses a cell executable link that escapes its own scope", async () => {
    const fx = fixture();
    symlinkSync("/bin/cat", join(fx.cell, "escape"));
    try {
      await expect(
        fx.scope.port.run({ toolId: "cell:escape", checkId: "cell-check", stdin: "A" }),
      ).rejects.toThrow("outside its evaluate scope");
      expect(fx.host.executedBindings()).toEqual([]);
    } finally {
      await fx.scope.close();
    }
  });

  it("retains sequential tool output and permits an internal executable link", async () => {
    const source = '#!/bin/sh\nprintf "%s" A\n';
    const fx = fixture({ source });
    try {
      const built = await fx.scope.port.run({
        toolId: "sh",
        checkId: "cell-check",
        args: ["-c", "cp source.sh program && chmod +x program"],
        files: { "source.sh": source },
      });
      expect(built.executed).toBe(true);
      expect(built.exitCode).toBe(0);
      symlinkSync("program", join(fx.cell, "alias"));
      const result = await fx.scope.port.run({ toolId: "cell:alias", checkId: "cell-check" });
      expect(result.executed).toBe(true);
      expect(result.stdout).toBe("A");
    } finally {
      await fx.scope.close();
    }
  });

  it("keeps a missing cell executable as the existing typed non-result", async () => {
    const fx = fixture();
    try {
      const result = await fx.scope.port.run({ toolId: "cell:missing", checkId: "cell-check" });
      expect(result.executed).toBe(false);
      expect(result.nonResult?.kind).toBe("verifierUnavailable");
    } finally {
      await fx.scope.close();
    }
  });
});

describe("input provenance preserves actual field and file identities", () => {
  it("distinguishes literal punctuation from nested paths and arrays", async () => {
    const fx = fixture({
      a: { b: "nested" },
      "a.b": "dotted",
      x: ["array"],
      "x[0]": "bracket",
      "": "empty",
      repeat: ["same", "same"],
    });
    try {
      for (const [stdin, paths] of [
        ["nested", ["artifact:$.a.b"]],
        ["dotted", ['artifact:$["a.b"]']],
        ["array", ["artifact:$.x[0]"]],
        ["bracket", ['artifact:$["x[0]"]']],
        ["empty", ['artifact:$[""]']],
        ["same", ["artifact:$.repeat[0]", "artifact:$.repeat[1]"]],
      ] as const) {
        const result = await fx.scope.port.run({ toolId: "cat", checkId: "cell-check", stdin });
        expect(result.executed).toBe(true);
        expect(result.evidence.inputPaths).toEqual([...paths]);
      }
    } finally {
      await fx.scope.close();
    }
  });

  it("materialises an own __proto__ file rather than silently dropping it", async () => {
    const fx = fixture();
    const files = Object.fromEntries([["__proto__", "A"]]);
    try {
      const result = await fx.scope.port.run({
        toolId: "cat",
        checkId: "cell-check",
        args: ["__proto__"],
        files,
      });
      expect(result.executed).toBe(true);
      expect(result.stdout).toBe("A");
      expect(result.evidence.filesDigest).toBe(hashJsonBytes(files));
    } finally {
      await fx.scope.close();
    }
  });

  it("refuses multiple input names that collapse to one cell path", async () => {
    const fx = fixture();
    try {
      await expect(
        fx.scope.port.run({
          toolId: "cat",
          checkId: "cell-check",
          args: ["payload.txt"],
          files: { "payload.txt": "A", "./payload.txt": "B" },
        }),
      ).rejects.toThrow("multiple input names resolve");
      expect(existsSync(join(fx.cell, "payload.txt"))).toBe(false);
    } finally {
      await fx.scope.close();
    }
  });
});
