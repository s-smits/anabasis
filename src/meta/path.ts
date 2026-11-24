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
