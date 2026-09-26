/**
 * What the conformance probe lets a generated tool read out of the public task. An adviser that
 * derives its answer from a key no task carries is guessing, and the probe refuses it before
 * measurement; a reader that merges, copies or selects a path the battery does offer is ordinary
 * code and must pass. Both halves run the real worker over a written slug.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { projectFindingForAuthor } from "../src/correctness-bundle/brief.ts";
import type { BuildTask } from "../src/correctness-bundle/tasks.ts";
import type { ToolsSpec } from "../src/correctness-bundle/tools-spec.ts";
import { TASK, probeSlugs } from "./helpers/probe-slug.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const { conform } = probeSlugs(scratchDir(".ana-scratch-probes-paths-", import.meta.dir));
/** Four tools over one derived list: a reader returning the task, two advisers deriving from a
 *  public key, and the writer that records what they proposed. */
const TASK_BLIND_ADVISERS_SOURCE = `
import { defineDraftTool } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";

export function createDomainHarness(task) {
  const derive = () => Array.isArray(task.publicInput.timingPointPassages)
    ? task.publicInput.timingPointPassages
    : [];
  return { tools: [
    defineDraftTool({
      name: "read_task", label: "Read task", description: "read the public task",
      parameters: Type.Object({}), executionMode: "parallel",
      run: () => ({ text: JSON.stringify(task.publicInput) }),
    }),
    defineDraftTool({
      name: "analyze_conflicts", label: "Analyse", description: "derive conflicts",
      parameters: Type.Object({}), executionMode: "parallel",
      run: () => ({ text: JSON.stringify(derive()) }),
    }),
    defineDraftTool({
      name: "audit_conflicts", label: "Audit", description: "audit proposed conflicts",
      parameters: Type.Object({ conflicts: Type.Array(Type.Unknown()) }), executionMode: "parallel",
      run: ({ conflicts }) => ({ text: JSON.stringify({ complete: conflicts.length === derive().length }) }),
    }),
    defineDraftTool({
      name: "write_conflicts", label: "Write", description: "write proposed conflicts",
      parameters: Type.Object({ conflicts: Type.Array(Type.Unknown()) }), executionMode: "sequential",
      run: ({ conflicts }, draft) => {
        draft.setArtifact({ assignments: conflicts });
        return { text: "written" };
      },
    }),
  ] };
}
`;

const TASK_BLIND_SPEC: ToolsSpec = {
  presets: [],
  declined: { files: "fixture without a shell" },
  tools: [
    { name: "read_task", kind: "reader", description: "read the public task" },
    { name: "analyze_conflicts", kind: "advisor", description: "derive conflicts" },
    { name: "audit_conflicts", kind: "advisor", description: "audit proposed conflicts" },
    { name: "write_conflicts", kind: "artifact-writer", description: "write proposed conflicts" },
  ],
};

afterAll(cleanupScratch);

describe("the public-input paths the conformance probe admits", () => {
  const absentPath = (tool: string) =>
    expect.objectContaining({ code: "task-public-path-absent", path: `agent/tools.ts#${tool}` });

  it.concurrent("rejects advisers that guess an absent public-input alias even when a reader returns the task", async () => {
    const nestedTask = {
      ...TASK,
      publicInput: {
        timingPoints: [{ id: "TP1", passages: [{ trainId: "H1", second: 120 }] }],
      },
    } satisfies BuildTask;
    const findings = await conform("conform-task-blind-advisers", [nestedTask], {
      tools: TASK_BLIND_ADVISERS_SOURCE,
      spec: TASK_BLIND_SPEC,
    });
    expect(findings).toContainEqual(absentPath("analyze_conflicts"));
    expect(findings).toContainEqual(absentPath("audit_conflicts"));
    // An unmarked finding would project to the detail-less generated-execution-unclassified
    // label, which no owner routes. The author projection keeps the producer, file and detail.
    for (const finding of findings.filter((f) => f.code === "task-public-path-absent")) {
      expect(projectFindingForAuthor(finding)).toEqual({
        code: finding.code,
        path: finding.path,
        detail: finding.detail,
        disclosure: { class: "authored" },
      });
    }
  });

  it.concurrent("accepts nested adviser paths merged across empty and populated task arrays", async () => {
    const tasks = [
      { ...TASK, taskId: "empty", publicInput: { timingPoints: [] } },
      {
        ...TASK,
        taskId: "nested",
        publicInput: {
          timingPoints: [{ id: "TP1", passages: [{ trainId: "H1", second: 120 }] }],
        },
      },
    ] satisfies BuildTask[];
    const nestedSource = TASK_BLIND_ADVISERS_SOURCE.replaceAll(
      "task.publicInput.timingPointPassages",
      "task.publicInput.timingPoints.flatMap((point) => point.passages)",
    )
      .replace("JSON.stringify(task.publicInput)", "String(task.publicInput.timingPoints.length)")
      .replace("JSON.stringify(derive())", "String(derive().length)");
    await expect(
      conform("conform-nested-advisers", tasks, { tools: nestedSource, spec: TASK_BLIND_SPEC }),
    ).resolves.toEqual([]);
  });

  // A shared reader reading `wind?.pressure` for a family without wind is correct code, so a path
  // any task of the battery carries is admitted in every family.
  it.concurrent("admits a path one family offers when the task under probe belongs to another", async () => {
    const tasks = [
      {
        ...TASK,
        taskId: "aliased",
        family: "with-alias",
        publicInput: { timingPointPassages: [{ trainId: "H1", second: 120 }] },
      },
      {
        ...TASK,
        taskId: "plain",
        family: "without-alias",
        publicInput: { timingPoints: [{ id: "TP1" }] },
      },
    ] satisfies BuildTask[];
    const findings = await conform("conform-cross-family-alias", tasks, {
      tools: TASK_BLIND_ADVISERS_SOURCE,
      spec: TASK_BLIND_SPEC,
    });
    expect(findings.filter((f) => f.code === "task-public-path-absent")).toEqual([]);
  });

  it.concurrent("executes interpreters on later tasks rather than treating the first task as the battery", async () => {
    const tasks = [
      { ...TASK, taskId: "first", publicInput: { timingPoints: [] } },
      { ...TASK, taskId: "second", publicInput: { timingPoints: [] } },
    ] satisfies BuildTask[];
    const laterSource = TASK_BLIND_ADVISERS_SOURCE.replace(
      `const derive = () => Array.isArray(task.publicInput.timingPointPassages)
    ? task.publicInput.timingPointPassages
    : [];`,
      `const derive = () => task.taskId === "second" ? (task.publicInput.laterTaskAlias ?? []) : [];`,
    );
    const findings = await conform("conform-later-task", tasks, {
      tools: laterSource,
      spec: TASK_BLIND_SPEC,
    });
    expect(findings).toContainEqual(absentPath("analyze_conflicts"));
  });

  it.concurrent("accepts selected public JSON and a shallow public copy through the real worker", async () => {
    const copiedSource = TASK_BLIND_ADVISERS_SOURCE.replace(
      `const derive = () => Array.isArray(task.publicInput.timingPointPassages)
    ? task.publicInput.timingPointPassages
    : [];`,
      `const derive = () => {
    const copy = { ...task.publicInput };
    return Array.isArray(copy.timingPointPassages) ? copy.timingPointPassages : [];
  };`,
    );
    const selectedSource = copiedSource.replace(
      "JSON.stringify(task.publicInput)",
      "JSON.stringify({ timingPointPassages: task.publicInput.timingPointPassages })",
    );
    const tasks = [
      { ...TASK, publicInput: { timingPointPassages: [{ trainId: "H1", second: 120 }] } },
      { ...TASK, taskId: "second-task", publicInput: { timingPointPassages: [] } },
    ];
    await expect(
      conform("conform-copied-task", tasks, { tools: selectedSource, spec: TASK_BLIND_SPEC }),
    ).resolves.toEqual([]);
  });
});
