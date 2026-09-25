/**
 * The served tool surface the conformance probe reconciles with the declared contract, in
 * src/truth/probe-tool-surface.ts: the descriptions each task's worker serves, a registration that
 * moves between tasks, and how the probed workers end. `closeOneAtATime` sits here because
 * probes.ts is its only consumer and its cases are about the same worker lifetime.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { closeOneAtATime } from "../src/solve/built-starter.ts";
import { WRITER_BINDING_SENTENCE } from "../src/solve/published-margin.ts";
import { terminationFindings, toolDescriptionParityFindings } from "../src/truth/probe-tool-surface.ts";
import { TASK, TASK_TWO, TOOLS_SOURCE, probeSlugs } from "./helpers/probe-slug.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const { conform } = probeSlugs(scratchDir(".ana-scratch-probes-surface-", import.meta.dir));
afterAll(cleanupScratch);

describe("the served tool surface", () => {
  it.concurrent("refuses a task-varying worker binding before production measurement", async () => {
    const source = TOOLS_SOURCE.replace(
      "parameters: Type.Object({ name: Type.String() }),",
      'parameters: task.taskId === "t2" ? Type.Object({ name: Type.String(), note: Type.Optional(Type.String()) }) : Type.Object({ name: Type.String() }),',
    );
    const findings = await conform("conform-worker-binding", [TASK, TASK_TWO], { tools: source });
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "task-worker-binding-drift",
        path: "agent/tools.ts",
        detail: expect.stringContaining('family "two-part"'),
      }),
    );
  });

  // A served description can contradict the declared one while every name still matches, so
  // conformance compares the text as well as the names.
  it.concurrent("refuses a served tool description the tool contract does not declare", async () => {
    const source = TOOLS_SOURCE.replace(
      'description: "bind a declared part to a slot"',
      'description: "record the slot pin plan only; the complete assignment list is written elsewhere"',
    );
    const findings = await conform("conform-description-parity", [TASK, TASK_TWO], { tools: source });
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "tools-description-drift",
        path: "agent/tools.ts#bind_slot",
        detail: expect.stringContaining("record the slot pin plan only"),
      }),
    );
    // The name list still matches, which is exactly why the names check never saw this.
    expect(findings.some((finding) => finding.code === "tools-contract-mismatch")).toBe(false);
    for (const finding of findings.filter((f) => f.code === "tools-description-drift")) {
      expect(finding.disclosure).toEqual({ class: "authored" });
    }
  });

  it("reads the host's own sentence on a bound artifact-writer as the host's, not as drift", () => {
    // The host replaces a bound artifact-writer's parameters and execution, and says so in the
    // served text. The spec was written against neither and cannot declare it, so comparing the
    // whole served string would refuse every candidate that ships an artifact-writer.
    const spec = { tools: [{ name: "w", description: "write the answer" }] };
    const served = (description: string) => [{ name: "w", description }];
    expect(
      toolDescriptionParityFindings(
        /* SAFETY: the parity reader uses each tool's name and description, which is what these two fixtures carry. */ spec as never,
        /* SAFETY: as above. */ served(`write the answer ${WRITER_BINDING_SENTENCE}`) as never,
      ),
    ).toEqual([]);
    // Only the appended sentence is the host's. Drift underneath it is still drift, and the
    // finding quotes the authored text rather than the host's paragraph.
    const drifted = toolDescriptionParityFindings(
      /* SAFETY: as above. */ spec as never,
      /* SAFETY: as above. */ served(`write half the answer ${WRITER_BINDING_SENTENCE}`) as never,
    );
    expect(drifted).toHaveLength(1);
    expect(drifted[0]?.detail).toContain('serves the description "write half the answer"');
    expect(drifted[0]?.detail).not.toContain("The host binds this tool");
  });

  it.concurrent("carries an excerpt of a long served description rather than the whole text", async () => {
    // A generated tool description may run to thousands of characters, and the author already
    // holds both files. Only enough to recognise which text is meant crosses into the finding.
    const long = `records the assignment ${"and its provenance ".repeat(40)}`;
    expect(long.length).toBeGreaterThan(700);
    const source = TOOLS_SOURCE.replace(
      'description: "bind a declared part to a slot"',
      `description: "${long}"`,
    );
    const findings = await conform("conform-long-description", [TASK], { tools: source });
    const drift = findings.filter((f) => f.code === "tools-description-drift");
    expect(drift).toHaveLength(1);
    expect(drift[0]?.detail).toContain(`${long.slice(0, 117)}...`);
    expect(drift[0]?.detail).not.toContain(long);
  });

  it.concurrent("names the tool whose served description moves between tasks", async () => {
    const source = TOOLS_SOURCE.replace(
      'name: "declare_part", label: "Declare part", description: "declare a part by name",',
      'name: "declare_part", label: "Declare part", description: task.taskId === "t2" ? "declare a widget by name" : "declare a part by name",',
    );
    const findings = await conform("conform-description-drift", [TASK, TASK_TWO], { tools: source });
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "task-worker-binding-drift",
        path: "agent/tools.ts",
        detail: expect.stringContaining('(moved: "declare_part")'),
      }),
    );
  });

  it.concurrent("refuses a renamed contract before worker readiness", async () => {
    // declare_part → declare_widget: refused when the recorded authority names are reconciled
    // with the generated tools, before any worker is ready.
    const renamed = TOOLS_SOURCE.replace('name: "declare_part"', 'name: "declare_widget"');
    const codes = (await conform("conform-bad", [TASK], { tools: renamed })).map((f) => f.code);
    expect(codes).toContain("generated-module-load");
    expect(codes).not.toContain("empty-green-submit");
  });
});

describe("how the probed workers end", () => {
  // A close timeout after every probe settled says nothing about the agent bytes, which the next
  // submit would accept unchanged; a crash does.
  it("refuses a worker crash while allowing a close-handshake timeout after settled probes", () => {
    const missedWall = {
      status: "non-result" as const,
      kind: "runtime" as const,
      message: "close handshake timeout",
      deadline: true as const,
      closeHandshakeTimeout: true as const,
    };
    const crashed = { status: "non-result" as const, kind: "crash" as const, message: "worker exited 1" };
    expect(
      terminationFindings([undefined, { termination: { status: "normal" } }, { termination: missedWall }]),
    ).toEqual([]);
    expect(terminationFindings([{ termination: crashed }, { termination: missedWall }])).toEqual([
      expect.objectContaining({
        code: "generated-toolset-termination",
        detail: expect.stringContaining("worker exited 1"),
      }),
    ]);
  });

  // Workers closed together miss their close handshakes together under load. Each close waits for
  // the one before it, so their timeout windows do not overlap.
  it("closes one worker at a time", async () => {
    let open = 0;
    let mostAtOnce = 0;
    const toolset = () => ({
      close: async () => {
        open += 1;
        mostAtOnce = Math.max(mostAtOnce, open);
        await Bun.sleep(5);
        open -= 1;
        return { termination: { status: "normal" as const } };
      },
    });
    const closed = await closeOneAtATime([toolset(), toolset(), toolset()]);
    expect(mostAtOnce).toBe(1);
    expect(closed).toHaveLength(3);
  });

  it("returns a hole for a toolset that has no close", async () => {
    await expect(closeOneAtATime([{}])).resolves.toEqual([undefined]);
  });
});
