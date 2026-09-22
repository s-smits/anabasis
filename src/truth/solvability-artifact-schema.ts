/** Submission-schema checks shared by every reference artifact in the F2 census. */
import {
  type PublicArtifactSchema,
  compilePublicArtifactSchema,
  publicArtifactSchemaFindings,
} from "../solve/public-artifact-schema.ts";
import type { Brief, ContractFinding } from "./brief.ts";
import { validateAcceptControls } from "./controls.ts";
import {
  trustedExistsSync as existsSync,
  trustedJoin as join,
  trustedReadFileSync as readFileSync,
} from "./trusted-runtime.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { type JsonValue, isObject } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { CONTROLS_FILE } from "../meta/bundle-layout.ts";

type SolvabilityPublicSchemaLoad =
  | { ok: true; schema: PublicArtifactSchema | null }
  | { ok: false; finding: ContractFinding };

/** Compile the exact public schema that submit will enforce from the recorded accept corpus. */
export function loadSolvabilityPublicSchema(
  bundleSnapshotDir: string,
  artifactSchema: Brief["artifactSchema"],
): SolvabilityPublicSchemaLoad {
  const controlsPath = join(bundleSnapshotDir, CONTROLS_FILE);
  if (!existsSync(controlsPath)) return { ok: true, schema: null };
  try {
    const controls = parseJsonAs<{
      accept?: { artifact: JsonValue }[];
    }>(readFileSync(controlsPath, "utf8"));
    const accepts = Array.isArray(controls.accept) ? controls.accept.map((row) => row.artifact) : [];
    return {
      ok: true,
      schema: accepts.length === 0 ? null : compilePublicArtifactSchema(artifactSchema, accepts),
    };
  } catch (error) {
    return {
      ok: false,
      finding: {
        code: "solvability-public-schema-invalid",
        path: CONTROLS_FILE,
        detail: `the public submission schema cannot be compiled from the recorded accept corpus: ${errorMessage(error)}`,
      },
    };
  }
}

function reservedFieldPaths(value: JsonValue, path = "$", out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => reservedFieldPaths(item, `${path}[${index}]`, out));
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(
      /* SAFETY: reached only when `isObject(value)`. */ value as Record<string, JsonValue>,
    )) {
      const childPath = `${path}.${key}`;
      if (key.startsWith("__")) out.push(childPath);
      reservedFieldPaths(child, childPath, out);
    }
  }
  return out;
}

/** Return the first public-contract reason this reference artifact cannot enter submission. */
export function referenceArtifactSchemaError(
  schema: PublicArtifactSchema | null,
  artifactSchema: Brief["artifactSchema"],
  taskId: string,
  artifact: JsonValue,
): string | null {
  const reserved = reservedFieldPaths(artifact);
  if (reserved.length > 0) {
    return `reserved internal field(s) [${reserved.join(", ")}] — solver provenance must not reach evaluate`;
  }
  const roots = validateAcceptControls(
    [{ id: `solvability-${taskId}`, taskId, artifact, authoredBy: "reference-solver" }],
    artifactSchema,
  );
  if (!roots.ok) return roots.findings.map((finding) => finding.detail).join("; ");
  const issues = schema === null ? [] : publicArtifactSchemaFindings(schema, artifact);
  if (issues.length === 0) return null;
  const shown = issues
    .slice(0, 3)
    .map((issue) => `${issue.path}: expected ${issue.expected}, got ${issue.actual}`)
    .join("; ");
  return `reference artifact violates the compiled public submission schema: ${shown}${issues.length > 3 ? `; +${String(issues.length - 3)} more` : ""}`;
}
