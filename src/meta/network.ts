/**
 * Network compatibility for IP classification and the private-range block list.
 *
 * Bun 1.4 has no CIDR block list: nothing holds a set of ranges to test an address against. That
 * one export is the whole remaining gap. Address family comes from `Bun.dns.lookup`, which answers
 * a literal locally, so no string classifier is needed; the mediated HTTPS fetch moved to
 * `fetch`, and the loopback fixtures moved to `Bun.listen`.
 */
export { BlockList } from "node:net";
