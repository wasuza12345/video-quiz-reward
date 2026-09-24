// Short-id display for anonymous users/sessions (spec §5.5/§5.6: "{id first 8}…", full id in `title`).
export function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}
