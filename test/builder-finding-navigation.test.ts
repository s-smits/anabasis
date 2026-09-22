import { controllerValidatedFinding } from "../src/truth/brief.ts";
import { afterEach, expect, it } from "bun:test";
import { BuilderAuthorFeedback } from "../src/builder/author-feedback.ts";
import { createHarnessInspectTool } from "../src/builder/harness-inspect.ts";
import { mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { writeMatchingBuildFixture } from "./helpers/matching-fixture.ts";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("follows readiness's two finding routes and refuses selectors that an action cannot read", async () => {
  const dir = mkdtempSync(join(runtimeProcess.cwd(), ".ana-scratch-finding-navigation-"));
  scratch.push(dir);
  writeMatchingBuildFixture(dir);
  writeFileSync(join(dir, "correctness-model/tasks.json"), "{}");
  writeFileSync(join(dir, "agent/tools.ts"), "export const tools: string[] = [1];\n");
  const feedback = new BuilderAuthorFeedback();
  const tool = createHarnessInspectTool({ workspace: dir, context: { slug: "matching" }, feedback });
  const call = async (args: Parameters<typeof tool.execute>[1]) => {
    const result = await tool.execute("navigation", args);
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("missing inspection text");
    return block.text;
  };
  interface Overview {
    navigation: string;
    groups: Array<{ group: number }>;
  }
  const ready = parseJsonAs<{ validationFindings: Overview; moduleFindings: Overview }>(
    await call({ action: "readiness" }),
  );
  for (const [overview, action, expected] of [
    [ready.validationFindings, "summary", "the array is the whole file"],
    [ready.moduleFindings, "typecheck", "TS2322"],
  ] as const) {
    // Follow the actual returned navigation, rather than copying a route into the test call.
    const route = parseJsonAs<{ action: "summary" | "typecheck" }>(
      overview.navigation.match(/\{[^}]+\}/)?.[0] ?? "{}",
    );
    expect(route.action).toBe(action);
    const group = overview.groups[0]?.group;
    if (group === undefined) throw new Error("missing finding group");
    const page = parseJsonAs<{ findings: { text: string } }>(
      await call({ ...route, group, field: "detail" }),
    );
    expect(page.findings.text).toContain(expected);
  }
  for (const action of ["readiness", "inventory", "tools", "task"] as const) {
    expect(parseJsonAs(await call({ action, group: 1, field: "detail" }))).toMatchObject({
      status: "blocked",
      nextAction: expect.stringContaining("summary for validationFindings"),
    });
  }
  // Check/submit feedback is a stored result, never a redirect to today's workspace findings.
  feedback.recordCheck("gates", [
    controllerValidatedFinding({ code: "test-finding", path: "agent", detail: "stored public finding" }),
  ]);
  const stored = parseJsonAs<Overview>(await call({ action: "feedback" }));
  const route = parseJsonAs<{ action: "feedback" }>(stored.navigation.match(/\{[^}]+\}/)?.[0] ?? "{}");
  expect(route.action).toBe("feedback");
  expect(parseJsonAs(await call({ ...route, group: 1 }))).toMatchObject({ text: "stored public finding" });
}, 60_000);
