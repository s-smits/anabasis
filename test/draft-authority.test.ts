import { Type } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { describe, expect, it } from "bun:test";
import { type DomainHarnessFactory, createBuiltStarter } from "../src/solve/built-starter.ts";
import { defineTool } from "../src/solve/define-tool.ts";
import { withDraftLease } from "../src/solve/draft-authority.ts";
import { DraftStore } from "../src/solve/draft-store.ts";
import { defineDraftTool } from "../src/solve/draft-tool.ts";
import { createSubmissionAuthority, submissionPortOf } from "../src/solve/final-submission.ts";
import { compilePublicArtifactSchema } from "../src/solve/public-artifact-schema.ts";
import { double } from "./helpers/doubles.ts";

/** The one task every starter below is built for: the cases are about the tools, not the task. */
const TASK = { taskId: "t", family: "f", publicInput: {} };

describe("call-scoped draft authority", () => {
  it("refuses tool metadata beyond the public worker limits", () => {
    expect(() =>
      defineDraftTool({
        name: "x".repeat(129),
        label: "Long",
        description: "Too long.",
        parameters: Type.Object({}),
        run: () => ({ text: "unreached" }),
      }),
    ).toThrow(/name exceeds/);
  });

  // pr180 truss review: 18/18 malformed writer probes reached run() unchecked — Static<P> is a
  // compile-time type and nothing on the worker path validated the model's arguments at runtime.
  it("rejects a malformed call against the declared schema before the tool runs", async () => {
    let ran = false;
    const tool = defineDraftTool({
      name: "write_design",
      label: "Write",
      description: "Write.",
      parameters: Type.Object({ jointIds: Type.Array(Type.String()) }),
      run: () => {
        ran = true;
        return { text: "written" };
      },
    });
    await expect(tool.execute("bad", double({ jointIds: "J1" }), new DraftStore())).rejects.toThrow(
      /arguments do not match its declared parameter schema/,
    );
    await expect(tool.execute("missing", double({}), new DraftStore())).rejects.toThrow(
      /declared parameter schema/,
    );
    expect(ran).toBe(false);
    await expect(tool.execute("good", { jointIds: ["J1"] }, new DraftStore())).resolves.toMatchObject({
      content: [{ type: "text", text: "written" }],
    });
    expect(ran).toBe(true);
  });

  it("does not expose the draft while the generated harness is constructed", () => {
    let constructionArgs: unknown[] = ["not-called"];
    const factory = double<DomainHarnessFactory>((...args: unknown[]) => {
      constructionArgs = args;
      return { tools: [] };
    });
    createBuiltStarter(TASK, factory, null);
    expect(constructionArgs[1]).toBeUndefined();
  });

  it("refuses a domain tool built without the draft-aware constructor", () => {
    const ordinary = defineTool({
      name: "finish",
      label: "Finish",
      description: "Pretend to finish.",
      parameters: Type.Object({}),
      executionMode: "sequential",
      run: () => ({ text: "done" }),
    });
    // @ts-expect-error — an ordinary AgentTool is not a DraftTool; the runtime must refuse it as well
    const factory: DomainHarnessFactory = () => ({ tools: [ordinary] });
    expect(() =>
      createBuiltStarter(TASK, factory, null, {
        domainToolAuthorities: [{ name: "finish", authority: "artifact-writer" }],
      }),
    ).toThrow(/defineDraftTool/);
  });

  it("expires retained views and enforces the recorded tool kind", async () => {
    const raw = new DraftStore();
    let retained: DraftStore | undefined;
    let deferred: Promise<unknown> | undefined;
    await withDraftLease(raw, "writer", "write", "call-1", (draft) => {
      retained = draft;
      draft.setValue("value", 1);
      expect(() => draft.setArtifact({ value: 1 })).toThrow(/artifact-writer/);
      expect(Reflect.set(draft, "_seq", 99)).toBe(false);
      expect(() => Object.defineProperty(draft, "seq", { value: 99 })).toThrow(TypeError);
      expect(() => Object.setPrototypeOf(draft, { seq: 99 })).toThrow(TypeError);
      deferred = new Promise((resolve) =>
        setTimeout(() => {
          try {
            draft.setValue("late", true);
            resolve("unexpected success");
          } catch (error) {
            resolve(error);
          }
        }, 0),
      );
    });
    expect(() => retained?.setValue("late", true)).toThrow(/lease has ended/);
    await expect(deferred).resolves.toMatchObject({ message: expect.stringMatching(/lease has ended/) });
    await expect(
      withDraftLease(raw, "reader", "read", "call-2", (draft) => draft.setValue("value", 2)),
    ).rejects.toThrow(/registered writer/);
  });

  it("records controller provenance and ignores caller-supplied identity", async () => {
    const raw = new DraftStore();
    await withDraftLease(raw, "artifact-writer", "finish", "call-3", (draft) => {
      // SAFETY: the leased view declares setArtifact with the controller's own parameters; this
      // call deliberately passes false identities that the lease must ignore.
      // oxlint-disable-next-line typescript/unbound-method -- unbinding is the subject: the lease must ignore identity arguments a detached call supplies.
      const falsified = draft.setArtifact as (...args: unknown[]) => void;
      falsified({ answer: 1 }, "falsified", "falsified-call");
    });
    expect(raw.artifactMaterialization()).toMatchObject({
      state: "current",
      record: { writerName: "finish", callId: "call-3", artifactJson: '{"answer":1}' },
    });
  });

  it("refuses deferred answer preparation after the artifact-writer call returns", async () => {
    const raw = new DraftStore();
    let deferred: Promise<unknown> | undefined;
    await withDraftLease(raw, "artifact-writer", "finish", "call-4", (draft) => {
      deferred = new Promise((resolve) =>
        setTimeout(() => {
          try {
            resolve(draft.setArtifact({ answer: "late" }));
          } catch (error) {
            resolve(error);
          }
        }, 0),
      );
    });
    await expect(deferred).resolves.toMatchObject({ message: expect.stringMatching(/lease has ended/) });
    expect(raw.artifactMaterialization()).toEqual({ state: "absent" });
  });

  it("distinguishes absent, ordinary mutation, stale and current prepared answers at submit", async () => {
    const authority = createSubmissionAuthority({
      maxAttempts: 8,
      publicArtifactSchema: compilePublicArtifactSchema([{ name: "answer" }], [{ answer: "ok" }]),
    });
    const factory: DomainHarnessFactory = () => ({
      tools: [
        defineDraftTool({
          name: "read",
          label: "Read",
          description: "Read the draft.",
          parameters: Type.Object({}),
          run: (_params, draft) => ({ text: JSON.stringify(draft.getValue("answer")) ?? "absent" }),
        }),
        defineDraftTool({
          name: "write",
          label: "Write",
          description: "Mutate the draft.",
          parameters: Type.Object({}),
          executionMode: "sequential",
          run: (_params, draft) => {
            draft.setValue("answer", "ok");
            return { text: "written" };
          },
        }),
        defineDraftTool({
          name: "finish",
          label: "Finish",
          description: "Prepare the answer.",
          parameters: Type.Object({}),
          executionMode: "sequential",
          run: (_params, draft) => {
            draft.setArtifact({ answer: draft.getValue("answer") });
            return { text: "prepared" };
          },
        }),
      ],
    });
    const starter = createBuiltStarter(TASK, factory, submissionPortOf(authority), {
      domainToolAuthorities: [
        { name: "read", authority: "reader" },
        { name: "write", authority: "writer" },
        { name: "finish", authority: "artifact-writer" },
      ],
    });
    const call = async (name: string) =>
      await starter.tools.find((tool) => tool.name === name)?.execute(name, double({}));

    await call("submit");
    expect(authority.finalSubmission()?.rejection?.code).toBe("draft-unmaterialized");
    expect((await call("inspect_draft"))?.content).toMatchObject([
      { text: expect.stringContaining('"preparedAnswer":"absent"') },
    ]);
    await call("read");
    await call("submit");
    expect(authority.finalSubmission()?.rejection?.code).toBe("draft-unmaterialized");
    await call("write");
    await call("submit");
    expect(authority.finalSubmission()?.rejection?.code).toBe("draft-unmaterialized");
    await call("finish");
    expect((await call("inspect_draft"))?.content).toMatchObject([
      { text: expect.stringContaining('"preparedAnswer":"current"') },
    ]);
    expect((await call("preview_artifact"))?.content).toMatchObject([{ text: '{"answer":"ok"}' }]);
    await call("write");
    expect((await call("inspect_draft"))?.content).toMatchObject([
      { text: expect.stringContaining('"preparedAnswer":"stale"') },
    ]);
    await call("submit");
    expect(authority.finalSubmission()?.rejection?.code).toBe("draft-materialization-stale");
    await call("finish");
    await call("submit");
    expect(authority.finalSubmission()).toMatchObject({ accepted: true, artifactJson: '{"answer":"ok"}' });
  });

  it("derives a structured writer from the public schema and submits its exact arguments", async () => {
    const publicArtifactSchema = compilePublicArtifactSchema(
      [{ name: "amount" }, { name: "note" }, { name: "files", fileMap: true }],
      [
        { amount: 1, note: "present", files: { "src/main.c": "one" } },
        { amount: 1.5, note: "", files: { "include/main.h": "two" } },
      ],
    );
    const authority = createSubmissionAuthority({ maxAttempts: 1, publicArtifactSchema });
    let generatedWriterRan = false;
    let generatedPreparationRan = false;
    const factory: DomainHarnessFactory = () => ({
      tools: [
        defineDraftTool({
          name: "write_answer",
          label: "Write answer",
          description: "Prepare the public answer.",
          executionMode: "sequential",
          // Deliberately narrower for numbers/strings and wider for file keys than submit. The
          // controller-derived writer contract below must be the only live representation.
          parameters: Type.Object({
            amount: Type.Integer(),
            note: Type.String({ minLength: 1 }),
            files: Type.Record(Type.String(), Type.String()),
          }),
          prepareArguments: () => {
            generatedPreparationRan = true;
            return { amount: 0, note: "changed", files: {} };
          },
          run: (_params, draft) => {
            generatedWriterRan = true;
            draft.setArtifact({ amount: 0, note: "changed", files: {} });
            return { text: "generated transform ran" };
          },
        }),
      ],
    });
    const starter = createBuiltStarter(TASK, factory, submissionPortOf(authority), {
      domainToolAuthorities: [{ name: "write_answer", authority: "artifact-writer" }],
      publicArtifactSchema,
    });
    const writer = starter.tools.find((tool) => tool.name === "write_answer");
    if (writer === undefined) throw new Error("writer absent");
    const valid = { amount: 1.5, note: "", files: { "src/main.c": "ok" } };

    expect(Value.Check(writer.parameters, valid)).toBe(true);
    expect(writer.prepareArguments).toBeUndefined();
    expect(Value.Check(writer.parameters, { ...valid, extra: true })).toBe(false);
    expect(Value.Check(writer.parameters, { ...valid, files: { "../main.c": "bad" } })).toBe(false);
    await expect(
      writer.execute("prefix", double({ ...valid, files: { a: "file", "a/b": "child" } })),
    ).rejects.toThrow(/both a file and a directory/);
    expect(starter.materialization()).toEqual({ state: "absent" });

    await writer.execute("valid", double(valid));
    expect(generatedWriterRan).toBe(false);
    expect(generatedPreparationRan).toBe(false);
    expect(starter.materialization()).toMatchObject({
      state: "current",
      record: { writerName: "write_answer", callId: "valid" },
    });
    const materialization = starter.materialization();
    if (materialization.state !== "current") throw new Error("valid writer did not materialise");
    expect(JSON.parse(materialization.record.artifactJson)).toEqual(valid);
    await starter.tools.find((tool) => tool.name === "submit")?.execute("submit", double({}));
    expect(authority.finalSubmission()).toMatchObject({
      accepted: true,
      artifactJson: materialization.record.artifactJson,
    });
  });

  it("ignores a generated tools array's own map when binding domain tools", () => {
    const tool = defineDraftTool({
      name: "write_answer",
      label: "Write answer",
      description: "Write.",
      parameters: Type.Object({}),
      executionMode: "sequential",
      run: () => ({ text: "ok" }),
    });
    const tools = [tool];
    let falsified = 0;
    Object.defineProperty(tools, "map", {
      value: () => {
        falsified += 1;
        return [{ owner: "controller", authority: "reader", tool }];
      },
    });
    const factory: DomainHarnessFactory = () => ({ tools });
    const starter = createBuiltStarter(TASK, factory, null, {
      domainToolAuthorities: [{ name: "write_answer", authority: "artifact-writer" }],
    });
    expect(falsified).toBe(0);
    expect(starter.registration.tools.find(({ name }) => name === "write_answer")).toMatchObject({
      owner: "domain",
      authority: "artifact-writer",
    });
  });
  // A truss draft outgrew the 12,000-character view, and the old cut ended "… (N chars omitted)"
  // with no way back to the rest: the model could not read the answer it was about to send.
  it("hands a long value back as windows the model can walk", async () => {
    const long = "y".repeat(30_000);
    const factory: DomainHarnessFactory = () => ({
      tools: [
        defineDraftTool({
          name: "fill",
          label: "Fill",
          description: "Fill the draft.",
          parameters: Type.Object({}),
          executionMode: "sequential",
          run: (_params, draft) => {
            draft.setValue("long", long);
            return { text: "filled" };
          },
        }),
      ],
    });
    const starter = createBuiltStarter(TASK, factory, null, {
      domainToolAuthorities: [{ name: "fill", authority: "writer" }],
    });
    const call = async (name: string, args: { from?: number } = {}) =>
      await starter.tools.find((tool) => tool.name === name)?.execute(name, double(args));
    await call("fill");

    const first = await call("inspect_draft");
    expect(first?.details).toMatchObject({ truncated: true, from: 0, next: 12_000 });
    expect(first?.content[0]).toMatchObject({ text: expect.stringContaining("call again with from: 12000") });

    const second = await call("inspect_draft", { from: 12_000 });
    expect(second?.details).toMatchObject({ truncated: true, from: 12_000, next: 24_000 });
    expect(second?.content[0]).toMatchObject({
      text: expect.stringContaining("… (12000 chars before this)"),
    });

    // The last window closes: nothing is left, so the text names no next call and `next` is null.
    const past = await call("inspect_draft", { from: 1_000_000 });
    expect(past?.details).toMatchObject({ truncated: false, next: null, from: expect.any(Number) });
    expect(past?.content[0]).not.toMatchObject({ text: expect.stringContaining("call again") });
  });
  // Blocker 3 of the c03 reading: once the draft moved past a prepared answer the answer went
  // stale, submit refused it, and nothing could put the draft back to the state that produced it.
  // A solver that made its candidate worse had no way to return to the better one.
  it("puts a draft back to a saved candidate after a change made it worse", async () => {
    const authority = createSubmissionAuthority({
      maxAttempts: 8,
      publicArtifactSchema: compilePublicArtifactSchema([{ name: "answer" }], [{ answer: "ok" }]),
    });
    const factory: DomainHarnessFactory = () => ({
      tools: [
        defineDraftTool({
          name: "write",
          label: "Write",
          description: "Mutate the draft.",
          parameters: Type.Object({ answer: Type.String() }),
          executionMode: "sequential",
          run: ({ answer }, draft) => {
            draft.setValue("answer", answer);
            return { text: "written" };
          },
        }),
        defineDraftTool({
          name: "finish",
          label: "Finish",
          description: "Prepare the answer.",
          parameters: Type.Object({}),
          executionMode: "sequential",
          run: (_params, draft) => {
            draft.setArtifact({ answer: draft.getValue("answer") });
            return { text: "prepared" };
          },
        }),
      ],
    });
    const starter = createBuiltStarter(TASK, factory, submissionPortOf(authority), {
      domainToolAuthorities: [
        { name: "write", authority: "writer" },
        { name: "finish", authority: "artifact-writer" },
      ],
    });
    const call = async (name: string, args: Record<string, string> = {}) =>
      await starter.tools.find((tool) => tool.name === name)?.execute(name, double(args));

    await call("write", { answer: "ok" });
    await call("finish");
    await call("save_candidate", { name: "best" });
    expect((await call("inspect_draft"))?.content).toMatchObject([
      { text: expect.stringContaining('"savedCandidates":["best"]') },
    ]);

    // The experiment that made it worse: the prepared answer goes stale and cannot be sent.
    await call("write", { answer: "worse" });
    await call("submit");
    expect(authority.finalSubmission()?.rejection?.code).toBe("draft-materialization-stale");

    expect((await call("restore_candidate", { name: "best" }))?.content).toMatchObject([
      { text: expect.stringContaining('Restored "best"') },
    ]);
    await call("submit");
    expect(authority.finalSubmission()).toMatchObject({ accepted: true, artifactJson: '{"answer":"ok"}' });

    // The candidate survives its own restore, and an unknown name says what is held.
    expect((await call("restore_candidate", { name: "other" }))?.content).toMatchObject([
      { text: expect.stringContaining('No candidate named "other". Held: best.') },
    ]);
  });

  it("advances the mutation sequence when a candidate is restored, so the checkpoint never regresses", () => {
    // The parent worker refuses a checkpoint whose draftSeq fell below the one it already holds
    // ("checkpoint regressed", generated-tool-worker-process.ts). Restoring used to rewind the
    // sequence to the saved one, so the ordinary save, explore and restore above passed in process
    // and broke the protocol in the confined path. A restore is a mutation and advances like one.
    const draft = new DraftStore();
    draft.setValue("answer", "ok");
    draft.setArtifact({ answer: "ok" }, "finish", "c1");
    const best = draft.checkpoint();
    draft.setValue("answer", "worse");
    const mutated = draft.checkpoint().seq;
    expect(draft.artifactMaterialization().state).toBe("stale");

    draft.adopt(best);

    expect(draft.checkpoint().seq).toBeGreaterThan(mutated);
    // What the sequence records about the restored answer is that it is current, not the number
    // it was current at, so it is sendable again.
    expect(draft.artifactMaterialization().state).toBe("current");
    expect(draft.snapshot().state).toMatchObject({ answer: "ok" });

    // A candidate saved while its own prepared answer was already stale comes back stale: the
    // rebase preserves standing rather than granting it.
    draft.setValue("answer", "later");
    const staleCandidate = draft.checkpoint();
    draft.setValue("answer", "later still");
    draft.adopt(staleCandidate);
    expect(draft.artifactMaterialization().state).toBe("stale");
  });

  it("holds six candidates and asks for a name to be reused rather than dropping one", async () => {
    const factory: DomainHarnessFactory = () => ({
      tools: [
        defineDraftTool({
          name: "write",
          label: "Write",
          description: "Mutate the draft.",
          parameters: Type.Object({}),
          executionMode: "sequential",
          run: (_params, draft) => {
            draft.setValue("answer", "ok");
            return { text: "written" };
          },
        }),
      ],
    });
    const starter = createBuiltStarter(TASK, factory, null, {
      domainToolAuthorities: [{ name: "write", authority: "writer" }],
    });
    const save = async (name: string) =>
      await starter.tools
        .find((tool) => tool.name === "save_candidate")
        ?.execute("save_candidate", double({ name }));

    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      expect((await save(name))?.details).toMatchObject({ stored: true });
    }
    expect((await save("g"))?.details).toMatchObject({ stored: false });
    expect((await save("g"))?.content).toMatchObject([
      { text: expect.stringContaining("6 candidates are already held (a, b, c, d, e, f)") },
    ]);
    // Saving over a held name is how room is made, and it does not grow the set.
    expect((await save("a"))?.details).toMatchObject({ stored: true, saved: ["a", "b", "c", "d", "e", "f"] });
  });
});
