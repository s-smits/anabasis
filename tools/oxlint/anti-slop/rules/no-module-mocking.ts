import { defineRule } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

const moduleMockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

function isTestFrameworkObject(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
): expression is ESTree.IdentifierReference {
  if (expression.type !== "Identifier") return false;
  if ((expression.name === "vi" || expression.name === "jest") && sourceCode.isGlobalReference(expression)) {
    return true;
  }

  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || variable.defs.length === 0) {
    return expression.name === "vi" || expression.name === "jest";
  }
  return variable.defs.some((definition) => {
    if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
      return false;
    }
    const source = definition.parent.source.value;
    const name = importedName(definition.node);
    return (source === "vitest" && name === "vi") || (source === "@jest/globals" && name === "jest");
  });
}

/** Whether `expression` is `mock` imported from `bun:test`, whose `module` replaces a module. */
function isBunMock(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type !== "Identifier") return false;
  const variable = resolveVariable(sourceCode, expression);
  return (variable?.defs ?? []).some(
    (definition) =>
      definition.type === "ImportBinding" &&
      definition.parent?.type === "ImportDeclaration" &&
      definition.parent.source.value === "bun:test" &&
      importedName(definition.node) === "mock",
  );
}

function moduleMockCall(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  if (!("property" in callee) || !("object" in callee) || !("computed" in callee)) return false;
  const { property } = callee;
  if (!callee.computed && property.type === "Identifier" && property.name === "module") {
    return isBunMock(sourceCode, callee.object);
  }
  if (!isTestFrameworkObject(sourceCode, callee.object)) return false;
  // A plain member names the method with an identifier, `vi.doMock`, and a computed one with a
  // string literal, `vi["doMock"]`. Both are the same name, so the set above decides both; the
  // computed branch used to spell the three names a second time. A non-string literal renders to
  // something the set does not hold, which is the answer that branch wants anyway.
  if (!callee.computed) {
    return property.type === "Identifier" && moduleMockMethods.has(property.name);
  }
  return property.type === "Literal" && moduleMockMethods.has(String(property.value));
}

/**
 * `vi.mock`, `vi.doMock`, `jest.mock` and `unstable_mockModule`: replacing a module at the
 * loader rather than substituting a dependency the code under test accepts. This repository
 * tests with `bun:test`, whose spelling is `mock.module(…)`, and the upstream rule did not read
 * it; this copy reads a `mock` imported from `bun:test` too (20 October).
 *
 * A mocked module is a test that passes against a description of the dependency instead of the
 * dependency. The description is written once and then drifts, so the module can change its
 * signature, its errors or its side effects and the suite keeps reporting green — and it keeps
 * reporting green about a call that no longer exists. It also decides the test can only run one
 * way, because the substitution happens above the code rather than inside it, which is why a
 * mocked suite so often cannot be asked the second question.
 *
 * `isTestFrameworkObject` is what keeps this from being a ban on the word `mock`. The receiver
 * has to be `vi` or `jest` resolving to a global, or an import of `vi` from `vitest` or `jest`
 * from `@jest/globals`; anything else called `mock` on any other object is someone else's method.
 * A binding of either name with no definition in scope is treated as the framework's, since an
 * ambient global is how both are normally reached. Computed access is read alongside plain
 * access, because `vi["doMock"]` names the same method.
 *
 * There is no fix: the repair is a real interface the test can substitute at, which is usually a
 * change to the code under test rather than to the test.
 */
export const noModuleMockingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Vitest and Jest module mocking; tests must replace dependencies through real interfaces.",
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
          before:
            'import { mock } from "bun:test";\nmock.module("#src/meta/os.ts", () => ({ loadavg: () => [0, 0, 0] }));',
          after: "const idle = { load: () => 0, cores: 8 };\nexpect(await waitForHost(idle)).toBe(0);",
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
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (moduleMockCall(context.sourceCode, node.callee)) {
          context.report({ node, messageId: "moduleMock" });
        }
      },
    };
  },
});
