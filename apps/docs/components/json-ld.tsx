/**
 * A JSON-LD block.
 *
 * `dangerouslySetInnerHTML` is the only way to emit a script body in React, and
 * the escape below is the reason it is safe here: `<` inside a JSON string
 * would otherwise let a value close the script tag early. The data is ours
 * either way, but a helper that is safe by construction is worth the two lines.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the only way to emit JSON-LD
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}
