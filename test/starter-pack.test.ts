import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";
import { validateBrief } from "../src/truth/brief-validator.ts";
import { typecheckGeneratedModule } from "../src/truth/generated-module-typecheck.ts";
import { type ControlCorpus, validateControls } from "../src/truth/controls.ts";
import { type BuildTask, validateTasks } from "../src/truth/tasks.ts";
import { validateToolsSpec } from "../src/truth/tools-spec.ts";
import { MATCHING_ACCEPTS, MATCHING_BRIEF, MATCHING_TASKS } from "./helpers/matching-fixture.ts";
import { STARTER_DOC, STARTER_ENTRY, brief, fence, fileMapBrief } from "./helpers/starter-contracts.ts";
import { EVALUATOR_CALIBRATION_POLICY } from "../src/claim/calibration.ts";
import { MAX_GUIDE_BYTES } from "../src/author/candidate-check.ts";
import { PROGRAM_ARGUMENT_MAX_BYTES } from "../src/verify/self-grounding.ts";
import { hashJsonBytes, parseJsonAs } from "../src/meta/json-runtime.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { resolveToolInventory } from "../src/verify/tool-inventory.ts";
import { evaluateCheckProgram } from "../vendor/correctness-model-bundle/evaluate.ts";
import type { CheckFn } from "../src/truth/correctness-model-contract.ts";

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
  it.concurrent("keeps the worked examples and the tool operand rules available on demand", () => {
    expect(STARTER_ENTRY).toContain("starter-pack/examples.md");
    expect(STARTER_DOC).toContain("private scenarios derived from this check's own operands");
    expect(STARTER_DOC).toContain(
      "For external evidence, file contents and stdin must be string leaves or JSON",
    );
  });
  // Rule 4 has a floor and a ceiling. The floor — every check citing a public rule — was met by
  // all four bundles measured on 2026-09-20; in all four the single private ruleDecisions row
  // described the reference's own search order, which no declared check reads, so the public
  // projection was the whole answer and the battery measured transcription. The text states the
  // ceiling beside the floor, which is what lets the reviewer block on it.
  it.concurrent("the private-row rule states its ceiling, not only its floor", () => {
    const flat = STARTER_DOC.replace(/\n\s*/g, " ");
    expect(flat).toContain("A private row may describe search choices, never an unpublished validity rule");
    expect(flat).toContain("at least one decision a passing answer needs stays out of the public projection");
    expect(flat).toContain(
      "the rule rows, the constants, the schema, the operating guide and your tool text",
    );
    expect(flat).toContain("A private row no check reads");
  });
  // Two numbers the Builder is told hold in prose while a refusal decides them in code. Nothing
  // templates a Markdown file, so this is what keeps the copy and its owner from drifting apart.
  it.concurrent("the numbers the starter states are the numbers the refusals use", () => {
    const flat = `${STARTER_ENTRY}\n${STARTER_DOC}`.replace(/\n\s*/g, " ");
    expect(flat).toContain(`it stays under ${MAX_GUIDE_BYTES.toLocaleString("en-US")} bytes`);
    expect(flat).toContain(`none over ${PROGRAM_ARGUMENT_MAX_BYTES} bytes`);
  });

  it.concurrent("STARTER.md teaches one program and one explicit execution declaration", () => {
    expect(STARTER_DOC).toContain('"correctnessContract": "check-program/v1"');
    expect(STARTER_DOC).toContain("A false check never stops the others");
    expect(STARTER_DOC).toContain("correctness-model/reference/index.ts");
    expect(STARTER_DOC).not.toContain("predicate.operation.kind");
    // Wrapped across a line break in the source, so this one reads the flattened text.
    expect(STARTER_DOC.replace(/\n\s*/g, " ")).toContain("Required tools may also resolve on the host PATH");
    expect(STARTER_DOC).not.toContain("Install the real public tool below `.toolchain`");
  });

  it.concurrent("the starter package ships all seven required files, not six plus prose", () => {
    // Run 68's tree scaffolded six placeholders while agent/BUILT_AGENTS.md was taught by prose
    // alone, an asymmetry: candidate-check refuses its absence, so the
    // one file with no green shape to start from was the one the Builder had to invent.
    const starterRoot = join(import.meta.dir, "../starters/pi-built-harness");
    const guide = readFileSync(join(starterRoot, "agent", "BUILT_AGENTS.md"), "utf8");
    expect(guide).toContain("# Operating Guide");
    // candidate-check refuses this marker, so a Builder cannot record the seed unspecialised.
    expect(guide).toContain("<!-- starter-placeholder:replace-before-submit -->");
    expect(guide).toContain("Leave the solving\nmethod to the agent");
    expect(guide).not.toContain("<!-- rule:");
    expect(new TextEncoder().encode(guide).byteLength).toBeLessThan(8_192);
  });

  // The gate map's passing shapes are examples too: the constant row must pass the brief validator
  // (truss run dffb11 wrote `{id, value, unit, authority}` and met shape-mismatch) and the check
  // shape must typecheck against CheckFn with the runtime as its second argument.
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

  it.concurrent("the worked examples keep two domain sketches", () => {
    const sketches = STARTER_DOC.split("\n## Domain shapes\n")[1]?.split("\n## ")[0] ?? "";
    expect(sketches.match(/```text\n/g)?.length).toBe(2);
    expect(sketches).toContain("taskConditioned: true");
    expect(sketches).toContain("numericBoundaries");
  });

  // The guide example is read as the shape of every guide; naming a tool the worked tool list does
  // not declare taught a guide that names undeclared tools (starter audit, 2026-09-09).
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

  /** de8b40's reviewer raised the same defect in four of its five reviews: the verifier built its
   *  load vector from a constant where the brief published the value as a task input. It grades the
   *  present battery correctly and forbids the next one from varying that input, so the demand can
   *  then only move by magnitude — the first of the three changes the ladder says measure the same. */
  it.concurrent("the contract makes the checker read each published input from the task", () => {
    const flat = STARTER_DOC.replace(/\n\s*/g, " ");
    expect(flat).toContain("Read every value your rule names from the task, at the moment the check runs");
    expect(flat).toContain("silently forbids the next one from varying that input");
    expect(flat).toContain(
      "Declaring the path in `publicInputPaths` does not do it; the code that decides has to read it",
    );
  });

  it.concurrent("the tool-interface authoring contract preserves public rules and source execution", () => {
    expect(STARTER_DOC).toContain("Every public requirement the agent must act on stays reachable");
    expect(STARTER_DOC).toContain("Control filenames stay examples; submission accepts any safe relative");
  });

  // The guide is a measured contract, so the contract has to separate the three instruction owners
  // and preserve the protected-data boundary in the operating guide.
  it.concurrent("STARTER.md carries the operating guide contract", () => {
    const flat = STARTER_DOC.replace(/\n\s*/g, " ");
    expect(flat).toContain("`agent/BUILT_AGENTS.md` offers domain guidance");
    // The three instruction owners are separated in the text the Builder reads, not only in code.
    expect(flat).toContain(
      "The system prompt owns the universal rules and `agent/tools-spec.json` owns what each tool does",
    );
    expect(flat).toContain(
      "Reusable algorithms are allowed; task identifiers, copied task text, answers, hidden facts and protected verifier behaviour are not",
    );
    expect(flat).toContain("leaves the solving method to the solver");
  });

  // The fresh-candidate check refuses a corpus under the calibration floor and a brief with no
  // material root; before 2026-09-09 STARTER.md stated neither and its three example schemas
  // would all have been refused (starter audit).
  it.concurrent("STARTER.md states the control floor the fresh-candidate check applies and marks every example material root", () => {
    const { minimumKnownPasses, minimumKnownFailures } = EVALUATOR_CALIBRATION_POLICY;
    expect(STARTER_DOC.replace(/\s+/g, " ")).toContain(
      `at least ${minimumKnownPasses} known-correct and ${minimumKnownFailures} deliberately incorrect rows`,
    );
    for (const example of [workedBrief(), fileMapBrief()]) {
      expect(example.artifactSchema.some((field) => field.taskConditioned === true)).toBe(true);
    }
  });

  it.concurrent("the file-map brief contract passes validateBrief unchanged", () => {
    expect(validateBrief(fileMapBrief())).toEqual({ ok: true, findings: [] });
  });

  it.concurrent("the new brief refuses a legacy deciding field", () => {
    const value = fileMapBrief();
    Object.assign(value.truthChecks[0]!, {
      predicate: { operation: { kind: "equalsHiddenExpectation", artifactPath: "$.files" } },
    });
    expect(validateBrief(value).findings.some((row) => row.code === "unsupported-correctness-contract")).toBe(
      true,
    );
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
    expect(validateTasks(workedBrief(), { tasks }, { authoring: true })).toEqual({
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
  // The seed suite ships inside the candidate interface and runs in generated workspaces via
  // pinned Bun test runner. This is the repo-side proof that the
  // pristine starter starts with 4 passes and 3 declared skips, never a false pass over
  // unauthored placeholder files.
  it.concurrent("run green on the pristine starter under Bun", async () => {
    const starterRoot = join(import.meta.dir, "../starters/pi-built-harness");
    const child = Bun.spawn(
      [
        Bun.argv[0]!,
        "--no-env-file",
        "test",
        "correctness-model/harness.test.ts",
        "correctness-model/evaluator.test.ts",
      ],
      { cwd: starterRoot, env: Bun.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    );
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

  it.concurrent("STARTER.md states the harness test contract", () => {
    const flat = STARTER_DOC.replace(/\n\s*/g, " ");
    expect(STARTER_DOC).toContain("## Harness tests");
    expect(STARTER_DOC).toContain(
      "bun --preserve-symlinks --no-env-file test correctness-model/harness.test.ts correctness-model/evaluator.test.ts",
    );
    expect(flat).toContain("These prove neither process confinement nor installed tool execution");
  });
});

describe("pi starter pack generated modules", () => {
  const scratch = mkdtempSync(join(import.meta.dir, ".ana-scratch-starter-doc-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const slugDir = (() => {
    mkdirSync(join(scratch, "agent"), { recursive: true });
    mkdirSync(join(scratch, "correctness-model/reference"), { recursive: true });
    writeFileSync(join(scratch, "agent/tools.ts"), fence("## Agent tool code contract", "ts"));
    writeFileSync(join(scratch, "correctness-model/evaluator.ts"), fence("## Worked evaluator", "ts"));
    writeFileSync(join(scratch, "correctness-model/reference/index.ts"), fence("## Worked reference", "ts"));
    return scratch;
  })();

  // Both documented modules compile against the real contracts, including the temporary
  // conformance sibling. A documented check that cannot satisfy CheckFn would teach the
  // Builder an export shape that submission refuses.
  it.concurrent("the documented agent toolset typechecks", () => {
    expect(typecheckGeneratedModule(slugDir, "agent")).toEqual([]);
  }, 60_000);

  it.concurrent("the documented Correctness Model evaluator typechecks against the evaluate contract", () => {
    expect(typecheckGeneratedModule(slugDir, "correctness-model")).toEqual([]);
  }, 60_000);

  // Generated modules run under Bun; a reference reading a file the way the starter's own tests
  // do must not be refused as a type error (run 8729bb, `Bun.write` in reference/design.ts).
  it.concurrent("a generated module may use the Bun global that its runtime provides", () => {
    const root = mkdtempSync(join(import.meta.dir, ".ana-scratch-bun-global-"));
    mkdirSync(join(root, "agent"), { recursive: true });
    try {
      writeFileSync(
        join(root, "agent/tools.ts"),
        'export const size: number = Bun.file("x").size;\nexport const bad: string = Bun.file("x").size;\n',
      );
      const findings = typecheckGeneratedModule(root, "agent");
      expect(findings).toHaveLength(1);
      expect(findings[0]?.detail).toContain("agent/tools.ts:2:");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  // Bun 1.4.2 runs ES2025; an ES2023 lib refused these calls as compile errors.
  it.concurrent("a generated module may use the ES2025 library and regex syntax Bun runs", () => {
    const root = mkdtempSync(join(import.meta.dir, ".ana-scratch-es2025-"));
    mkdirSync(join(root, "agent"), { recursive: true });
    try {
      writeFileSync(
        join(root, "agent/tools.ts"),
        [
          "export const joined = new Set([1]).union(new Set([2]));",
          "export const doubled = [1, 2].values().map((x) => x * 2).toArray();",
          "export const tried = Promise.try(() => 1);",
          'export const grouped = Object.groupBy([1, 2], (x) => (x > 1 ? "big" : "small"));',
          "export const halves = new Float16Array(2);",
          'export const folded = /(?i:a)b/.test("Ab") && /(?<y>a)|(?<y>b)/.test("b");',
          "export const bad: string = [1].values().toArray();",
          "",
        ].join("\n"),
      );
      const findings = typecheckGeneratedModule(root, "agent");
      expect(findings).toHaveLength(1);
      expect(findings[0]?.detail).toContain("agent/tools.ts:7:");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

it.concurrent("rechecks an unchanged generated entry when an imported sibling changes", () => {
  const root = mkdtempSync(join(import.meta.dir, ".ana-scratch-contract-cache-"));
  const agent = join(root, "agent");
  mkdirSync(agent, { recursive: true });
  try {
    writeFileSync(
      join(agent, "tools.ts"),
      'import { value } from "./value.ts";\nconst checked: string = value;\nvoid checked;\n',
    );
    const value = join(agent, "value.ts");
    writeFileSync(value, 'export const value = "ok";\n');
    expect(typecheckGeneratedModule(root, "agent")).toEqual([]);
    writeFileSync(value, "export const value = 1;\n");
    expect(typecheckGeneratedModule(root, "agent")).not.toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

it.concurrent("rechecks an unchanged generated entry when an installed dependency changes", () => {
  const root = mkdtempSync(join(import.meta.dir, ".ana-scratch-contract-dependency-cache-"));
  const agent = join(root, "agent");
  const dependency = join(root, "node_modules", "fixture-dependency");
  mkdirSync(agent, { recursive: true });
  mkdirSync(dependency, { recursive: true });
  try {
    writeFileSync(
      join(agent, "tools.ts"),
      'import { value } from "fixture-dependency";\nconst checked: string = value;\nvoid checked;\n',
    );
    writeFileSync(
      join(dependency, "package.json"),
      JSON.stringify({ name: "fixture-dependency", version: "1.0.0", types: "index.d.ts" }),
    );
    const types = join(dependency, "index.d.ts");
    writeFileSync(types, "export declare const value: string;\n");
    expect(typecheckGeneratedModule(root, "agent")).toEqual([]);
    writeFileSync(types, "export declare const value: number;\n");
    expect(typecheckGeneratedModule(root, "agent")).not.toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

it.concurrent("reuses a verdict for identical generated bytes and rechecks when a missing import appears", () => {
  const first = mkdtempSync(join(import.meta.dir, ".ana-scratch-contract-verdict-cache-"));
  const second = mkdtempSync(join(import.meta.dir, ".ana-scratch-contract-verdict-copy-"));
  const tools = 'import { value } from "./value.ts";\nconst checked: string = value;\nvoid checked;\n';
  try {
    mkdirSync(join(first, "agent"), { recursive: true });
    mkdirSync(join(second, "agent"), { recursive: true });
    writeFileSync(join(first, "agent/tools.ts"), tools);
    // The cached verdict for these bytes is a finding; the import appearing must invalidate it.
    expect(typecheckGeneratedModule(first, "agent")).not.toEqual([]);
    writeFileSync(join(first, "agent/value.ts"), 'export const value = "ok";\n');
    expect(typecheckGeneratedModule(first, "agent")).toEqual([]);
    // A byte-identical tree in another directory shares the verdict; a changed sibling does not.
    writeFileSync(join(second, "agent/tools.ts"), tools);
    writeFileSync(join(second, "agent/value.ts"), 'export const value = "ok";\n');
    expect(typecheckGeneratedModule(second, "agent")).toEqual([]);
    writeFileSync(join(second, "agent/value.ts"), "export const value = 1;\n");
    expect(typecheckGeneratedModule(second, "agent")).not.toEqual([]);
    expect(typecheckGeneratedModule(first, "agent")).toEqual([]);
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
}, 60_000);

it.concurrent("reports an absent generated entry as a typed authoring finding", () => {
  const root = mkdtempSync(join(import.meta.dir, ".ana-scratch-contract-missing-root-"));
  try {
    expect(typecheckGeneratedModule(root, "agent")).toEqual([
      expect.objectContaining({
        code: "generated-module-types",
        path: "agent/tools.ts",
        detail: expect.stringContaining("compiler did not load the generated module root"),
      }),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
