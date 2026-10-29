/**
 * Response parsing that cannot throw.
 *
 * Spotify answers `204 No Content` for most write endpoints, and a route that
 * crashes mid-response can hand back an empty body — `res.json()` on either
 * raises "Unexpected end of JSON input". Every fetch in the app parses through
 * here instead.
 */

export async function safeJson<T>(response: Response): Promise<T | null> {
  if (response.status === 204 || response.status === 205) return null;

  let text = "";
  try {
    text = await response.text();
  } catch {
    return null; // body already consumed or the stream broke
  }
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null; // HTML error page, truncated JSON, plain text…
  }
}

/** `safeJson` + an ok-check, for calls where a failure is simply "no data". */
export async function safeJsonIfOk<T>(response: Response): Promise<T | null> {
  if (!response.ok) return null;
  return safeJson<T>(response);
}

/** Reads a JSON request body without throwing on malformed or empty input. */
export async function safeBody<T>(request: Request): Promise<Partial<T> | null> {
  try {
    const text = await request.text();
    if (!text.trim()) return null;
    return JSON.parse(text) as Partial<T>;
  } catch {
    return null;
  }
}
