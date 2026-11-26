---
name: delete-comment
description: "Audit code comments in a repository subtree, classify each as Tautology, Excuse, Stale, or Decision Record, take the matching action (delete, log/file issue, or move to docs/adr/), and tighten the per-file comment ratchet in tools/oxlint/comment-ratchet.tsv enforced by ana/no-comments."
---

# Delete comments and tighten the ratchet

`ana/no-comments` bans prose comments (`//`, `/* */`, and JSDoc `/** */`) outside machine-enforced markers (`SAFETY:` assertion justifications, `oxlint-disable`/`eslint-disable`/`biome-ignore`/`@ts-` directives, empty `catch` block comments, shebangs, and `no fix` declarations in `tools/oxlint/*/rules/*.ts`). Files absent from `tools/oxlint/comment-ratchet.tsv` stay locked at zero; listed files carry a per-file ceiling that strict lint rejects both when exceeded and when left stale after deletions.

## 1. Pick a target subtree

Inspect remaining comments and sheddable lines across the tree:

```sh
bun .claude/skills/delete-comment/scripts/ratchet.ts
```

List every non-exempt comment in the subtree you intend to clean (for example `tools/runs/` or `packages/ui/`):

```sh
bun .claude/skills/delete-comment/scripts/ratchet.ts --list <prefix>
```

Skip `vendor/` (ignored by `.oxlintrc.json`; governed by `AGENTS.md` §11 verbatim upstream provenance).

## 2. Categorise every non-exempt comment

Read each comment in context and assign exactly one category:

| Category | Definition | Required action |
| --- | --- | --- |
| **Tautology** | Repeats what the symbol name, type signature, or adjacent code already states | Delete the comment |
| **Stale** | Cites retired versions, v1 history, deleted files, or behaviour no longer present | Delete the comment |
| **Excuse** | Justifies a hack, private upstream mirror, misleading filename, or compatibility shim | Delete the comment and add an actionable entry to `docs/backlog/comment-excuses.md` (or file a GitHub issue when asked) |
| **Decision Record** | Captures a non-obvious architectural, statistical, security, or evaluation-wall constraint | Move the rationale into `docs/adr/NNNN-<slug>.md` (indexed in `docs/adr/README.md`) and delete the inline comment |

Never delete machine-enforced comments (`SAFETY:`, core-rule `oxlint-disable`, empty `catch` explanations, shebangs, or `no fix` rule headers). Collapse any multi-line `// SAFETY:` note onto a single comment so continuation lines are not orphaned.

## 3. Clean, tighten the ratchet, and verify

1. Delete the audited comments and run `bun fmt <prefix>`.
2. Tighten the ratchet (refuses to raise any existing ceiling):
   ```sh
   bun .claude/skills/delete-comment/scripts/ratchet.ts --write
   ```
3. Run the verification suite:
   ```sh
   bun run typecheck
   bun run lint -- --strict
   bun tools/loc/source-policy.ts
   bun run test -- test/lint-registry.test.ts test/rule-examples.test.ts
   ```
   Check `source-policy.ts` output carefully: removing comments can expose exports whose only remaining mention was inside a comment (`unused-export`). Drop the `export` keyword on any genuinely unused symbol.
4. Keep ADRs and backlog entries free of stale backticked paths (`tree/no-stale-reference`) and written in plain, timeless prose (`AGENTS.md` §13).
