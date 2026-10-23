// What `src/harness/open.ts` resolves `@ana/agent-bundle` to when it bundles this fixture, stated for the
// typecheck, which has no bundler plugin.
declare module "@ana/agent-bundle" {
  export * from "#src/harness/shim.ts";
}
