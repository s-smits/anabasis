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

it("follows readiness's one finding route to both kinds and refuses selectors that an action cannot read", async () => {
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
  const ready = parseJsonAs<{ findings: Overview }>(await call({ action: "readiness" }));
  // Follow the actual returned navigation, rather than copying a route into the test call.
  const readiness = parseJsonAs<{ action: "readiness" }>(
    ready.findings.navigation.match(/\{[^}]+\}/)?.[0] ?? "{}",
  );
  expect(readiness.action).toBe("readiness");
  // A validation finding and a module diagnostic sit in the one list, each reachable by its group.
  const details: string[] = [];
  for (const { group } of ready.findings.groups) {
    const page = parseJsonAs<{ findings: { text: string } }>(
      await call({ ...readiness, group, field: "detail" }),
    );
    details.push(page.findings.text);
  }
  expect(details.some((detail) => detail.includes("the array is the whole file"))).toBe(true);
  expect(details.some((detail) => detail.includes("TS2322"))).toBe(true);
  for (const action of ["task", "coverage"] as const) {
    expect(parseJsonAs(await call({ action, group: 1, field: "detail" }))).toMatchObject({
      status: "blocked",
      nextAction: expect.stringContaining("readiness for the candidate's own findings"),
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
