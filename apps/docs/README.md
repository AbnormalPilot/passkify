# passkify site

The whole website on one port: landing page at `/`, live demo at `/demo`,
documentation at `/docs`. Next.js App Router + shadcn/ui, content in MDX, API
reference primitives as React components so every documented member renders the
same way.

The demo runs the real package. `app/api/passkey/[...passkey]/route.ts` mounts a
`PasskeyServer` over a `MemoryStore` and `components/demo-console.tsx` calls
`passkify/client`, so a visitor's own authenticator produces an assertion this
server actually verifies. Accounts are disposable and vanish on restart.

`passkify` is a workspace dependency, so npm symlinks it — but that route
resolves through the package's `exports` into `dist/`, which would put a build
step in the dev loop and risk documenting a stale copy. A webpack alias in
`next.config.mjs` and matching `paths` in `tsconfig.json` point at
`../../packages/passkify/src` instead: `npm run dev` is the whole command, and
editing the library hot-reloads the site.

The alias also maps the `.js` specifiers in the library source (required by
TypeScript's NodeNext resolution, correct for the published build) onto the
`.ts` files they actually name.

Run these from the repository root, which is where the lockfile lives:

```bash
npm install
npm run dev        # http://localhost:3000
npm run build:docs
```

## Layout

```
app/
  layout.tsx              fonts, tokens, tooltip provider
  page.tsx                landing page
  demo/page.tsx           live demo
  api/passkey/[...]/      the real PasskeyServer route handler
  api/demo/session/       demo session read and sign-out
  docs/layout.tsx         three-column shell: sidebar, content, table of contents
  docs/**/page.mdx        one file per route, 23 in total
components/
  ui/                     shadcn components (owned source, not a dependency)
  docs/                   MDX primitives: api, callout, steps, cards
  reactbits/              vendored React Bits components (RippleDistortion)
  marble-panel.tsx        the hero relief: generated marble + ripple
  install-command.tsx     copy-to-clipboard primary CTA
  demo-console.tsx        the demo's sign-up / sign-in / manage UI
  docs-sidebar.tsx        nav tree with active state
  docs-toc.tsx            "on this page", derived from the DOM
  docs-pager.tsx          previous / next in reading order
  search-dialog.tsx       cmdk palette, Cmd+K
lib/nav.ts                the single source of truth for routes
lib/marble.ts             procedural marble slab, as an SVG data URI
lib/demo-passkeys.ts      the demo's PasskeyServer instance
lib/demo-session.ts       minimal signed-cookie session for the demo
mdx-components.tsx        puts the primitives in scope for every MDX file
```

## Adding a page

1. Create `app/docs/<path>/page.mdx` with an exported `metadata` object.
2. Add the route to `lib/nav.ts`.

That second step is not optional: the sidebar, the pager and search all read
from `lib/nav.ts`, so a page missing from it is unreachable. The check below
catches that.

## The house style

Every documented member carries a **reason**, not just a description. That is
what `<Reason>` is for, and a method without one is visibly incomplete while
authoring.

```mdx
<ApiMethod name="takeChallenge" signature="takeChallenge(challenge: string): Promise<PasskeyChallenge | null>">

Fetch **and delete**, atomically.

<Reason>
Deleting on read is what makes a challenge single use, which is what stops a
captured response from being replayed.
</Reason>

<PropList>
  <Prop name="challenge" type="string" required>The base64url challenge.</Prop>
</PropList>

<Returns type="Promise<PasskeyChallenge | null>" />

<Throws>
  <Throw code="challenge_not_found">Expired, or already consumed.</Throw>
</Throws>

</ApiMethod>
```

`<ApiMethod>` emits a real `<h3 id>`, so it appears in the table of contents
alongside prose headings.

Other components in scope: `<Callout type="note|tip|warning|danger">`,
`<Steps>` with `<Step title>`, `<Contrast>` with `<ContrastItem tone="good|bad">`,
and `<Tabs>` for per-framework snippets.

## Theme: carved stone

Monochrome. There is no hue anywhere in `app/globals.css`: every value is a
neutral, and the only accent is contrast, black set against limestone. Emphasis
is made by inverting a block, never by colouring it. Even the Shiki code theme
is a custom monochrome one, defined in `next.config.mjs`, because a stock
highlighter would be the one place colour leaked back in.

Structure is modular in the Roman sense. `--radius` is `0rem` everywhere,
because stone is cut rather than moulded; borders behave like the joints
between blocks; the grid is visible rather than implied; and Roman numerals
index the modules on the landing page.

Type is an inscription against a modular ground:

| Face | Job |
|---|---|
| **Cinzel** | Headings and every architectural label. Drawn from first-century Roman inscriptional capitals, which is why it is here rather than a general-purpose serif. |
| **EB Garamond** | Running text, at 17px, where the reference stops and legibility takes over. |
| **JetBrains Mono** | Code, sidebar entries and metadata: the modular half of the pairing. |

The `.inscribe` utility is the house lettering: Cinzel, uppercase, wide
tracking. Use it for anything structural, never for running text.

With no second colour available, the four callout kinds are told apart by the
weight of their left rule rather than by hue: a hairline for a note, a doubled
rule for a warning, a solid bar for a danger.

Light only, deliberately. `color-scheme: light` is pinned and there is no
`prefers-color-scheme` block, so the page cannot half-invert.

Tokens use shadcn's standard names, so `npx shadcn@latest add <component>`
drops in components that are already on-palette.

Every foreground and background pair was solved to WCAG AA, including the code
theme, whose lightest token sits at 4.92:1 on the code ground.

## The hero

`components/marble-panel.tsx` renders a marble slab that the pointer disturbs.

The slab is generated, not photographed. `lib/marble.ts` builds it with SVG
`feTurbulence`, about 2.1 kB as a data URI: fractal noise through a steep
transfer curve reads as veining, and a second high-frequency pass multiplies in
the grain. That avoids an external request, a licence, and a stock photograph
whose subject has nothing to do with the product.

The ripples come from [React Bits](https://reactbits.dev)' `RippleDistortion`,
vendored into `components/reactbits/` because React Bits distributes source you
own. The only change from upstream is a `'use client'` directive, which the App
Router needs because the component reaches for WebGL, `ResizeObserver` and
pointer events.

A static `<img>` of the same slab renders underneath, server-side, so the hero
is never blank while the canvas boots and stays correct if WebGL is
unavailable. Under `prefers-reduced-motion` the component stops laying down
ripples, leaving the still slab, which is the right static equivalent rather
than an empty box.

## Checks

Route and link integrity are not covered by `next build`, since a broken
`[text](/docs/...)` is valid MDX. Run this before shipping:

```bash
npm run typecheck
node scripts/check-links.mjs
```

`check-links.mjs` verifies that every nav entry has a page, every page is in the
nav, and every internal link and `#anchor` resolves.
