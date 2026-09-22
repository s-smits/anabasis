import { afterAll, expect, it, spyOn } from "bun:test";
import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { sha256 } from "../src/meta/digest.ts";
import { customCallIntent, semanticFromResult } from "../src/author/builder-custom-tool-call.ts";
import { deriveCandidateIsolation } from "../src/builder/candidate-isolation.ts";
import { openPathRecord, runIsolated } from "../src/builder/candidate-isolation-runtime.ts";
import { exportWorkshopFile, workshopExportBinding } from "../src/builder/verifier-workshop-export.ts";
import { createVerifierWorkshop } from "../src/builder/verifier-workshop.ts";
import { createVerifierWorkshopTool } from "../src/builder/verifier-workshop-tool.ts";
import { resolveToolInventory } from "../src/verify/tool-inventory.ts";
import { seedIsolationFixture } from "./helpers/isolation-fixture.ts";

const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-export-test-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function fixture(name: string) {
  const f = seedIsolationFixture(scratch, name, { iterationName: "workspace" });
  const policy = deriveCandidateIsolation(f.binding, "workshop");
  const exportBinding = workshopExportBinding(f.iterationDir, policy);
  const evidencePath = join(f.epochDir, "verifier-workshop.jsonl");
  const owner = createVerifierWorkshop({
    root: f.ossRoot,
    evidencePath,
    policy,
    exportBinding,
    record: openPathRecord(f.epochDir, "builder-primary"),
  });
  const tool = createVerifierWorkshopTool(owner);
  const transfer = async (path: string, destination: string) => {
    const result = await tool.execute("export", { action: "export", path, destination });
    const part = result.content[0];
    if (part?.type !== "text") throw new Error("expected export text");
    return { body: JSON.parse(part.text), receipt: semanticFromResult(result) };
  };
  return { ...f, owner, transfer, exportBinding, evidencePath };
}

it("compiles and tests in the real workshop, then exports exact executable bytes for inventory resolution", async () => {
  const f = fixture("compiled");
  expect(
    JSON.parse(
      (
        await f.owner.write(
          "checker.c",
          "#include <stdio.h>\nint main(void) { return getchar() == 'a' ? 0 : 1; }\n",
        )
      ).text,
    ).status,
  ).toBe("completed");
  expect(JSON.parse((await f.owner.run("cc checker.c -o checker && printf a | ./checker")).text).status).toBe(
    "completed",
  );
  expect(JSON.parse((await f.owner.run("./checker", ".", "b")).text)).toMatchObject({
    status: "failed",
    reason: "command-failed",
    process: { exitCode: 1 },
  });
  const transferred = await f.transfer("checker", "bin/checker");
  const installed = join(f.iterationDir, ".toolchain/bin/checker");
  const digest = sha256(readFileSync(join(f.ossRoot, "checker")));
  expect(transferred.body).toMatchObject({
    status: "completed",
    action: "export",
    result: {
      path: ".toolchain/bin/checker",
      sha256: digest,
      executable: true,
    },
  });
  expect(sha256(readFileSync(installed))).toBe(digest);
  expect(statSync(installed).mode & 0o777).toBe(0o700);
  const resolved = resolveToolInventory({
    toolIds: ["checker"],
    toolTree: join(f.iterationDir, ".toolchain"),
    pathDirs: [],
  });
  expect(resolved.missing).toEqual([]);
  expect(resolved.inventory.checker).toMatchObject({
    path: installed,
    source: "workspace-toolchain",
    digest,
  });
  for (const [input, expected] of [
    ["a", 0],
    ["b", 1],
  ] as const) {
    const process = Bun.spawn([installed], { stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
    expect(await process.exited).toBe(expected);
  }
  expect(transferred.receipt).toMatchObject({
    outcome: "completed",
    subjectDigest: digest,
    workshopSequence: 4,
  });
  const recorded = readFileSync(f.evidencePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(recorded.at(-1)).toMatchObject({
    action: "export",
    policyDigest: f.exportBinding.policy.digest,
    subjectDigest: digest,
  });
  expect(
    customCallIntent("verifier_workshop", {
      action: "export",
      path: "private-name",
      destination: "bin/checker",
    }),
  ).toEqual({ action: "export", target: {} });
  expect(readFileSync(f.evidencePath, "utf8")).not.toContain("checker.c");
  // Exported bytes are independent of subsequent workshop edits.
  writeFileSync(join(f.ossRoot, "checker"), "changed");
  expect(sha256(readFileSync(installed))).toBe(digest);
  expect((await f.transfer("checker", "bin/checker")).body).toMatchObject({
    status: "failed",
    reason: "request-refused",
  });
  expect(sha256(readFileSync(installed))).toBe(digest);
}, 60_000);

it("exports binary packages without making them executable and refuses path, symlink and overwrite escapes", async () => {
  const f = fixture("boundaries");
  const payload = new Uint8Array([0, 255, 1, 254]);
  writeFileSync(join(f.ossRoot, "package"), payload, { mode: 0o600 });
  expect((await f.transfer("package", "packages/payload")).body).toMatchObject({
    status: "completed",
    result: { executable: false },
  });
  const installed = join(f.iterationDir, ".toolchain/packages/payload");
  expect(new Uint8Array(readFileSync(installed))).toEqual(payload);
  expect(statSync(installed).mode & 0o777).toBe(0o600);
  const outside = join(f.epochDir, "protected");
  writeFileSync(outside, "protected");
  symlinkSync(outside, join(f.ossRoot, "outside"));
  symlinkSync(f.epochDir, join(f.iterationDir, ".toolchain/escape"));
  symlinkSync(join(f.epochDir, "absent"), join(f.iterationDir, ".toolchain/dangling"));
  mkdirSync(join(f.ossRoot, "directory"));
  writeFileSync(join(f.ossRoot, "oversized"), new Uint8Array(64 * 1024 * 1024 + 1));
  for (const [path, destination] of [
    ["../protected", "bin/a"],
    ["outside", "bin/a"],
    ["directory", "bin/a"],
    ["package", "../overwrite"],
    ["package", outside],
    ["package", "escape/new"],
    ["package", "dangling"],
    ["package", "packages/payload"],
    ["oversized", "packages/oversized"],
  ]) {
    expect((await f.transfer(path!, destination!)).body).toMatchObject({
      status: "failed",
      reason: "request-refused",
    });
  }
  expect(readFileSync(outside, "utf8")).toBe("protected");
  expect(existsSync(join(f.epochDir, "new"))).toBe(false);
  expect(existsSync(join(f.epochDir, "absent"))).toBe(false);
  // The OS itself confines the copy policy, even when a command touches an unlisted path.
  const escaped = await runIsolated(f.exportBinding.policy, openPathRecord(f.epochDir, "export-wall"), {
    capability: "verifier_workshop",
    mode: "write",
    command: "/bin/sh",
    args: ["-c", 'printf changed > "$1"', "escape", outside],
    cwd: f.iterationDir,
    paths: [join(f.exportBinding.root, "allowed")],
    env: {},
    osRefusalIsOutcome: true,
  });
  expect(escaped.status).not.toBe(0);
  expect(readFileSync(outside, "utf8")).toBe("protected");
});

it("refuses a workshop source directory swapped after its path check", async () => {
  const f = fixture("source-directory-race");
  const sourceDir = join(f.ossRoot, "build");
  const source = join(sourceDir, "checker");
  const protectedDir = join(f.epochDir, "protected");
  mkdirSync(sourceDir);
  mkdirSync(protectedDir);
  writeFileSync(source, "public bytes");
  writeFileSync(join(protectedDir, "checker"), "private canary");
  const { native } = fs.realpathSync;
  let swapped = false;
  function resolveAndSwap(path: fs.PathLike, options?: fs.EncodingOption): string;
  function resolveAndSwap(path: fs.PathLike, options: fs.BufferEncodingOption): Buffer<ArrayBuffer>;
  function resolveAndSwap(path: fs.PathLike, options?: fs.EncodingOption): string | Buffer<ArrayBuffer>;
  function resolveAndSwap(
    path: fs.PathLike,
    options?: fs.EncodingOption | fs.BufferEncodingOption,
  ): string | Buffer<ArrayBuffer> {
    const resolved = options === "buffer" ? native(path, "buffer") : native(path);
    if (path === source && !swapped) {
      swapped = true;
      fs.renameSync(sourceDir, `${sourceDir}-original`);
      symlinkSync(protectedDir, sourceDir);
    }
    return resolved;
  }
  const lookup = spyOn(fs.realpathSync, "native").mockImplementation(resolveAndSwap);
  try {
    expect((await f.transfer("build/checker", "bin/private-copy")).body.status).not.toBe("completed");
    expect(existsSync(join(f.iterationDir, ".toolchain/bin/private-copy"))).toBe(false);
  } finally {
    lookup.mockRestore();
  }
});

it("keeps captured export bytes outside the workshop's read and write authority", async () => {
  const f = fixture("private-capture");
  writeFileSync(join(f.ossRoot, "checker"), "public checker");
  const record = openPathRecord(f.epochDir, "capture-wall");
  const workshopPolicy = deriveCandidateIsolation(f.binding, "workshop");
  let checked = false;
  const result = await exportWorkshopFile(
    f.ossRoot,
    f.exportBinding,
    "checker",
    "bin/checker",
    async (request, policy) => {
      const outcome = await runIsolated(policy, record, request);
      expect(outcome.status).toBe(0);
      if (checked) return;
      checked = true;
      const staged = request.controllerReadFiles?.[0] ?? request.paths[0]!;
      for (const command of ['cat "$1"', 'printf changed > "$1"']) {
        const probe = await runIsolated(workshopPolicy, record, {
          capability: "verifier_workshop",
          mode: "exec",
          command: "/bin/sh",
          args: ["-c", command, "capture-probe", staged],
          cwd: f.ossRoot,
          paths: [f.ossRoot],
          env: {},
          osRefusalIsOutcome: true,
        });
        expect(probe.status).not.toBe(0);
      }
    },
  );
  expect(checked).toBe(true);
  expect(result.sha256).toBe(sha256("public checker"));
});
