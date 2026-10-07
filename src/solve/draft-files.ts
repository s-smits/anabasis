/**
 * Optional file-shaped view over the one DraftStore. Pi owns the read/write/edit behaviour; this
 * file supplies only the file access those tools are handed, as their Operations. There is no host
 * filesystem and no second mutable workspace.
 */
import { posix } from "../meta/path.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { createEditTool, type EditOperations } from "../../vendor/pi-coding-agent/core/tools/edit.ts";
import { createReadTool, type ReadOperations } from "../../vendor/pi-coding-agent/core/tools/read.ts";
import { createWriteTool, type WriteOperations } from "../../vendor/pi-coding-agent/core/tools/write.ts";
import { type DraftStore, preparedArtifactJson } from "./draft-store.ts";
import { fileMapIssues } from "./file-map.ts";
import { childPath } from "./public-artifact-validate.ts";
import type { PublicArtifactSchema } from "./public-artifact-schema.ts";
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

/** The same rule in report form: candidate validation surfaces the message as a finding and the
 *  worker starter as a typed non-result, so neither has to crash at its own boundary to say the
 *  schema has no file root. */
export function fileArtifactRootIssue(schema: PublicArtifactSchema): string | null {
  try {
    fileArtifactRoot(schema);
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

/** A refusal from the draft's file access. Pi's edit tool reports a failed access check as
 *  "Error code: <code>", so the code is the part a solver reads there. */
class DraftFileError extends Error {
  constructor(
    readonly code: "invalid" | "permission_denied" | "not_found" | "is_directory" | "not_directory",
    message: string,
  ) {
    super(message);
  }
}

/** The draft-relative name of a path Pi resolved against the root, or a refusal. */
function relativeTo(path: string): string {
  if (path.includes("\0") || path.includes("\\")) {
    throw new DraftFileError("invalid", "draft file paths must be POSIX paths");
  }
  const relative = posix.relative(ROOT, posix.resolve(ROOT, path));
  if (relative === ".." || relative.startsWith("../") || posix.isAbsolute(relative)) {
    throw new DraftFileError("permission_denied", `${path} leaves the DraftStore file root`);
  }
  return relative;
}

function namespaceFailure(relative: string, files: DraftFiles): DraftFileError | null {
  if (relative === "" || Object.keys(files).some((file) => file.startsWith(`${relative}/`))) {
    return new DraftFileError("is_directory", `${posix.join(ROOT, relative)} is a draft directory`);
  }
  const parts = relative.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const ancestor = parts.slice(0, index).join("/");
    if (Object.hasOwn(files, ancestor)) {
      return new DraftFileError("not_directory", `${posix.join(ROOT, ancestor)} is a draft file`);
    }
  }
  return null;
}

/** Pi's file access for read, write and edit, over the one DraftStore. Directories exist only as
 *  file-name prefixes, so `mkdir` checks the path and creates nothing. */
function draftOperations(
  draft: DraftStore,
  artifactRoot: string,
): ReadOperations & WriteOperations & EditOperations {
  const content = (path: string): string => {
    const relative = relativeTo(path);
    const text = draft.getFile(relative);
    if (text !== undefined) return text;
    throw (
      namespaceFailure(relative, draft.fileSnapshot()) ??
      new DraftFileError("not_found", `${path} does not exist`)
    );
  };
  return {
    access: async (path) => {
      content(path);
    },
    readFile: async (path) => Buffer.from(content(path), "utf8"),
    mkdir: async (dir) => {
      relativeTo(dir);
    },
    writeFile: async (path, text) => {
      const relative = relativeTo(path);
      const conflict = namespaceFailure(relative, draft.fileSnapshot());
      if (conflict) throw conflict;
      const files = { ...draft.fileSnapshot(), [relative]: text };
      const issue = fileMapIssues(files, artifactRoot, childPath)[0];
      if (issue) {
        throw new DraftFileError("invalid", `${issue.path}: expected ${issue.expected}, got ${issue.actual}`);
      }
      preparedArtifactJson({ [artifactRoot]: files });
      draft.setFile(relative, text);
    },
  };
}

/** A read that cuts a single over-long line points at bash, which this preset does not have. */
function withoutBashAdvice(tool: AgentTool): AgentTool {
  return {
    ...tool,
    execute: async (id, params, signal, onUpdate) => {
      const result = await tool.execute(id, params, signal, onUpdate);
      const details =
        /* SAFETY: the read tool's details carry an optional truncation report; every field is read through an optional chain below. */ result.details as
          | { truncation?: { firstLineExceedsLimit?: boolean } }
          | undefined;
      if (details?.truncation?.firstLineExceedsLimit !== true) return result;
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

/** Pi's own tools, handed the DraftStore as their file system. The shell is absent here on
 *  purpose: it needs a real directory and a real process, which this confined worker cannot host,
 *  so it is a controller tool instead (`built-bash.ts`) and exchanges the file map over the
 *  protocol. */
export function createDraftFileTools(draft: DraftStore, schema: PublicArtifactSchema): AgentTool[] {
  const artifactRoot = fileArtifactRoot(schema);
  const operations = draftOperations(draft, artifactRoot);
  const materialize = (toolName: string, callId: string): void => {
    draft.setArtifact({ [artifactRoot]: draft.fileSnapshot() }, toolName, callId);
  };
  const place = (tool: AgentTool): AgentTool => ({
    ...tool,
    description:
      `${tool.description} Paths stay inside the draft file root, which is the answer's ` +
      `\`${artifactRoot}\` itself: name a file inside it without a leading \`${artifactRoot}/\`. ` +
      `The shell shows the same file at \`${artifactRoot}/<name>\`.`,
    executionMode: tool.name === "read" ? "parallel" : "sequential",
  });
  const mutating = (tool: AgentTool): AgentTool => ({
    ...tool,
    execute: async (id, params, signal, onUpdate) => {
      const before = draft.seq;
      const result = await tool.execute(id, params, signal, onUpdate);
      if (draft.seq !== before) materialize(tool.name, id);
      return result;
    },
  });
  return [
    place(withoutBashAdvice(createReadTool(ROOT, { operations }))),
    place(mutating(createWriteTool(ROOT, { operations }))),
    place(mutating(createEditTool(ROOT, { operations }))),
    {
      name: "materialize_files",
      label: "Materialize files",
      description: "Prepare the current draft files as the answer, including an empty draft.",
      parameters: Type.Object({}),
      executionMode: "sequential",
      execute: async (callId) => {
        materialize("materialize_files", callId);
        return {
          content: [{ type: "text", text: "Materialized the current draft files." }],
          details: null,
        };
      },
    },
  ];
}
