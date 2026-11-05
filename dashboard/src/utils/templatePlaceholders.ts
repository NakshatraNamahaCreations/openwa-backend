/**
 * Reading the placeholders out of a stored template, the way the gateway's renderer fills them.
 *
 * Shared by the Templates page (which previews a substitution) and the Message Tester (which collects
 * the values a send supplies), so the two never drift from each other or from the backend.
 */

/** The parts of a template a placeholder may appear in — satisfied by both the edit form and a saved row. */
export interface PlaceholderSource {
  header?: string | null;
  body?: string | null;
  footer?: string | null;
}

/** A placeholder as the template writes it: its key, and the exact token to show the author. */
export interface Placeholder {
  key: string;
  token: string;
}

// The gateway's renderer pattern (PLACEHOLDER_PATTERN in src/common/utils/template-render.ts), kept verbatim: a send
// fills the legacy single-brace `{key}` form as well as `{{key}}`, so the list and the preview read both. Only the
// double-brace form is advertised.
export const PLACEHOLDER_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}|\{(\w+)\}/g;

/** The variables a send fills, each once, with the form it is written in: `{{key}}`, or `{key}` for the legacy form. */
export function extractPlaceholders(template: PlaceholderSource): Placeholder[] {
  const source = [template.header, template.body, template.footer].filter(Boolean).join('\n');
  const tokens = new Map<string, string>();
  for (const [, doubleKey, singleKey] of source.matchAll(PLACEHOLDER_PATTERN)) {
    const key = doubleKey ?? singleKey;
    if (!tokens.has(key)) tokens.set(key, doubleKey !== undefined ? `{{${key}}}` : `{${key}}`);
  }
  return [...tokens.keys()].sort().map(key => ({ key, token: tokens.get(key)! }));
}
