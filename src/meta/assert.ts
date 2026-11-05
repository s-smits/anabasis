/** Bun 1.4 has no standalone standards assertion module; retained Node-style assertions load here. */
// oxlint-disable-next-line import/no-default-export -- `node:assert/strict`'s default export, re-exported so a default import has its one route through src/meta (`ana/require-meta-runtime-import`)
export { default } from "node:assert/strict";
