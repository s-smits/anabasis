/** Shared task-id scan for the censoring and leak checks. It keeps substring matching:
 *  `task-901-fix` identifies task-901 even through the joining hyphen, and a false positive there
 *  only replaces text with a fallback or records a non-result. Only ids below the minimum length are
 *  skipped — a one-character id such as `a` matches ordinary English words, and the bare `includes`
 *  this replaced matched ordinary sentences whenever a battery held a task called `a`. */
export const MIN_SCANNABLE_TASK_ID = 2;

export function mentionsTask(text: string, taskId: string): boolean {
  return taskId.length >= MIN_SCANNABLE_TASK_ID && text.includes(taskId);
}
