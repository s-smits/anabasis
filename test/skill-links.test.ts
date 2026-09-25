// A skill is found by its directory name, so the directory, the SKILL.md inside it and that file's
// frontmatter `name` all have to agree. A directory with no SKILL.md, or one whose frontmatter has
// drifted from its directory, is named here rather than discovered by whoever next tried to load
// it.
//
// The other two cases are about references going stale rather than wrong. Every relative Markdown
// link under .claude/skills has to resolve, and every `.claude/skills/<name>/` path spelled in
// AGENTS.md, in notes/current-state.md when that file is present, and in any `.ts` or `.js` file
// directly under test/, has to name a directory that exists. A renamed skill leaves both kinds of
// reference reading perfectly well and pointing at nothing.
import { existsSync, readdirSync, readFileSync, statSync } from "../src/meta/filesystem.ts";
import { dirname, join, normalize, relative } from "../src/meta/path.ts";

import { expect, test } from "bun:test";

const repoRoot = normalize(join(import.meta.dir, ".."));
const skillsRoot = join(repoRoot, ".claude", "skills");
// `main` is the library every skill script imports from, not a skill, so it carries no SKILL.md.
const LIBRARY_DIR = "main";
const skillPathPattern = /\.claude\/skills\/([a-z0-9-]+)\//g;
const linkPattern = /\]\(([^)\s#]+)(?:#[^)]*)?\)/g;

function markdownFilesUnder(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) found.push(...markdownFilesUnder(path));
    else if (entry.endsWith(".md")) found.push(path);
  }
  return found;
}

function skillDirectories(): string[] {
  return readdirSync(skillsRoot)
    .filter((entry) => entry !== LIBRARY_DIR && statSync(join(skillsRoot, entry)).isDirectory())
    .sort();
}

function frontmatterName(skillFile: string): string | null {
  const text = readFileSync(skillFile, "utf8");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const match = /^name:\s*"?([^"\n]+)"?\s*$/m.exec(text.slice(4, end));
  const name = match?.[1];
  return name === undefined ? null : name.trim();
}

function brokenLinksIn(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const broken: string[] = [];
  for (const match of text.matchAll(linkPattern)) {
    const target = match[1];
    if (target === undefined || /^[a-z][a-z0-9+.-]*:/.test(target) || target.startsWith("/")) continue;
    if (!existsSync(normalize(join(dirname(file), target)))) {
      broken.push(`${relative(repoRoot, file)} -> ${target}`);
    }
  }
  return broken;
}

function missingSkillMentionsIn(file: string, existing: ReadonlySet<string>): string[] {
  const text = readFileSync(file, "utf8");
  const missing: string[] = [];
  for (const match of text.matchAll(skillPathPattern)) {
    const name = match[1];
    if (name !== undefined && !existing.has(name)) {
      missing.push(`${relative(repoRoot, file)} names .claude/skills/${name}/`);
    }
  }
  return missing;
}

test("every skill directory holds a SKILL.md whose frontmatter name is the directory name", () => {
  const mismatches: string[] = [];
  for (const dir of skillDirectories()) {
    const skillFile = join(skillsRoot, dir, "SKILL.md");
    if (!existsSync(skillFile)) {
      mismatches.push(`${dir}: no SKILL.md`);
      continue;
    }
    const name = frontmatterName(skillFile);
    if (name !== dir) mismatches.push(`${dir}: frontmatter name ${JSON.stringify(name)}`);
  }
  expect(mismatches).toEqual([]);
});

test("every relative Markdown link under .claude/skills resolves", () => {
  const broken = markdownFilesUnder(skillsRoot).flatMap(brokenLinksIn);
  expect(broken).toEqual([]);
});

test("every .claude/skills/<name>/ path named by AGENTS.md, the state snapshot and test/ exists", () => {
  const existing = new Set([...skillDirectories(), LIBRARY_DIR]);
  const files = [join(repoRoot, "AGENTS.md"), join(repoRoot, "notes", "current-state.md")].filter(existsSync);
  for (const entry of readdirSync(join(repoRoot, "test"))) {
    if (entry.endsWith(".ts") || entry.endsWith(".js")) files.push(join(repoRoot, "test", entry));
  }
  const missing = files.flatMap((file) => missingSkillMentionsIn(file, existing));
  expect(missing).toEqual([]);
});
