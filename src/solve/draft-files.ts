/**
 * Optional file-shaped view over the one DraftStore. Pi owns the read/write/edit behaviour;
 * this file supplies only its ExecutionEnv and binds the harness-tool context to the existing
 * AgentTool runtime. There is no host filesystem and no second mutable workspace.
 */
import { posix } from "../meta/path.ts";
import {
  type AgentHarnessTool,
  type AgentTool,
  type ExecutionEnv,
  ExecutionError,
  type ExecutionToolContext,
  FileError,
  type FileInfo,
  type Result,
  createEditTool,
  createReadTool,
  createWriteTool,
  err,
  ok,
} from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { executePiTool } from "./pi-tool-call.ts";
import { type DraftStore, preparedArtifactJson } from "./draft-store.ts";
import { fileMapIssues } from "./file-map.ts";
import { childPath } from "./public-artifact-validate.ts";
import type { PublicArtifactSchema } from "./public-artifact-schema.ts";
import { isString } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";

const ROOT = "/draft";

type DraftFiles = Record<string, string>;

function fileNodeCompatible(node: PublicArtifactSchema["root"]["properties"][string] | undefined): boolean {
  return (
    node?.kind === "file-map" ||
    node?.kind === "object" ||
    node?.kind === "any-json" ||
    (node?.kind === "union" && node.anyOf.every(fileNodeCompatible))
  );
}

export function fileArtifactRoot(schema: PublicArtifactSchema): string {
  const roots = Object.keys(schema.root.properties);
  if (roots.length !== 1) {
    throw new Error(`the files preset requires one public artifact root, got [${roots.join(", ")}]`);
  }
  const root =
    /* SAFETY: the check above returned when `roots.length !== 1`, so index 0 exists. */ roots[0] as string;
  const node = schema.root.properties[root];
  if (!fileNodeCompatible(node)) {
    throw new Error(
      `the files preset requires an object-shaped public artifact root, got ${node?.kind ?? "missing"}`,
    );
  }
  return root;
}

/** `fileArtifactRoot`'s rule as a message, or null when the schema satisfies it. */
export function fileArtifactRootIssue(schema: PublicArtifactSchema): string | null {
  try {
    fileArtifactRoot(schema);
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

function addressed(path: string): Result<{ absolute: string; relative: string }, FileError> {
  if (path.includes("\0") || path.includes("\\")) {
    return err(new FileError("invalid", "draft file paths must be POSIX paths", path));
  }
  const absolute = posix.isAbsolute(path) ? posix.normalize(path) : posix.resolve(ROOT, path);
  const relative = posix.relative(ROOT, absolute);
  if (relative === ".." || relative.startsWith("../") || posix.isAbsolute(relative)) {
    return err(new FileError("permission_denied", "path leaves the DraftStore file root", absolute));
  }
  return ok({ absolute, relative });
}

function aborted(context: Context): FileError | null {
  return context.abortSignal?.aborted === true ? new FileError("aborted", "operation aborted") : null;
}

function fileFailure<T>(cause: unknown, path?: string): Result<T, FileError> {
  if (cause instanceof FileError) return err(cause);
  return err(new FileError("unknown", errorMessage(cause), path));
}

function namespaceFailure(relative: string, files: DraftFiles): FileError | null {
  if (Object.keys(files).some((file) => file.startsWith(`${relative}/`))) {
    return new FileError("is_directory", "draft path is already a directory", posix.join(ROOT, relative));
  }
  const parts = relative.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const ancestor = parts.slice(0, index).join("/");
    if (Object.hasOwn(files, ancestor)) {
      return new FileError("not_directory", "a draft path ancestor is a file", posix.join(ROOT, ancestor));
    }
  }
  return null;
}

/** A member the draft root has no meaning for, refused as the typed result Pi's contract asks for. */
async function unsupported(member: string): Promise<Result<never, FileError>> {
  return err(new FileError("not_supported", `the draft file root has no ${member}`));
}

/** Pi's read, write and edit tools reach only the members with bodies below; the rest refuse as
 *  typed results, so a member Pi adds to `ExecutionEnv` fails the compile here. */
class DraftExecutionEnv implements ExecutionEnv {
  readonly cwd = ROOT;
  readonly artifactRoot: string;
  readonly joinPath = () => unsupported("joinPath");
  readonly openTextLineReader = () => unsupported("openTextLineReader");
  readonly readTextLines = () => unsupported("readTextLines");
  readonly appendFile = () => unsupported("appendFile");
  readonly renameFile = () => unsupported("renameFile");
  readonly listDir = () => unsupported("listDir");
  readonly createDir = () => unsupported("createDir");
  readonly remove = () => unsupported("remove");
  readonly createTempDir = () => unsupported("createTempDir");
  readonly createTempFile = () => unsupported("createTempFile");
  readonly exec = async () =>
    err<never, ExecutionError>(new ExecutionError("shell_unavailable", "the draft file root has no shell"));
  readonly cleanup = async (): Promise<void> => {};

  constructor(
    private readonly draft: DraftStore,
    schema: PublicArtifactSchema,
  ) {
    this.artifactRoot = fileArtifactRoot(schema);
  }

  async absolutePath(path: string, context: Context): Promise<Result<string, FileError>> {
    const stopped = aborted(context);
    if (stopped) return err(stopped);
    const result = addressed(path);
    return result.ok ? ok(result.value.absolute) : result;
  }

  async readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    const stopped = aborted(context);
    if (stopped) return err(stopped);
    const result = addressed(path);
    if (!result.ok) return result;
    const content = this.draft.getFile(result.value.relative);
    return content === undefined
      ? err(new FileError("not_found", "draft file does not exist", result.value.absolute))
      : ok(content);
  }

  async readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>> {
    const result = await this.readTextFile(path, context);
    return result.ok ? ok(new TextEncoder().encode(result.value)) : result;
  }

  async writeFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
    const stopped = aborted(context);
    if (stopped) return err(stopped);
    const result = addressed(path);
    if (!result.ok) return result;
    if (result.value.relative === "") {
      return err(new FileError("is_directory", "the draft root is a directory", result.value.absolute));
    }
    try {
      const conflict = namespaceFailure(result.value.relative, this.draft.fileSnapshot());
      if (conflict) return err(conflict);
      const text = isString(content) ? content : new TextDecoder("utf-8", { fatal: true }).decode(content);
      const files = { ...this.draft.fileSnapshot(), [result.value.relative]: text };
      const issue = fileMapIssues(files, this.artifactRoot, childPath)[0];
      if (issue) {
        return err(
          new FileError(
            "invalid",
            `${issue.path}: expected ${issue.expected}, got ${issue.actual}`,
            result.value.absolute,
          ),
        );
      }
      preparedArtifactJson({ [this.artifactRoot]: files });
      this.draft.setFile(result.value.relative, text);
      return ok(undefined);
    } catch (error) {
      return fileFailure(error, result.value.absolute);
    }
  }

  async fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>> {
    const stopped = aborted(context);
    if (stopped) return err(stopped);
    const result = addressed(path);
    if (!result.ok) return result;
    try {
      const files = this.draft.fileSnapshot();
      const content = files[result.value.relative];
      if (content !== undefined) {
        return ok({
          name: posix.basename(result.value.absolute),
          path: result.value.absolute,
          kind: "file",
          size: new TextEncoder().encode(content).byteLength,
          mtimeMs: 0,
        });
      }
      const prefix = result.value.relative === "" ? "" : `${result.value.relative}/`;
      if (result.value.relative === "" || Object.keys(files).some((file) => file.startsWith(prefix))) {
        return ok({
          name: posix.basename(result.value.absolute),
          path: result.value.absolute,
          kind: "directory",
          size: 0,
          mtimeMs: 0,
        });
      }
      return err(new FileError("not_found", "draft path does not exist", result.value.absolute));
    } catch (error) {
      return fileFailure(error, result.value.absolute);
    }
  }

  async canonicalPath(path: string, context: Context): Promise<Result<string, FileError>> {
    const info = await this.fileInfo(path, context);
    return info.ok ? ok(info.value.path) : info;
  }

  async exists(path: string, context: Context): Promise<Result<boolean, FileError>> {
    const info = await this.fileInfo(path, context);
    return info.ok ? ok(true) : info.error.code === "not_found" ? ok(false) : info;
  }

  get seq(): number {
    return this.draft.seq;
  }

  materialize(toolName: string, callId: string): void {
    this.draft.setArtifact({ [this.artifactRoot]: this.draft.fileSnapshot() }, toolName, callId);
  }
}

function bind(tool: AgentHarnessTool<ExecutionToolContext>, env: DraftExecutionEnv): AgentTool {
  return {
    ...tool,
    description:
      `${tool.description} Paths stay inside the draft file root, which is the answer's ` +
      `\`${env.artifactRoot}\` itself: name a file inside it without a leading \`${env.artifactRoot}/\`. ` +
      `The shell shows the same file at \`${env.artifactRoot}/<name>\`.`,
    executionMode: tool.name === "read" ? "parallel" : "sequential",
    execute: async (id, params, signal, onUpdate) => {
      const before = env.seq;
      const result = await executePiTool(tool, id, params, {
        signal,
        onUpdate,
        environment: { env },
      });
      if (tool.name !== "read" && env.seq !== before) env.materialize(tool.name, id);
      const details =
        /* SAFETY: the read tool's details carry an optional truncation report; every field is read through an optional chain below. */ result.details as
          | { truncation?: { firstLineExceedsLimit?: boolean } }
          | null
          | undefined;
      if (tool.name !== "read" || details?.truncation?.firstLineExceedsLimit !== true) return result;
      return {
        ...result,
        content: result.content.map((part) =>
          part.type === "text"
            ? {
                ...part,
                text: part.text.replace(
                  /Use bash: [^\]]+/,
                  "Use write to replace the file with shorter lines, then read it again",
                ),
              }
            : part,
        ),
      };
    },
  };
}

/** Pi's own tools, bound to one DraftStore-backed ExecutionEnv. The shell needs a real directory and
 *  process, so it is a controller tool instead (`built-bash.ts`). */
export function createDraftFileTools(draft: DraftStore, schema: PublicArtifactSchema): AgentTool[] {
  const env = new DraftExecutionEnv(draft, schema);
  return [
    ...[createReadTool(), createWriteTool(), createEditTool()].map((tool) => bind(tool, env)),
    {
      name: "materialize_files",
      label: "Materialize files",
      description: "Prepare the current draft files as the answer, including an empty draft.",
      parameters: Type.Object({}),
      executionMode: "sequential",
      execute: async (callId) => {
        env.materialize("materialize_files", callId);
        return {
          content: [{ type: "text", text: "Materialized the current draft files." }],
          details: null,
        };
      },
    },
  ];
}
