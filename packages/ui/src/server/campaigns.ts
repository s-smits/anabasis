/**
 * `GET /api/campaigns`: every campaign the server finds (`logs.ts`), one row each, newest first.
 *
 * The project is the one the campaign's opening names, or `NO_PROJECT` (`reading.ts`). Running is a
 * process that writes the log (`writers`,
 * `tools/runs/registry.ts`). Newest first is by the time of a log's first event. A log that cannot be
 * read is an issue beside the rows, never a missing row without a word.
 *
 * The list keeps each log's facts (`factsIn`), never its events, at the log's size and time
 * (`stampOf`), and forgets a log the listing no longer finds, a retired campaign's: until
 * 4 November the list kept every log's events, 3.7 GB in a server up four days (`logs.ts`).
 */
import type { CampaignList, CampaignRow, Issue, Query } from "../models.ts";
import { errorMessage } from "../../../../src/meta/runtime-values.ts";
import type { Reading } from "./context.ts";
import { campaignsFound, type Found, loaded, sourceOf, stampOf, writing } from "./logs.ts";
import { campaignRow, factsIn } from "./reading.ts";

/** A log's facts as the list last read them, at its stamp, or null with why it could not. */
interface Listed {
  readonly stamp: string | null;
  readonly facts: ReturnType<typeof factsIn> | null;
  readonly issues: readonly Issue[];
}

const listed = new Map<string, Listed>();

/** `found`'s facts, read again only where its stamp moved; whether they were. */
function factsOf(found: Found): { readonly read: boolean; readonly listing: Listed } {
  const stamp = stampOf(found);
  const was = listed.get(found.path);
  if (was !== undefined && stamp !== null && was.stamp === stamp) return { read: false, listing: was };
  const { log, issues } = loaded(found, false);
  let listing: Listed;
  try {
    listing = { stamp, facts: log === null ? null : factsIn(log), issues };
  } catch (error) {
    listing = {
      stamp,
      facts: null,
      issues: [{ level: "error", source: sourceOf(found), message: errorMessage(error) }],
    };
  }
  listed.set(found.path, listing);
  return { read: true, listing };
}

/** Every log's facts, read as `factsOf` reads them, with a turn of the event loop after each log
 *  it read again. A cold list read 1.7 GB of 176 logs in 4.4 s on 30 October, and a handler holds
 *  the one thread it runs on, so the selected campaign, asked beside the list, waited for all of
 *  it; between two logs it is answered at once. */
export async function readAll(reading: Pick<Reading, "repo" | "trees" | "now">): Promise<void> {
  for (const each of campaignsFound(reading).found) {
    if (factsOf(each).read) await Bun.sleep(0);
  }
}

export function campaignsAnswer(reading: Reading, _query: Query<"campaigns">): CampaignList {
  const { found, issues: looked } = campaignsFound(reading);
  const paths = new Set(found.map(({ path }) => path));
  for (const path of listed.keys()) if (!paths.has(path)) listed.delete(path);
  const issues: Issue[] = [...looked];
  let unlisted = false;
  const rows = found.flatMap((each): { readonly row: CampaignRow; readonly opened: string }[] => {
    const { facts, issues: read } = factsOf(each).listing;
    issues.push(...read);
    if (facts === null) return [];
    const process = writing(each);
    unlisted ||= process === null;
    return [{ row: campaignRow(each, facts, { process, tier: reading.tier }), opened: facts.opened }];
  });
  if (unlisted) {
    issues.push({
      level: "warning",
      source: "ps, lsof",
      message: "the host's processes could not be listed, so no campaign reads as running",
    });
  }
  return {
    tier: reading.tier,
    issues,
    campaigns: rows.toSorted((one, other) => other.opened.localeCompare(one.opened)).map(({ row }) => row),
  };
}
