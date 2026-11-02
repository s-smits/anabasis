#!/usr/bin/env bun
/**
 * Whether an Anabasis verifier cell can hold a WorkBuddy Code task, without the dataset or a model:
 * a synthetic task whose public input carries a small repository, an answer that is a unified diff,
 * and a check program that applies the diff and runs the repository's hidden tests, all through
 * the real `openVerifier` path with the network closed. Run it as `bun studies/harness2/domain-fit.ts`
 * on the host whose wall is in question; it exits 1 when a verdict is not the one expected.
 *
 * The check writes the repository into its cell, applies the answer with `git apply` from the tool
 * tree, then writes the hidden tests over whatever the answer put at their paths, so an answer that
 * ships tests of its own is still judged by the hidden ones. Python runs from a virtual environment
 * in the tool tree with pytest installed, because the cell cannot install anything: that is the
 * part a real Code exam would need a field engine for, and nothing installs one for a drafted exam
 * yet (`src/examiner/draft.ts`).
 */
import { type Task, openVerifier } from "#src/kernel/verify.ts";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";

const EVALUATOR = `import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const work = join(process.cwd(), "work");
function lay(files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), text);
  }
}
async function applied(req) {
  lay(req.publicTask.publicInput.repo);
  const run = await req.runtime.tools.run({ toolId: "git", args: ["-C", work, "apply", "-"], stdin: req.artifact.patch });
  lay(req.hidden.tests);
  return run.exitCode === 0;
}
export const checks = {
  applies: (req) => applied(req),
  unittest: async (req) => {
    if (!(await applied(req))) return false;
    const run = await req.runtime.tools.run({ toolId: "python3", args: ["-m", "unittest", "discover", "-s", join(work, "tests"), "-t", work] });
    return run.exitCode === 0;
  },
  pytest: async (req) => {
    if (!(await applied(req))) return false;
    const run = await req.runtime.tools.run({ toolId: "python3", args: ["-m", "pytest", "-q", "-p", "no:cacheprovider", join(work, "tests")] });
    return run.exitCode === 0;
  },
  offline: async (req) => {
    const probe = "import socket\\ntry:\\n socket.create_connection(('pypi.org', 443), timeout=5)\\nexcept OSError:\\n raise SystemExit(0)\\nraise SystemExit(1)";
    return (await req.runtime.tools.run({ toolId: "python3", args: ["-c", probe] })).exitCode === 0;
  },
};
`;

const CHECK = (id: string, tools: [string, ...string[]]) => ({
  id,
  citedDecisionIds: [],
  execution: {
    families: ["code"],
    artifactPaths: ["$.patch"],
    publicInputPaths: ["$.repo"],
    hidden: "whole",
    requiredToolIds: tools,
    evidence: { kind: "authored" },
  },
});

const BRIEF = {
  correctnessContract: "check-program/v1",
  truthChecks: [
    CHECK("applies", ["git"]),
    CHECK("unittest", ["git", "python3"]),
    CHECK("pytest", ["git", "python3"]),
    CHECK("offline", ["python3"]),
  ],
};

const TASK: Task = {
  taskId: "fit-add",
  family: "code",
  publicInput: {
    repo: {
      "README.md": "calc\n",
      "calc/__init__.py": "",
      "calc/ops.py": "def add(a, b):\n    return a - b\n",
      "calc/more/__init__.py": "",
      "calc/more/sub.py": "def sub(a, b):\n    return a - b\n",
    },
  },
  hidden: {
    tests: {
      "tests/__init__.py": "",
      "tests/test_ops.py": [
        "import unittest",
        "from calc.ops import add",
        "from calc.more.sub import sub",
        "class Ops(unittest.TestCase):",
        "    def test_add(self):",
        "        self.assertEqual(add(2, 3), 5)",
        "    def test_sub(self):",
        "        self.assertEqual(sub(5, 3), 2)",
        "",
      ].join("\n"),
    },
  },
};

/** Each answer with the checks it should leave blocking; an empty list is a pass. */
const ANSWERS: ReadonlyArray<{ name: string; patch: string; blocking: readonly string[] }> = [
  {
    name: "fix",
    patch:
      "--- a/calc/ops.py\n+++ b/calc/ops.py\n@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a - b\n+    return a + b\n",
    blocking: [],
  },
  {
    name: "docs only",
    patch: "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-calc\n+calc, fixed\n",
    blocking: ["unittest", "pytest"],
  },
  {
    name: "does not apply",
    patch:
      "--- a/calc/ops.py\n+++ b/calc/ops.py\n@@ -1,2 +1,2 @@\n def add(a, b):\n-    return b - a\n+    return a + b\n",
    blocking: ["applies", "unittest", "pytest"],
  },
  {
    name: "ships its own tests",
    patch: [
      "--- /dev/null",
      "+++ b/tests/test_ops.py",
      "@@ -0,0 +1,3 @@",
      "+import unittest",
      "+class Ops(unittest.TestCase):",
      "+    def test_nothing(self): pass",
      "",
    ].join("\n"),
    blocking: ["unittest", "pytest"],
  },
];

function toolTree(root: string): string {
  const tools = join(root, "tools");
  mkdirSync(join(tools, "bin"), { recursive: true });
  symlinkSync(
    realpathSync(runTextSyncOrThrow(["sh", "-c", "command -v git"]).trim()),
    join(tools, "bin", "git"),
  );
  // A virtual environment's `bin` is on the tool tree's search path (`toolTreeSearchDirs`), so its
  // `python3` is the one a check runs, with pytest beside it; the install happens here, outside the cell.
  runTextSyncOrThrow(["python3", "-m", "venv", join(tools, "venv")]);
  runTextSyncOrThrow([join(tools, "venv", "bin", "python3"), "-m", "pip", "install", "-q", "pytest==8.4.2"]);
  return tools;
}

const root = mkdtempSync(join(tmpdir(), "ana-domain-fit-"));
try {
  mkdirSync(join(root, "checks"));
  writeFileSync(join(root, "checks", "brief.json"), capturedJsonStringify(BRIEF));
  writeFileSync(join(root, "checks", "evaluator.ts"), EVALUATOR);
  const verify = openVerifier({ checks: join(root, "checks"), tools: toolTree(root) });
  let wrong = 0;
  for (const answer of ANSWERS) {
    const started = performance.now();
    const verdict = await verify(TASK, { patch: answer.patch });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const expected =
      answer.blocking.length === 0 ? { kind: "pass" } : { kind: "fail", blocking: answer.blocking };
    const right = capturedJsonStringify(verdict) === capturedJsonStringify(expected);
    if (!right) wrong += 1;
    console.log(
      `${right ? "as expected" : "UNEXPECTED"} ${answer.name}: ${capturedJsonStringify(verdict)} in ${seconds} s`,
    );
  }
  console.log(
    `domain-fit: ${String(ANSWERS.length - wrong)} of ${String(ANSWERS.length)} verdicts as expected`,
  );
  runtimeProcess.exitCode = wrong === 0 ? 0 : 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
