/**
 * The clock's units in milliseconds, which a log's `at` and every host deadline are counted in.
 *
 * Nineteen modules each declared an hour, a day or a minute for themselves, some as `HOUR` and some
 * as `HOUR_MS`; a reader that divides one module's span by another's unit has nothing to check the
 * two against. A limit of its own (`QUIET_MS`, `LOOK_MS`) stays with the module that decides it.
 */
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
