import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { describe, expect, it } from "bun:test";
import { validateBrief } from "../src/correctness-bundle/brief-validator.ts";
import { typecheckGeneratedModule } from "../src/correctness-bundle/generated-module-typecheck.ts";
import { type ControlCorpus, validateControls } from "../src/correctness-bundle/controls.ts";
import { type BuildTask, validateTasks } from "../src/correctness-bundle/tasks.ts";
import { validateToolsSpec } from "../src/correctness-bundle/tools-spec.ts";
import { MATCHING_ACCEPTS, MATCHING_BRIEF, MATCHING_TASKS } from "./helpers/matching-fixture.ts";
import { STARTER_DOC, STARTER_ENTRY, brief, fence, fileMapBrief } from "./helpers/starter-contracts.ts";
import { EVALUATOR_CALIBRATION_POLICY } from "../src/claim/calibration.ts";
import { hashJsonBytes, parseJsonAs } from "../src/meta/json-runtime.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { resolveToolInventory } from "../src/verify/tool-inventory.ts";
import { evaluateCheckProgram } from "../vendor/correctness-model-bundle/evaluate.ts";
import type { CheckFn } from "../src/correctness-bundle/correctness-model-contract.ts";

it.skipIf(Bun.which("python3") === null)(
  "the installed-tool example exercises the submitted entrypoint and binds its evidence",
  async () => {
    const dir = mkdtempSync(join(import.meta.dir, ".ana-scratch-starter-entrypoint-"));
    try {
      const entry = join(dir, "evaluate.ts");
      writeFileSync(
        entry,
        `export const checks = { "public-cases-pass": async ({ artifact, publicTask }, runtime) => {
const publicInput = publicTask.publicInput;
${fence("### Installed tools", "ts")}
}};`,
      );
      // SAFETY: this module is the documented body wrapped above; all requests below use its exact fixture shape.
      const { checks } = (await import(entry)) as { checks: Record<string, CheckFn> };
      const deciding = evaluateCheckProgram(fileMapBrief(), (checkId, request, runtime) =>
        checks[checkId]!(
          request,
          runtime === undefined
            ? undefined
            : { tools: { run: (call) => runtime.tools.run({ ...call, checkId }) } },
        ),
      );
      const resolved = resolveToolInventory({ toolIds: ["python3"], toolTree: null });
      expect(resolved.missing).toEqual([]);
      const publicTask = {
        taskId: "sum",
        family: "sequence",
        publicInput: {
          entrypoint: "main.py",
          cases: [
            { stdin: "2 3", stdout: "5\n" },
            { stdin: "7 -2", stdout: "5\n" },
          ],
        },
      };
      for (const [name, source, accepted] of [
        ["helper-used", "from helper import total\nprint(total(input()))\n", true],
        ["equivalent", "print(sum(map(int, input().split())))\n", true],
        ["unused-helper", "import helper\n", false],
        ["broken", "this is invalid python !\n", false],
      ] as const) {
        const artifact = {
          files: { "main.py": source, "helper.py": "def total(text): return sum(map(int, text.split()))\n" },
        };
        const lifetime = createVerifierLifetime({ root: join(dir, "receipts", name) });
        const host = createVerifierHost({ inventory: resolved.inventory, baseDir: dir, lifetime });
        const scope = host.openSubject({
          checks: null,
          runId: "starter-example",
          phase: "discrimination",
          subjectId: name,
          attempt: 1,
          artifact,
          publicTask,
        });
        try {
          const result = await deciding({ artifact, publicTask, hidden: [] }, { tools: scope.port });
          expect(result.ok).toBe(accepted);
          expect(host.evidence()).toHaveLength(2);
          for (const row of host.evidence()) {
            expect(row).toMatchObject({
              artifactDigest: hashJsonBytes(artifact),
              publicTaskDigest: hashJsonBytes(publicTask),
              checkId: "public-cases-pass",
              toolId: "python3",
              outcome: "executed",
              toolDigest: resolved.inventory.python3?.digest,
              filesDigest: hashJsonBytes(artifact.files),
            });
            expect(row.sandbox).not.toBe("workdir+env-allowlist");
          }
        } finally {
          await scope.close();
          await lifetime.close();
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  60_000,
);

/** Each documented contract doubles as this file's fixture, so the authoring contracts and the text
 * the Builder reads cannot drift apart (run 35: the Builder had no green shape to start from and
 * spent its whole turn guessing). test/helpers/starter-contracts.ts owns the fences for every suite. */
const workedBrief = () => brief("## The worked domain");

describe("pi starter pack brief vocabulary", () => {
  // The gate map's passing shapes are examples too: the constant row must pass the brief validator
  // and the check shape must typecheck against CheckFn with the runtime as its second argument.
  it.concurrent("the STARTER.md gate map shapes satisfy their schemas", () => {
    const row = /A constant is\s+`(\{[^`]+\})`/.exec(STARTER_ENTRY)?.[1];
    expect(row).toBeDefined();
    const withConstant = workedBrief();
    withConstant.designRuleConstants.push(parseJsonAs(row ?? ""));
    expect(validateBrief(withConstant)).toEqual({ ok: true, findings: [] });
    const dir = mkdtempSync(join(import.meta.dir, ".ana-scratch-starter-gate-map-"));
    try {
      mkdirSync(join(dir, "correctness-model/reference"), { recursive: true });
      writeFileSync(
        join(dir, "correctness-model/evaluator.ts"),
        /```ts\n([\s\S]*?)```/.exec(STARTER_ENTRY)?.[1] ?? "",
      );
      writeFileSync(join(dir, "correctness-model/reference/index.ts"), fence("## Worked reference", "ts"));
      expect(typecheckGeneratedModule(dir, "correctness-model")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  // The guide example is read as the shape of every guide; naming a tool the worked tool list does
  // not declare teaches a guide that names undeclared tools.
  it.concurrent("the worked guide names only tools the worked tool list declares", () => {
    const spec = parseJsonAs<{ tools: Array<{ name: string }> }>(
      fence("## Agent tool list contract", "json"),
    );
    const declared = new Set(spec.tools.map((tool) => tool.name));
    const guide = STARTER_DOC.split("```markdown\n")[1]?.split("```")[0] ?? "";
    const named = [...guide.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(declared.has(name ?? ""), name).toBe(true);
  });

  // The fresh-candidate check refuses a corpus under the calibration floor, so the text states it.
  it.concurrent("STARTER.md states the control floor the fresh-candidate check applies", () => {
    const { minimumKnownPasses, minimumKnownFailures } = EVALUATOR_CALIBRATION_POLICY;
    expect(STARTER_DOC.replace(/\s+/g, " ")).toContain(
      `at least ${minimumKnownPasses} known-correct and ${minimumKnownFailures} deliberately incorrect rows`,
    );
  });

  it.concurrent("the file-map brief contract passes validateBrief unchanged", () => {
    expect(validateBrief(fileMapBrief())).toEqual({ ok: true, findings: [] });
  });
});

describe("pi starter pack worked domain", () => {
  it.concurrent("the worked brief passes validateBrief unchanged", () => {
    expect(validateBrief(workedBrief())).toEqual({ ok: true, findings: [] });
  });

  // The documented example is the FILE, and correctness-model/tasks.json is the bare array: the candidate check
  // supplies the {tasks: ...} wrapper the validator takes. Documenting the wrapper instead sent the
  // Builder to write a file the check refuses with "expected {"tasks": [...]}" — a refusal that
  // quotes back what the author just wrote. The wrap happens here so the fence stays file-shaped.
  it.concurrent("the documented task battery is the bare array the candidate check reads, and passes validateTasks", () => {
    const tasks = JSON.parse(fence("## Task battery contract", "json"));
    expect(Array.isArray(tasks)).toBe(true);
    // The worked example checks the public relation and needs no stored answer.
    expect(validateTasks(workedBrief(), { tasks })).toEqual({
      ok: true,
      findings: [],
    });
  });

  it.concurrent("the documented control corpus passes validateControls against the documented battery", () => {
    const corpus = parseJsonAs<ControlCorpus>(fence("## Control corpus contract", "json"));
    const tasks = parseJsonAs<
      Array<{
        taskId: string;
        family: string;
        publicInput: unknown;
      }>
    >(fence("## Task battery contract", "json"));
    expect(validateControls(workedBrief(), corpus, tasks)).toEqual({ ok: true, findings: [] });
  });

  it.concurrent("validateControls refuses a control that names a task absent from the recorded battery", () => {
    const tasks = parseJsonAs<BuildTask[]>(fence("## Task battery contract", "json"));
    const corpus: ControlCorpus = {
      accept: [
        {
          id: "accept-canonical",
          artifact: { assignments: [{ staffId: "st-2", shiftId: "sh-1" }] },
          taskId: "t-missing",
        },
      ],
      reject: [
        {
          id: "reject-alias-swap",
          artifact: { assignments: [{ staffId: "st-1", shiftId: "sh-1" }] },
          mutationClass: "alias-swap",
          expectedCheckId: "rules-assigned",
          taskId: tasks[0]?.taskId ?? "t-unset",
        },
      ],
    };
    const result = validateControls(workedBrief(), corpus, tasks);
    expect(result.findings.some((f) => f.code === "controls-unknown-task")).toBe(true);
    expect(result.findings.some((f) => f.path === "accept-canonical")).toBe(true);
  });

  it.concurrent("a hidden-check reject may inherit its task's row or override it", () => {
    const taskBound: ControlCorpus = {
      accept: MATCHING_ACCEPTS,
      reject: [
        {
          id: "reject-task-bound-hidden",
          artifact: { assignments: [{ part: "alpha", slot: "s1" }] },
          mutationClass: "wrong-expectation",
          taskId: "t1",
          expectedCheckId: "parts-assigned",
        },
      ],
    };
    const boundResult = validateControls(MATCHING_BRIEF, taskBound, MATCHING_TASKS);
    expect(boundResult.findings.filter((f) => f.code.startsWith("controls-hidden"))).toEqual([]);

    const forbidden: ControlCorpus = {
      accept: MATCHING_ACCEPTS,
      reject: [
        {
          id: "reject-task-bound-forbidden-hidden",
          artifact: { assignments: [{ part: "alpha", slot: "s1" }] },
          mutationClass: "wrong-expectation",
          taskId: "t1",
          expectedCheckId: "parts-assigned",
          hidden: [{ checkId: "parts-assigned", expectation: { parts: ["alpha"] } }],
        },
      ],
    };
    const forbiddenResult = validateControls(MATCHING_BRIEF, forbidden, MATCHING_TASKS);
    expect(forbiddenResult.findings.filter((f) => f.code.startsWith("controls-hidden"))).toEqual([]);
  });

  it.concurrent("the documented tool list passes validateToolsSpec against the documented brief", () => {
    // Both fences describe one worked domain, so the answer representation is read from the brief
    // rather than restated here: a structured answer, prepared by an artifact-writer.
    const spec = JSON.parse(fence("## Agent tool list contract", "json"));
    expect(validateToolsSpec(spec)).toEqual({
      ok: true,
      findings: [],
    });
  });
});

describe("pi starter pack seed tests", () => {
  const SEED_TESTS = ["correctness-model/harness.test.ts", "correctness-model/evaluator.test.ts"];

  // The seed suite ships inside the candidate interface and runs in generated workspaces under the
  // pinned Bun test runner. This is the repo-side proof that the pristine starter passes, with its
  // declared skips, and never reports a false pass over unauthored placeholder files; the command
  // the contract tells the Builder to run names the same files.
  it.concurrent("run green on the pristine starter under Bun, through the command the contract states", async () => {
    expect(STARTER_DOC).toContain(`--no-env-file test ${SEED_TESTS.join(" ")}`);
    const child = Bun.spawn([Bun.argv[0]!, "--no-env-file", "test", ...SEED_TESTS], {
      cwd: join(import.meta.dir, "../starters/pi-built-harness"),
      env: Bun.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(status).toBe(0);
    const output = `${stdout}${stderr}`;
    expect(output).toContain("4 pass");
    expect(output).toContain("0 fail");
    expect(output).toContain("4 skip");
  }, 60_000);
});

/** A scratch tree holding `files`, removed after `body` reads it. */
function withGenerated<T>(files: Record<string, string>, body: (root: string) => T): T {
  const root = mkdtempSync(join(import.meta.dir, ".ana-scratch-generated-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The locations of the type findings for an `agent` module. */
const typeFindings = (root: string) =>
  typecheckGeneratedModule(root, "agent").map(
    ({ code, detail }) => `${code} ${/agent\/tools\.ts:\d+/.exec(detail)?.[0]}`,
  );

describe("pi starter pack generated modules", () => {
  // Both documented modules compile against the real contracts, including the temporary
  // conformance sibling. A documented check that cannot satisfy CheckFn would teach the
  // Builder an export shape that submission refuses.
  it.concurrent("the documented agent toolset and evaluator typecheck against their contracts", () => {
    withGenerated(
      {
        "agent/tools.ts": fence("## Agent tool code contract", "ts"),
        "correctness-model/evaluator.ts": fence("## Worked evaluator", "ts"),
        "correctness-model/reference/index.ts": fence("## Worked reference", "ts"),
      },
      (root) => {
        expect(typecheckGeneratedModule(root, "agent")).toEqual([]);
        expect(typecheckGeneratedModule(root, "correctness-model")).toEqual([]);
      },
    );
  }, 60_000);

  // Generated modules run under Bun 1.4.2, so the Bun global and the ES2025 library and regex
  // syntax it runs must not be refused as type errors. The last line of each is a real type error,
  // so the case cannot pass on a checker that reports nothing.
  it.concurrent.each([
    ["the Bun global", ['export const size: number = Bun.file("x").size;']],
    [
      "the ES2025 library and regex syntax",
      [
        "export const joined = new Set([1]).union(new Set([2]));",
        "export const doubled = [1, 2].values().map((x) => x * 2).toArray();",
        "export const tried = Promise.try(() => 1);",
        'export const grouped = Object.groupBy([1, 2], (x) => (x > 1 ? "big" : "small"));',
        "export const halves = new Float16Array(2);",
        'export const folded = /(?i:a)b/.test("Ab") && /(?<y>a)|(?<y>b)/.test("b");',
      ],
    ],
  ])(
    "a generated module may use %s",
    (_, lines) => {
      const source = [...lines, "export const bad: string = 1;", ""].join("\n");
      withGenerated({ "agent/tools.ts": source }, (root) => {
        expect(typeFindings(root)).toEqual([`generated-module-types agent/tools.ts:${lines.length + 1}`]);
      });
    },
    60_000,
  );

  it.concurrent("rechecks an unchanged generated entry when an imported sibling changes", () => {
    const tools = 'import { value } from "./value.ts";\nconst checked: string = value;\nvoid checked;\n';
    withGenerated({ "agent/tools.ts": tools, "agent/value.ts": 'export const value = "ok";\n' }, (root) => {
      expect(typeFindings(root)).toEqual([]);
      writeFileSync(join(root, "agent/value.ts"), "export const value = 1;\n");
      expect(typeFindings(root)).toEqual(["generated-module-types agent/tools.ts:2"]);
    });
  }, 60_000);

  it.concurrent("rechecks an unchanged generated entry when an installed dependency changes", () => {
    const types = "node_modules/fixture-dependency/index.d.ts";
    const files = {
      "agent/tools.ts":
        'import { value } from "fixture-dependency";\nconst checked: string = value;\nvoid checked;\n',
      "node_modules/fixture-dependency/package.json": JSON.stringify({
        name: "fixture-dependency",
        version: "1.0.0",
        types: "index.d.ts",
      }),
      [types]: "export declare const value: string;\n",
    };
    withGenerated(files, (root) => {
      expect(typeFindings(root)).toEqual([]);
      writeFileSync(join(root, types), "export declare const value: number;\n");
      expect(typeFindings(root)).toEqual(["generated-module-types agent/tools.ts:2"]);
    });
  }, 60_000);

  it.concurrent("reuses a verdict for identical generated bytes and rechecks when a missing import appears", () => {
    const tools = 'import { value } from "./value.ts";\nconst checked: string = value;\nvoid checked;\n';
    withGenerated({ "first/agent/tools.ts": tools }, (scratch) => {
      const first = join(scratch, "first");
      const second = join(scratch, "second");
      // The cached verdict for these bytes is a finding; the import appearing must invalidate it.
      expect(typeFindings(first)).toEqual(["generated-module-types agent/tools.ts:1"]);
      writeFileSync(join(first, "agent/value.ts"), 'export const value = "ok";\n');
      expect(typeFindings(first)).toEqual([]);
      // A byte-identical tree in another directory shares the verdict; a changed sibling does not.
      mkdirSync(join(second, "agent"), { recursive: true });
      writeFileSync(join(second, "agent/tools.ts"), tools);
      writeFileSync(join(second, "agent/value.ts"), 'export const value = "ok";\n');
      expect(typeFindings(second)).toEqual([]);
      writeFileSync(join(second, "agent/value.ts"), "export const value = 1;\n");
      expect(typeFindings(second)).toEqual(["generated-module-types agent/tools.ts:2"]);
      expect(typeFindings(first)).toEqual([]);
    });
  }, 60_000);

  it.concurrent("reports an absent generated entry as a typed authoring finding", () => {
    withGenerated({}, (root) => {
      expect(typecheckGeneratedModule(root, "agent")).toEqual([
        expect.objectContaining({
          code: "generated-module-types",
          path: "agent/tools.ts",
          detail: expect.stringContaining("compiler did not load the generated module root"),
        }),
      ]);
    });
  });
});
