import { defineRule } from "@oxlint/plugins";

import { isTestFile } from "../../ana/shared/file-role.ts";
import { resolveVariable } from "../shared/scope.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

const moduleMockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);
const clockMethods = new Set(["setSystemTime", "useFakeTimers"]);
/**
 * The process-wide globals whose members steer the code that reads them. `console` is left out:
 * what a test does to it observes output and hands the code nothing it reads.
 */
const steeringGlobals = new Set(["Bun", "Date", "Math", "crypto", "globalThis", "performance", "process"]);
/**
 * The program's input or output rather than a dependency. Code reads `execPath` through
 * `capturedExecPath`, and a test writes it only to prove the live one is not read
 * (`test/linux-bwrap.test.ts`).
 */
const ownMembers = new Set(["env", "execPath", "exitCode"]);
const frameworkSources = new Map([
  ["vitest", "vi"],
  ["@jest/globals", "jest"],
]);

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

function importOf(sourceCode: SourceCode, identifier: ESTree.IdentifierReference) {
  const variable = resolveVariable(sourceCode, identifier);
  const definition = variable?.defs.find(
    (candidate) => candidate.type === "ImportBinding" && candidate.parent?.type === "ImportDeclaration",
  );
  if (definition?.parent?.type !== "ImportDeclaration") return null;
  return { source: definition.parent.source.value, node: definition.node };
}

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

function isSharedObject(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type !== "Identifier") return false;
  if (importOf(sourceCode, expression) !== null) return true;
  if (!steeringGlobals.has(expression.name)) return false;
  // A global with no declaration here is the ambient one, whichever way the scope manager holds it.
  const variable = resolveVariable(sourceCode, expression);
  return variable === null || variable.defs.length === 0;
}

function literalName(key: ESTree.Node): string | null {
  return key.type === "Literal" ? String(key.value) : null;
}

function memberName(member: ESTree.MemberExpression): string | null {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  return literalName(member.property);
}

function replacesShared(
  sourceCode: SourceCode,
  target: ESTree.Expression | undefined,
  key: string | null,
): boolean {
  return target !== undefined && key !== null && !ownMembers.has(key) && isSharedObject(sourceCode, target);
}

function frameworkMethod(sourceCode: SourceCode, callee: ESTree.Expression): string | null {
  if (callee.type !== "MemberExpression" || !isTestFrameworkObject(sourceCode, callee.object)) return null;
  return memberName(callee);
}

function moduleMockCall(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  if (callee.type !== "MemberExpression") return false;
  if (memberName(callee) === "module" && isBunTest(sourceCode, callee.object, "mock")) return true;
  const method = frameworkMethod(sourceCode, callee);
  return method !== null && moduleMockMethods.has(method);
}

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

function objectMethod(sourceCode: SourceCode, callee: ESTree.Expression): string | null {
  if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return null;
  const declared = resolveVariable(sourceCode, callee.object)?.defs.length ?? 0;
  if (callee.object.name !== "Object" || declared > 0) return null;
  return memberName(callee);
}

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
 * it; this copy reads a `mock` imported from `bun:test` too.
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
