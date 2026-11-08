import { defineRule } from "@oxlint/plugins";

import { isTestFile } from "../../ana/shared/file-role.ts";
import { resolveVariable } from "../shared/scope.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

const moduleMockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);
/** The framework methods that replace the process's clock for every caller at once. */
const clockMethods = new Set(["setSystemTime", "useFakeTimers"]);
/**
 * The process-wide globals whose members steer the code that reads them: the clock, chance, the
 * network, the spawner and the process. `console` is left out because what a test does to it
 * observes output and hands the code nothing it reads.
 */
const steeringGlobals = new Set(["Bun", "Date", "Math", "crypto", "globalThis", "performance", "process"]);
/**
 * The members that are the program's input or output rather than a dependency: `env`, the
 * process's `exitCode`, and `execPath`, which code reads through `capturedExecPath` and a test
 * writes only to prove that the live one is not read (`test/linux-bwrap.test.ts`).
 */
const ownMembers = new Set(["env", "execPath", "exitCode"]);
/** The frameworks whose `vi` or `jest` object these methods belong to, by the name each exports. */
const frameworkSources = new Map([
  ["vitest", "vi"],
  ["@jest/globals", "jest"],
]);

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

/** The import binding `identifier` resolves to, or null where it is not one. */
function importOf(sourceCode: SourceCode, identifier: ESTree.IdentifierReference) {
  const variable = resolveVariable(sourceCode, identifier);
  const definition = variable?.defs.find(
    (candidate) => candidate.type === "ImportBinding" && candidate.parent?.type === "ImportDeclaration",
  );
  if (definition?.parent?.type !== "ImportDeclaration") return null;
  return { source: definition.parent.source.value, node: definition.node };
}

/** Whether `expression` is `name` imported from `bun:test`. */
function isBunTest(sourceCode: SourceCode, expression: ESTree.Expression, name: string): boolean {
  if (expression.type !== "Identifier") return false;
  const binding = importOf(sourceCode, expression);
  return binding?.source === "bun:test" && importedName(binding.node) === name;
}

function isTestFrameworkObject(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
): expression is ESTree.IdentifierReference {
  if (expression.type !== "Identifier") return false;
  const named = expression.name === "vi" || expression.name === "jest";
  if (named && sourceCode.isGlobalReference(expression)) return true;
  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || variable.defs.length === 0) return named;
  const binding = importOf(sourceCode, expression);
  if (binding === null) return false;
  const name = importedName(binding.node);
  // `bun:test` exports both objects under their own names, as each framework exports its one.
  return (
    frameworkSources.get(binding.source) === name ||
    (binding.source === "bun:test" && (name === "vi" || name === "jest"))
  );
}

/** Whether `expression` names what every importer shares: any import binding, or one of
 *  `steeringGlobals` reached as the global. */
function isSharedObject(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type !== "Identifier") return false;
  if (importOf(sourceCode, expression) !== null) return true;
  if (!steeringGlobals.has(expression.name)) return false;
  // A global with no declaration here is the ambient one, whichever way the scope manager holds it.
  const variable = resolveVariable(sourceCode, expression);
  return variable === null || variable.defs.length === 0;
}

/** The name a string literal spells, or null; a non-string literal renders to a name no set holds. */
function literalName(key: ESTree.Node): string | null {
  return key.type === "Literal" ? String(key.value) : null;
}

/** The member a member expression names with an identifier, `vi.mock`, or a literal, `vi["mock"]`. */
function memberName(member: ESTree.MemberExpression): string | null {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  return literalName(member.property);
}

/** Whether `target` and `key` name a member of a module or steering global that is a dependency. */
function replacesShared(
  sourceCode: SourceCode,
  target: ESTree.Expression | undefined,
  key: string | null,
): boolean {
  return target !== undefined && key !== null && !ownMembers.has(key) && isSharedObject(sourceCode, target);
}

/** The method a member callee names on a test framework object, or null. */
function frameworkMethod(sourceCode: SourceCode, callee: ESTree.Expression): string | null {
  if (callee.type !== "MemberExpression" || !isTestFrameworkObject(sourceCode, callee.object)) return null;
  return memberName(callee);
}

function moduleMockCall(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  if (callee.type !== "MemberExpression") return false;
  if (memberName(callee) === "module" && isBunTest(sourceCode, callee.object, "mock")) return true;
  // A plain member names the method with an identifier, `vi.doMock`, and a computed one with a
  // string literal, `vi["doMock"]`; both are the same name, so the set decides both.
  const method = frameworkMethod(sourceCode, callee);
  return method !== null && moduleMockMethods.has(method);
}

/** `setSystemTime(date)` from `bun:test`, or `vi.useFakeTimers()` and its kin: a faked clock. */
function clockCall(sourceCode: SourceCode, node: ESTree.CallExpression): boolean {
  const { callee } = node;
  if (callee.type === "Identifier") {
    return node.arguments.length > 0 && isBunTest(sourceCode, callee, "setSystemTime");
  }
  if (callee.type !== "MemberExpression") return false;
  const method = frameworkMethod(sourceCode, callee);
  if (method === null || !clockMethods.has(method)) return false;
  return method === "useFakeTimers" || node.arguments.length > 0;
}

/** The method `callee` names on the global `Object`, or null. */
function objectMethod(sourceCode: SourceCode, callee: ESTree.Expression): string | null {
  if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return null;
  const declared = resolveVariable(sourceCode, callee.object)?.defs.length ?? 0;
  if (callee.object.name !== "Object" || declared > 0) return null;
  return memberName(callee);
}

/** `spyOn(target, "member")` or `vi.spyOn(…)`, anywhere, and in a test `Object.defineProperty(target,
 *  "member", …)` or `Object.assign(target, …)`, over a member of what every importer shares. */
function memberReplacementCall(
  sourceCode: SourceCode,
  node: ESTree.CallExpression,
  filename: string,
): boolean {
  const test = isTestFile(filename);
  const [target, key] = node.arguments;
  if (target === undefined || target.type === "SpreadElement") return false;
  const { callee } = node;
  const method = objectMethod(sourceCode, callee);
  if (test && method === "assign") return isSharedObject(sourceCode, target);
  if (key === undefined) return false;
  const spies =
    (callee.type === "Identifier" && isBunTest(sourceCode, callee, "spyOn")) ||
    (callee.type === "MemberExpression" && frameworkMethod(sourceCode, callee) === "spyOn");
  return (
    (spies || (test && method === "defineProperty")) && replacesShared(sourceCode, target, literalName(key))
  );
}

/**
 * `vi.mock`, `vi.doMock`, `jest.mock` and `unstable_mockModule`: replacing a module at the
 * loader rather than substituting a dependency the code under test accepts. This repository
 * tests with `bun:test`, whose spelling is `mock.module(…)`, and the upstream rule did not read
 * it; this copy reads a `mock` imported from `bun:test` too (20 October).
 *
 * This copy also reads the other ways of replacing what every caller shares (8 November): `spyOn`
 * over a member of any import or of a steering global (`spyOn(prepare, "prepareCommand")`,
 * `spyOn(Date, "now")`); in a test, an assignment, `Object.defineProperty` or `Object.assign`
 * over one (`fs.readFileSync = …`, `globalThis.fetch = …`); and a faked clock
 * (`setSystemTime(date)`, `vi.useFakeTimers()`). Each swaps the dependency above the code rather
 * than handing it in, so the repair is the same. Writes count only in a test, since production
 * writing an imported object's member, `runtimeProcess.exitCode` among them, is no substitution.
 * Narrowed out, each the honest interface rather than a seam: `env`, which is input; `exitCode`,
 * which is output; `execPath`, written only by the test that proves the wall reads the captured one;
 * `console`, which a test only observes; and `setSystemTime()` and `useRealTimers()`, which give
 * the clock back. A saved-and-restored global needs no shape of its own: the write is the finding.
 *
 * A mocked module is a test that passes against a description of the dependency instead of the
 * dependency. The description is written once and then drifts, so the module can change its
 * signature, its errors or its side effects and the suite keeps reporting green — and it keeps
 * reporting green about a call that no longer exists. It also decides the test can only run one
 * way, because the substitution happens above the code rather than inside it, which is why a
 * mocked suite so often cannot be asked the second question.
 *
 * `isTestFrameworkObject` is what keeps this from being a ban on the word `mock`. The receiver
 * has to be `vi` or `jest` resolving to a global, or an import of `vi` from `vitest`, `jest`
 * from `@jest/globals` or either from `bun:test`; anything else called `mock` on any other object
 * is someone else's method. A binding of either name with no definition in scope is treated as the
 * framework's, since an ambient global is how both are normally reached. Computed access is read
 * alongside plain access, because `vi["doMock"]` names the same method.
 *
 * There is no fix: the repair is a real interface the test can substitute at, which is usually a
 * change to the code under test rather than to the test.
 */
export const noModuleMockingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow module mocking and replacing a module's or a shared global's members; tests must replace dependencies through real interfaces.",
      examples: [
        {
          path: "test/round.test.ts",
          before:
            'import { mock } from "bun:test";\nmock.module("#src/kernel/log.ts", () => ({ append: () => undefined }));',
          after:
            "const events: LogEvent[] = [];\nawait runRound(task, { append: (event: LogEvent) => events.push(event) });",
        },
        {
          path: "test/host.test.ts",
          before: 'import { spyOn } from "bun:test";\nspyOn(Date, "now").mockImplementation(() => 0);',
          after:
            "const idle = { load: () => 0, cores: 8, now: () => 0 };\nexpect(await waitForHost(idle)).toBe(0);",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      moduleMock:
        "Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.",
    },
  },
  createOnce(context) {
    return {
      AssignmentExpression(node) {
        const { left } = node;
        if (left.type !== "MemberExpression" || !isTestFile(context.filename)) return;
        if (replacesShared(context.sourceCode, left.object, memberName(left))) {
          context.report({ node, messageId: "moduleMock" });
        }
      },
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        const { sourceCode } = context;
        if (
          moduleMockCall(sourceCode, node.callee) ||
          clockCall(sourceCode, node) ||
          memberReplacementCall(sourceCode, node, context.filename)
        ) {
          context.report({ node, messageId: "moduleMock" });
        }
      },
    };
  },
});
