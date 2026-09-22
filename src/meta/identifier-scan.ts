/**
 * Shared task-id scan for text-access checks. A plain `includes` can match `t1` inside `t12`
 * or `slot-t1x`, unnecessarily withholding or redacting text. A one-character id such as `a`
 * also matches ordinary English words. Checking identifier boundaries distinguishes `t1`
 * from longer ids, while skipping ids shorter than the minimum avoids treating articles as
 * task references. Even word boundaries cannot distinguish the task `a` from the article.
 * Two-letter ids that are words, such as `of`, remain scannable and may match ordinary prose.
 * The candidate check reports the id in its finding so the Builder can choose a less
 * ambiguous task name.
 */
const IDENTIFIER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-";
export const MIN_SCANNABLE_TASK_ID = 2;

function bounded(char: string | undefined): boolean {
  return char === undefined || !IDENTIFIER_CHARS.includes(char);
}

export function namesTask(text: string, taskId: string): boolean {
  if (taskId.length < MIN_SCANNABLE_TASK_ID) return false;
  for (let at = text.indexOf(taskId); at !== -1; at = text.indexOf(taskId, at + 1)) {
    if (bounded(text[at - 1]) && bounded(text[at + taskId.length])) return true;
  }
  return false;
}

/** Censoring and leak checks retain substring matching: `task-901-fix` identifies task-901
 *  even with the joining hyphen. A false positive replaces text with a fallback or records
 *  a non-result. Skip only ids below the minimum length; the former bare `includes` matched
 *  ordinary sentences whenever a battery contained a task called `a`. */
export function mentionsTask(text: string, taskId: string): boolean {
  return taskId.length >= MIN_SCANNABLE_TASK_ID && text.includes(taskId);
}
