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
import { EVALUATOR_CALIBRATION_POLICY } from "../src/run/accept-control-independence.ts";
import { hashJsonBytes, parseJsonAs } from "../src/meta/json-runtime.ts";
import { STDOUT_MAX_BYTES, createVerifierHost } from "../src/verify/host.ts";
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

  // Each clause answers a recorded way a battery measured something other than the request, so the
  // text keeps saying it: a symbol check certifying a pin, a check tool printing past the host cap,
  // and a guide naming a path the solver's shell does not have.
  it.concurrent("contract.md binds resource checks to produced values and names the stdout cap", () => {
    const text = STARTER_DOC.replace(/\s+/g, " ");
    expect(text).toContain("decides from the values the answer produces for that resource");
    expect(text).toContain(
      "A symbol or a constant found anywhere in the answer proves the answer mentions the resource, not that it behaves",
    );
    const mebibytes = STDOUT_MAX_BYTES / 2 ** 20;
    expect(Number.isInteger(mebibytes)).toBe(true);
    expect(text).toContain(
      `The host reads at most ${String(mebibytes)} MiB of a check's tool stdout, and a run printing more is a protocol non-result`,
    );
  });

  // A check that fails on its own instrument's silence, one that grades the answer's report of
  // itself, a named target no check runs and a limit no reject crosses each score an answer on
  // something other than the rule it cites.
  it.concurrent("contract.md keeps each check deciding the rule from what its instrument measured", () => {
    const text = STARTER_DOC.replace(/\s+/g, " ");
    expect(text).toContain("A check decides false only from output its instrument produced.");
    expect(text).toContain("a thrown check makes a measured case a non-result, never a fail");
    expect(text).toContain("throw new Error(`domain-solver printed no result");
    expect(text).toContain("observe that behaviour on each one an established public simulator runs");
    expect(text).toContain("A named target nothing can run is an omission");
    expect(text).toContain("enforces no rule of the field: an honest answer and a wrong one pass it alike");
    expect(text).toContain("every limit or clause a check enforces its own reject crossing it");
  });

  // A host double of the board headers failed equivalent sketches, relabelled answers passed loss
  // ids a check never bound to geometry, and rejects differing in several facts proved no check:
  // each makes a placement measure the evaluator rather than the solver.
  it.concurrent("contract.md names what observes each obligation and calibrates checks both ways", () => {
    const text = STARTER_DOC.replace(/\s+/g, " ");
    expect(text).toContain('or "not established" where nothing does');
    expect(text).toContain("so an answer that relabels its entities or cases cannot pass on the labels");
    expect(text).toContain("A reject that differs from its accept in several facts proves nothing");
    expect(text).toContain("Calibrate every check in both directions.");
    expect(text).toContain(
      "An answer the real toolchain builds and runs correctly that the stand-in cannot build is the stand-in's defect.",
    );
  });

  // The Builder reads this whole, whatever the request, so an example drawn from a domain the
  // product was measured on (a truss member, a firmware pin, a board simulator) anchors a new
  // domain's plan to the old one (operator, 2026-09-29, before the chemistry and biology runs).
  // Every file the pack ships is read, since each one is copied into every workspace.
  it.concurrent("the starter pack draws no example from a domain the product was measured on", async () => {
    const root = new URL("../starters/pi-built-harness/", import.meta.url).pathname;
    const paths = [
      "STARTER.md",
      ...new Bun.Glob("starter-pack/**/*").scanSync({ cwd: root, onlyFiles: true }),
    ];
    const named: string[] = [];
    for (const path of paths) {
      const text = await Bun.file(join(root, path)).text();
      if (
        /\b(?:truss\w*|firmware|gpio|arduino|esp32|rp2040\w*|avr8js|load case|microcontroller)\b/i.test(text)
      ) {
        named.push(path);
      }
    }
    expect(named).toEqual([]);
  });

  // A replayed witness is already normal and the solver reaches it, so the worked routes are to a
  // target it does not reliably meet, and a rehearsal is a sample rather than a veto. A claim that
  // one kind of edit buys less than it looks is a theory blind measurement decides, so none is made.
  it.concurrent("examples.md offers routes to a target the solver does not reliably meet", () => {
    const text = STARTER_DOC.replace(/\s+/g, " ");
    expect(text).toContain("## A target the solver does not reliably meet");
    expect(text).toContain("**A search past the solver's wall.**");
    expect(text).toContain("**A planted design.**");
    // Pointing a full pass at each answer's distance from the reference moved limits toward it, which
    // the solver's same method still settled (AGENTS.md "Tried and taken out"), so no route asks it.
    expect(text).not.toContain("**The solver's own answers.**");
    expect(text).not.toContain("so the limit belongs nearer the stored answer");
    expect(text).not.toContain("start the next search from the best solve and keep the better incumbent");
    // Every route above sets where a limit or a stored answer sits. The streaks of 2026-09-29 moved
    // only that, so a route changes what the task asks, from the field.
    expect(text).toContain("**A demand the battery does not yet make.**");
    expect(text).toContain("It fails when the answer that met the old task still meets the new one");
    // A small copy of the work passes in minutes of a two-hour wall, and a Builder-written stand-in
    // for the field's tool makes a pass say nothing, so the full-size work in the real environment is
    // a route of its own, with the changes that only look harder named beside it.
    expect(text).toContain("**The work at the size and in the environment the field works in.**");
    expect(text).toContain("a fail your harness's defect");
    expect(text).toContain("Some changes look harder and are not.");
    // The very-hard aim reaches the Builder as a family's property, never as an aim sentence (prior 10),
    // and the family is built to be the hardest: how hard it is gets measured against the solver, so
    // the passage claims no difficulty of its own. Its budget sentences stay.
    expect(text).not.toContain("aimed at hard lands");
    expect(text).toContain("The last family is built to be the hardest, by a property of its tasks:");
    expect(text).not.toContain("What makes the last family very hard");
    expect(text).toContain("How hard a family is gets measured against the solver, never claimed.");
    expect(text).toContain(
      "the budget sits less than one cheapest shift above the best roster the reference finds, so no rule can be settled on its own",
    );
    // A long search proposes a task and stores its answer; it does not place a limit, which only
    // fresh solver attempts do.
    expect(text).toContain(
      "Use this to propose the next task; fresh solver attempts establish its difficulty.",
    );
    expect(text).not.toContain("The limit then sits between what the long search found");
    // A count of solves reads as a share to author towards (prior 10).
    expect(text).not.toContain("3 of 6 blind solves");
    expect(text).toContain(
      "`harness_trial` estimates how reliably the solver meets a task; it does not veto one.",
    );
    expect(text).not.toContain("Tightening one limit everywhere buys less than it looks");
  });

  // Asking that a decision a passing answer needs stay private asks for an enforced private rule,
  // which the sentence before it forbids; the recipe stays private and the rule never does.
  it.concurrent("contract.md publishes every enforced rule and keeps only the construction private", () => {
    const text = STARTER_DOC.replace(/\s+/g, " ");
    expect(text).not.toContain("stays out of the public projection");
    expect(text).not.toContain("withholds nothing");
    expect(text).toContain("every rule, constant, precedence and tolerance a check enforces is public");
    expect(text).toContain("never a rule a check enforces taken out of the projection");
  });

  it.concurrent("contract.md tells the guide to name programs the solver's shell can run", () => {
    const text = STARTER_DOC.replace(/\s+/g, " ");
    expect(text).toContain(
      "the guide names a program by the name that runs it, never a path into `.toolchain`",
    );
    expect(text).toContain("Give a configured wrapper the tool's own name in `.toolchain/bin`");
    expect(text).toContain("carries no numpy or scipy you can count on");
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
  // STARTER.md tells the Builder to run names the same files, and the contract points at it.
  it.concurrent("run green on the pristine starter under Bun, through the command the starter states", async () => {
    expect(STARTER_ENTRY).toContain(`--no-env-file test ${SEED_TESTS.join(" ")}`);
    expect(STARTER_DOC.replace(/\s+/g, " ")).toContain("run them with the command in STARTER.md");
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
