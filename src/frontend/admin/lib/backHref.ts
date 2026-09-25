// Lets a detail page's BackLink return to the exact filtered/paginated list view an admin came
// from (e.g. /admin/sessions?flagged=true&page=2), instead of always resetting to the plain list.

/** A list page calls this when building a row's link to its own detail page, appending the
 * list's current query string as `from` (only when there is one — an unfiltered first page keeps
 * a plain link). */
export function withFromParam(detailHref: string, listPath: string, searchParams: URLSearchParams): string {
  const query = searchParams.toString();
  if (!query) return detailHref;
  const from = `${listPath}?${query}`;
  const sep = detailHref.includes("?") ? "&" : "?";
  return `${detailHref}${sep}from=${encodeURIComponent(from)}`;
}

/** A detail page calls this to resolve its BackLink target: the `from` the list page attached, if
 * it's a same-app relative path back to `listPath` — never trusted blindly, since a query param is
 * attacker-influenceable even behind admin auth. Falls back to the plain parent route otherwise. */
export function resolveBackHref(from: string | null, listPath: string): string {
  if (from && from.startsWith(`${listPath}?`)) return from;
  return listPath;
}
