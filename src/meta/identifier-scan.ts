/**
 * Shared task-id scan for text-access checks. A plain `includes` matches `t1` inside `t12` or
 * `slot-t1x`, and then withholds or redacts text over a task the author never named; a
 * one-character id such as `a` matches ordinary English words as well. Checking identifier
 * boundaries separates `t1` from the longer ids, and skipping ids below the minimum length keeps
 * articles from reading as task references — no boundary can tell the task `a` from the article.
 * Two-letter ids that are also words, `of` among them, stay scannable and may still match prose;
 * the candidate check lists every id it matched in its finding, so the Builder can see which name
 * to make less ambiguous.
 */
const IDENTIFIER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-";
export const MIN_SCANNABLE_TASK_ID = 2;

function bounded(char: string | undefined): boolean {
  return char === undefined || !IDENTIFIER_CHARS.includes(char);
}

/** The boundary-checked match, used where a false positive refuses the Builder's work: the
 *  candidate check reads the operating guide with it, and a guide that names no task must not be
 *  refused because one id happened to sit inside a longer word. */
export function namesTask(text: string, taskId: string): boolean {
  if (taskId.length < MIN_SCANNABLE_TASK_ID) return false;
  for (let at = text.indexOf(taskId); at !== -1; at = text.indexOf(taskId, at + 1)) {
    if (bounded(text[at - 1]) && bounded(text[at + taskId.length])) return true;
  }
  return false;
}

/** Censoring and leak checks keep substring matching: `task-901-fix` identifies task-901 even
 *  through the joining hyphen, and a false positive there only replaces text with a fallback or
 *  records a non-result. Only ids below the minimum length are skipped — the bare `includes` this
 *  replaced matched ordinary sentences whenever a battery held a task called `a`. */
export function mentionsTask(text: string, taskId: string): boolean {
  return taskId.length >= MIN_SCANNABLE_TASK_ID && text.includes(taskId);
}
