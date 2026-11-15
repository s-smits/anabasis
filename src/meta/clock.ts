/** The clock's units in milliseconds, once for the nineteen modules that each declared their own;
 *  a limit of its own (`QUIET_MS`, `LOOK_MS`) stays with the module that decides it. */
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
