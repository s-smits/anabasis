/**
 * Shared task-id scan for text-access checks. Identifier boundaries keep `t1` from matching inside
 * `t12` or `slot-t1x`, and ids shorter than the minimum are skipped because a task `a` is
 * indistinguishable from the article. Two-letter word ids such as `of` may still match prose.
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

/** Substring match for censoring and leak checks, where `task-901-fix` names task-901 and a false
 *  positive only costs a fallback. Ids below the minimum length are skipped. */
export function mentionsTask(text: string, taskId: string): boolean {
  return taskId.length >= MIN_SCANNABLE_TASK_ID && text.includes(taskId);
}
