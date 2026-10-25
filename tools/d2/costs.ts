/** Cost display shared by the closing report and whole-run reader. The production account owns
 *  every sum; this only labels its coverage, unknown totals and residual on matched closed work. */
import type { costAccounts } from "#src/kernel/trace.ts";

export function costLines({ closed, backend, missing, open }: ReturnType<typeof costAccounts>): string[] {
  const jobs = closed.count + open.count;
  const partial = backend.count < jobs;
  const known = partial ? "known subtotal" : "total";
  const amount = backend.subtotal === null ? "unknown" : `$${backend.subtotal.toFixed(8)}`;
  const residual =
    backend.residual === null
      ? "unknown"
      : `${backend.residual < 0 ? "-" : "+"}$${Math.abs(backend.residual).toFixed(8)}`;
  return [
    `Backend ${known} ${amount}${partial ? " (partial coverage)" : ""}; coverage ${String(backend.count)}/${String(closed.count)} closed records, ${String(backend.count)}/${String(jobs)} all jobs.`,
    `Closed calculated: $${closed.calculated.toFixed(8)} over ${String(closed.count)} records. Missing closed backend totals: ${String(missing.count)}, calculated $${missing.calculated.toFixed(8)}.`,
    `Open calculated usage: $${open.calculated.toFixed(8)} over ${String(open.count)} jobs; backend cost unknown for open work.`,
    `Matched residual (backend minus calculated): ${residual}; matched calculated $${backend.calculated.toFixed(8)}.`,
  ];
}
