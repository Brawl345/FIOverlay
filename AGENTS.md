# LLM Guidance

Chrome/Firefox MV3 extension that replaces native file pickers with an overlay accepting clipboard
images. TypeScript + Vue 3 (`<script setup>`), [WXT](https://wxt.dev), Biome, Vitest. Framework-free
logic lives in `lib/` (unit tested), UI in `entrypoints/`.

## Invariants

- The content script stays side-effect free until a file input is clicked; the overlay is created
  on demand and removed on close.
- Content-script UI carries **no** SFC `<style>` blocks: `overlay.css?inline` goes into a
  constructable stylesheet in a closed shadow root, host properties are set via CSSOM with
  `!important`.
- Nothing may depend on the page's CSP: `createImageBitmap` for images, background `fetch` for
  downloads. The `<img>` fallback in `canvas.ts` (SVG only) is the one exception.
- The page's own input is never clicked; the overlay has its own file input in the shadow root.
- A file's bytes only change where the user asked (editor, `accept` conversion, hash button,
  metadata removal). Thumbnails and the preview are display only.
- Background downloads bypass CORS, so URLs from page-writable clipboard/drag payloads are
  restricted (`source: 'page'`); typed URLs are not.

## Commands (npm + Node 22)

- `npm run build` / `build:firefox`, `npm test`, `npm run lint:types`, `npm run lint:code`
  (`format` to format), `npm run release <version>` (see README)
- `npm run lint:ext`: two `UNSAFE_VAR_ASSIGNMENT` warnings from Vue's `runtime-dom` are expected.
- Browser testing: `npm run build:e2e` (open shadow root) + `npm run testpage`, see README.

## Conventions and pitfalls

- User-facing strings only via `t()` from `public/_locales/{en,de}/messages.json`; every key in
  **both** locales, German in the informal "Du" form.
- Use `browser` from `wxt/browser`, not `chrome.*`.
- `typescript` is pinned to 6.x: `vue-tsc` cannot drive TypeScript 7 yet.
- `web-ext` is a devDependency because WXT 0.21 only declares it as an optional peer; without it
  `npm run dev` launches no browser.
- `browser.storage.sync` needs the explicit Gecko ID in `wxt.config.ts` on Firefox.
