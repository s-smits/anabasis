import { mkdirSync, readdirSync } from "../meta/filesystem.ts";
import { campaignRoot, productRoot } from "../meta/campaign-root.ts";
import { dirname, join } from "../meta/path.ts";
import { readCompleted, writeCompleted } from "../meta/completed-json.ts";

type ProjectEntry = {
  id: string;
  createdAt: string;
  /** Append-only request digests seen under this project: its revision trail. */
  requests: string[];
};

interface ProjectRegistry {
  schema: typeof REGISTRY_SCHEMA;
  projects: ProjectEntry[];
}

const REGISTRY_SCHEMA = "harness-projects/v1";

/** Under the campaign root rather than the checkout: run worktrees share one campaign tree, and a
 *  per-checkout registry would forget ids and hand them to unrelated runs. */
function registryPath(repoRoot: string): string {
  return join(campaignRoot(repoRoot), "projects.json");
}

function readProjectRegistry(repoRoot: string): ProjectRegistry {
  return (
    readCompleted<ProjectRegistry>(
      registryPath(repoRoot),
      REGISTRY_SCHEMA,
      "projects",
      "the controller owns project identity; repair this registry instead of deleting it",
    ) ?? { schema: REGISTRY_SCHEMA, projects: [] }
  );
}

export function recordProjectRequest(repoRoot: string, id: string, digest: string): void {
  const registry = readProjectRegistry(repoRoot);
  const entry = registry.projects.find((project) => project.id === id);
  if (entry?.requests.includes(digest) === true) return;
  const next =
    entry === undefined
      ? [...registry.projects, { id, createdAt: new Date().toISOString(), requests: [digest] }]
      : registry.projects.map((project) =>
          project.id === id ? { ...project, requests: [...project.requests, digest] } : project,
        );
  const file = registryPath(repoRoot);
  mkdirSync(dirname(file), { recursive: true });
  writeCompleted(file, { schema: REGISTRY_SCHEMA, projects: next });
}

/** Every project id on record: the registry, and the campaign and product trees, whose directories
 *  still name the projects launched while each worktree kept its own registry. A product tree
 *  outlives a campaign directory sent to the Trash, and a fresh id reusing it would open on that old
 *  product. An absent tree names none. */
export function recordedProjects(repoRoot: string): string[] {
  const registered = readProjectRegistry(repoRoot).projects.map((project) => project.id);
  const named = [campaignRoot(repoRoot), productRoot(repoRoot)].flatMap((root) => {
    try {
      const entries = readdirSync(root, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return [];
    }
  });
  return [...registered, ...named];
}
