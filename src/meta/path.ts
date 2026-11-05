/**
 * Shared filesystem-path compatibility exports. Bun 1.4 has no path normalisation,
 * containment or platform-separator API with Node's contract, so security-sensitive callers retain
 * the exact implementation here rather than substituting string concatenation.
 */
// oxlint-disable-next-line import/no-default-export -- `node:path`'s default export, re-exported so a default import has its one route through src/meta (`ana/require-meta-runtime-import`)
export { default } from "node:path";
export {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  parse,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
