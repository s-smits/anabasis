/**
 * Network compatibility for the private-range block list.
 *
 * Bun 1.4 has no CIDR block list: nothing in it holds a set of ranges to test an address against,
 * which is exactly what `public-source.ts` needs to refuse a resolved address that is not public.
 * That one export is the whole remaining gap. Address family arrives from `Bun.dns.lookup` beside
 * the address itself, so no string classifier is needed here.
 */
export { BlockList } from "node:net";
