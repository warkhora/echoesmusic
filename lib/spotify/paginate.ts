/**
 * Paged-collection walker — one implementation shared by the server fan-out and
 * the client loader, so `/v1/me/tracks` cannot drift between the two.
 *
 * Termination, in order:
 *   (a) the page returned fewer rows than requested → nothing more exists;
 *   (b) `next` is null → Spotify says the list ended;
 *   (c) the collected total reached the hard cap → stop before rate limits or
 *       an oversized localStorage write.
 * A page that throws keeps everything collected so far rather than losing the
 * whole list.
 */

export interface Page<T> {
  items?: T[] | null;
  next?: string | null;
}

export interface PaginateOptions<Row, Out> {
  /** First request URL (already carrying limit/offset/fields). */
  firstUrl: string;
  pageSize: number;
  cap: number;
  /** Performs one request; must honour the app's serial lane. */
  fetchPage: (url: string) => Promise<Page<Row>>;
  /** Row → entity, or null to skip (episodes, local files, wrong type…). */
  adapt: (row: Row) => Out | null;
  /** Called when a page fails; the walk stops but keeps what it collected. */
  onPageError?: (error: unknown, collected: Out[]) => void;
  /** Absolute ceiling on requests, independent of the cap. */
  maxPages?: number;
}

export interface PaginateResult<Out> {
  items: Out[];
  pages: number;
  /** Why the walk stopped — useful for logs and tests. */
  stopped: "short-page" | "no-next" | "cap" | "max-pages" | "error" | "empty";
  truncated: boolean;
}

export async function collectPages<Row, Out>(
  options: PaginateOptions<Row, Out>,
): Promise<PaginateResult<Out>> {
  const {
    firstUrl,
    pageSize,
    cap,
    fetchPage,
    adapt,
    onPageError,
    maxPages = 12,
  } = options;

  const collected: Out[] = [];
  let url: string | null = firstUrl;
  let pages = 0;
  let stopped: PaginateResult<Out>["stopped"] = "empty";

  while (url && pages < maxPages) {
    let page: Page<Row>;
    try {
      page = await fetchPage(url);
    } catch (error) {
      stopped = "error";
      onPageError?.(error, collected);
      break;
    }

    pages += 1;
    const rows = page.items ?? [];

    for (const row of rows) {
      const item = adapt(row);
      if (!item) continue;
      collected.push(item);
      if (collected.length >= cap) {
        stopped = "cap";
        break;
      }
    }

    if (stopped === "cap") break;
    if (rows.length < pageSize) {
      stopped = collected.length ? "short-page" : "empty";
      break;
    }
    if (!page.next) {
      stopped = "no-next";
      break;
    }
    url = page.next;
  }

  if (pages >= maxPages && stopped !== "cap" && stopped !== "error") stopped = "max-pages";

  return {
    items: collected,
    pages,
    stopped,
    truncated: collected.length >= cap,
  };
}

/** Page size and hard cap for saved tracks (`GET /v1/me/tracks`). */
export const SAVED_PAGE_SIZE = 50;
export const SAVED_MAX_TRACKS = 500;
