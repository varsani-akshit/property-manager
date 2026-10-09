/**
 * Props that make a table row / list item open `href` when clicked anywhere on
 * it (handled app-wide by components/RowLinks.tsx) and reachable by keyboard.
 * Pass undefined to leave the row inert.
 */
export function rowLink(href: string | undefined | null | false) {
  return href ? { "data-href": href, tabIndex: 0 } : {};
}
