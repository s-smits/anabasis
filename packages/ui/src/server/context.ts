/**
 * What every handler is given and may throw, apart from the router (`api.ts`), so that a handler
 * module and the router do not import each other.
 */
import type { AnswerOf, Endpoint, Query, Tier } from "../models.ts";

/** Where the campaigns are found: every worktree of the repository (`runs`, `tools/runs/registry.ts`),
 *  or one plain directory that holds `.ana/d2/<name>/log.jsonl`, a fixture's or another checkout's
 *  (`serve.ts --repo <dir>`). */
export type Trees = "worktrees" | "directory";

/** What a handler reads by: the repository or the directory that holds the campaigns, how they are
 *  found there, and the tier the server answers in, which decides what of the exam side an answer
 *  may carry. */
export interface Reading {
  readonly repo: string;
  readonly trees: Trees;
  readonly tier: Tier;
}

/** A handler: one endpoint's answer to one query, read from disk on every request. */
export type Handler<Name extends Endpoint> = (reading: Reading, query: Query<Name>) => AnswerOf<Name>;

/** A request a handler cannot answer as it was asked: an unknown campaign, move, solve, task or
 *  harness file, or a parameter it cannot read. The router answers with its status. */
export class Unanswerable extends Error {
  readonly status: 400 | 404;
  constructor(status: 400 | 404, message: string) {
    super(message);
    this.status = status;
  }
}
