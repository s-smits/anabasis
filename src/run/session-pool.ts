/**
 * Shared worker pool for paid sessions, with separate limits for Judge calls and Built solves.
 *
 * `mapWithConcurrencyLimit` keeps results in input order. An optional ordered callback may record
 * each completed result while later workers remain live; that lets the battery overlap host
 * grading with solves without changing its evidence order. `runJudgeBatches` adds the judge's
 * batch stop, allowing its caller to decide whether another Judge batch should run.
 *
 * Neither limit is a bare constant any more. The Built limit is an operator setting read from
 * `ANA_BUILT_CONCURRENCY`; the Judge limit is a default that `ANA_REVIEW_CONCURRENCY` or a judge
 * session declaring its own census width departs from, and it declares that once rather than per
 * call. Callers in one run otherwise share the same limits. They bound simultaneous work here; provider and campaign budgets
 * own total paid-call limits separately. The ordered callback may overlap processing a result with
 * later solves, while the pool still waits for started workers before returning or throwing.
 *
 * A concurrency limit does not establish an independent measurement condition by itself.
 */
export const JUDGE_MAX_CONCURRENCY = 5;

/** Built Harness cases solved at once by default. Lower than the judge width because a case is
 *  heavier: one Pi child, one generated-tool child and their Seatbelt wrappers per case, against a
 *  judge's single provider call. */
export const BUILT_SOLVE_MAX_CONCURRENCY = 3;

/**
 * A failing call ends the map with the first error, as a one-at-a-time loop would, but every call
 * already running is awaited first.
 *
 * Raising at the first rejection would hand the caller an error while its siblings were still
 * live, and nothing else reaps them: a worker settles only once its own children close
 * (`startPiBuiltWorker` settles on `close`, generated-tool cleanup is awaited). Two sibling solves
 * would keep paid model sessions open, keep writing into `cases/<taskId>/` after the runner had
 * abandoned the evidence log, and leave a Pi child, a generated-tool child and their Seatbelt
 * wrappers running — which the `process.once("exit")` bundle cleanup can then delete out from
 * under. So a worker records the failure rather than raising it, stops taking new inputs, and the
 * error is rethrown once every worker has finished.
 *
 * The error is chosen by input order rather than by the order in which failures completed. Two
 * cases failing in one round is ordinary — a provider outage takes every live case at once — and
 * the two orders disagree whenever the later input fails first. Recording the index makes the
 * raised error the one a serial run would have reached, so a rerun of the same battery reports the
 * same case rather than whichever child happened to exit first.
 */
/** A worker's rejection with the input index it came from. */
interface WorkerFailure {
  index: number;
  error: unknown;
}

/** The earliest-indexed worker failure, in a box because the worker that writes it is a closure
 *  and TypeScript narrows a plain `let` written only there to `null`. */
interface EarliestFailure {
  failure: WorkerFailure | null;
}

/** The Built case width that ran. The harness declares it in `agent/config.yaml`, because the
 *  harness is what knows how heavy one of its cases is and what the host has to run it on.
 *
 *  `ANA_BUILT_CONCURRENCY` still wins where it is set, because the width also spends the
 *  provider's session limit, which is the operator's to bound and not the harness's to see. The
 *  battery record states the width that actually ran. */
export function builtSolveConcurrency(
  declared: number = BUILT_SOLVE_MAX_CONCURRENCY,
  env: Record<string, string | undefined> = Bun.env,
): number {
  return operatorWidth("ANA_BUILT_CONCURRENCY", declared, env);
}

/** The Judge batch width: `ANA_REVIEW_CONCURRENCY` where the operator sets it, the default otherwise. */
export function reviewConcurrency(env: Record<string, string | undefined> = Bun.env): number {
  return operatorWidth("ANA_REVIEW_CONCURRENCY", JUDGE_MAX_CONCURRENCY, env);
}

function operatorWidth(name: string, fallback: number, env: Record<string, string | undefined>): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return Number(raw);
}

/** The settled hook's own throw, held until the ordered reader has finished, so a hook failure
 *  cannot cancel delivery that already has its results. */
function runSettledHook(hook: (() => void) | undefined): Pick<WorkerFailure, "error"> | null {
  try {
    hook?.();
    return null;
  } catch (error) {
    return { error };
  }
}

export async function mapWithConcurrencyLimit<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  invoke: (input: Input, index: number) => Promise<Output>,
  onOutput?: (output: Output, index: number) => Promise<void>,
  onWorkersSettled?: () => void,
): Promise<Output[]> {
  if (inputs.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, inputs.length));
  const outputs: Output[] = Array.from({ length: inputs.length });
  const settled = onOutput === undefined ? null : inputs.map(() => Promise.withResolvers<Output>());
  // A delivery failure stops the ordered reader while workers may still fail in flight. Mark each
  // deferred rejection handled here; the reader below still rethrows its first relevant failure.
  for (const result of settled ?? []) void result.promise.catch(() => {});
  let nextIndex = 0;
  let stopped = false;
  // The failure a serial run would have reached: kept by input order rather than by which child
  // exited first, so a rerun of the same battery reports the same case. Held in a box because the
  // worker that writes it is a closure, and TypeScript narrows a plain `let` here to `null`.
  const earliest: EarliestFailure = { failure: null };
  const workers = Array.from({ length: limit }, async () => {
    while (!stopped) {
      const current = nextIndex++;
      if (current >= inputs.length) return;
      try {
        const output = await invoke(
          /* SAFETY: the loop returned when the index reached the input length, so the read is inside the list. */ inputs[
            current
          ] as Input,
          current,
        );
        outputs[current] = output;
        settled?.[current]?.resolve(output);
      } catch (error) {
        if (earliest.failure === null || current < earliest.failure.index) {
          earliest.failure = { index: current, error };
        }
        settled?.[current]?.reject(error);
        stopped = true;
        return;
      }
    }
  });
  const delivered =
    settled === null || onOutput === undefined
      ? null
      : (async () => {
          for (const [index, result] of settled.entries()) await onOutput(await result.promise, index);
        })();
  if (delivered !== null) {
    void delivered.catch(() => {
      stopped = true;
    });
  }
  // No worker rejects, so this awaits every launched call instead of returning at the first one.
  await Promise.all(workers);
  const first = earliest.failure;
  if (first !== null) {
    // The delivery reader is still awaited, so its own rejection cannot outlive this call; the
    // worker's failure is the one raised, because it is what a serial run would have reached.
    await delivered?.catch(() => {});
    throw first.error;
  }
  // Every worker succeeded, so the settled hook runs before the ordered reader's own failure can
  // replace it: the hook closes what the workers opened, and the reader ran over their results.
  const settledFailure = runSettledHook(onWorkersSettled);
  await delivered;
  if (settledFailure !== null) throw settledFailure.error;
  return outputs;
}

export async function runJudgeBatches<Input, Output>(
  inputs: readonly Input[],
  invoke: (input: Input, index: number) => Promise<Output>,
  acceptBatch: (batch: readonly Output[]) => boolean,
  width: number = reviewConcurrency(),
): Promise<void> {
  const batchSize = Math.max(1, Math.min(Math.floor(width), inputs.length));
  for (let offset = 0; offset < inputs.length; offset += batchSize) {
    const batch = inputs.slice(offset, offset + batchSize);
    const results = await mapWithConcurrencyLimit(batch, batchSize, (input, index) =>
      invoke(input, offset + index),
    );
    if (!acceptBatch(results)) return;
  }
}
