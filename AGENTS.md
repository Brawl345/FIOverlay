# LLM Guidance

This file provides guidance to LLMs when working with code in this repository.

## Overview

Chrome/Firefox web extension that replaces native file pickers with an overlay accepting clipboard
images. TypeScript + Vue 3 (`<script setup>`), built with [WXT](https://wxt.dev) (Vite), linted and
formatted with Biome, tested with Vitest. Manifest V3 on both browsers.

## Architecture

Framework-free logic lives in `lib/`, UI in `entrypoints/`:

- **`lib/`**: `domains.ts` (synced disabled-domain list, hostname matching, import/export),
  `clipboard.ts` (DataTransfer and Clipboard API → `File[]`, port-based downloads), `files.ts`
  (`accept` matching, data URLs, names, sizes), `convert.ts` (canvas encoding, the output type an
  `accept` leaves possible), `metadata.ts` (EXIF/XMP/IPTC removal on the byte level),
  `settings.ts` (synced switches), `picker-hook.ts` (page-world `click()`/`showPicker()` patch),
  `base64.ts`, `messages.ts`, `i18n.ts`.
- **`entrypoints/content/`**: `index.ts` (capture-phase click interception at `document_start`),
  `early-events.ts` (paste/keydown capture registered before page scripts), `overlay.ts`
  (`<dialog>` + closed shadow root, Vue mount, `assignFiles`), `canvas.ts` (bitmap decode/draw),
  `Overlay.vue`, `Editor.vue` (crop, rotation, scale), `Thumbnail.vue`, `Preview.vue`, `Logo.vue`,
  `overlay.css`.
- **`entrypoints/picker.content.ts`**: `world: 'MAIN'` script installing `picker-hook.ts`, which
  announces a picker the isolated world would not see otherwise.
- **`entrypoints/background.ts`**: per-tab icon state, domain toggle on `action.onClicked`, chunked
  streaming downloads over a `runtime.Port`.
- **`entrypoints/options/`**: domain list, metadata switch, JSON export/import.

## Invariants

- The content script must stay side-effect free until a file input is actually clicked; the overlay
  is created on demand and removed on close.
- The overlay's styling never relies on the page: styles are inlined via `overlay.css?inline` into a
  constructable stylesheet, host properties are set through CSSOM with `!important`. Content-script
  UI therefore carries **no** SFC `<style>` blocks — the shadow root already isolates it.
- Anything that could hit the page's CSP (image loads, network requests) is routed around it:
  `createImageBitmap` for previews, background `fetch` for downloads. The `<img>` + object URL path
  in `canvas.ts` is the one exception, reserved for what that decoder rejects (SVG); it may be
  refused by `img-src` and then falls back to a placeholder.
- A detached input's events reach nothing outside itself, so the page-world hook parks it in the
  document only for the duration of the announcement and puts it back at its old position; the page
  keeps the element it created, and both worlds work on that same element.
- `overlayOpen` suppresses re-entrant `input.click()` calls from page handlers, and an Alt+click
  releases exactly one click to the browser - the time window only exists because a label or upload
  button forwards a synthetic click that may drop the modifier.
- The page's own input is never clicked; the overlay carries its own file input inside the shadow
  root, so the native dialog feeds the queue instead of ending the overlay.
- A file's bytes only change where the user asked for it: the editor writes crop, rotation and
  scale back through a canvas, and an image the field's `accept` refuses is re-encoded into a type
  it takes. A rename re-wraps the same blob in a fresh `File`. Everything else - thumbnails, the
  large preview - is display only, and `createImageBitmap` is never given both `resizeWidth` and
  `resizeHeight` unless they already match the natural aspect ratio, because it does not preserve
  it on its own.
- Metadata removal runs on the raw bytes when the selection is confirmed, never through a canvas:
  a JPEG keeps its APP0 and its ICC profile in APP2, a PNG its `iCCP`, and the image data is
  copied through untouched. A file of another type, or one with nothing to remove, is passed on as
  it is.
- An edited item enters the list under a fresh id: `Thumbnail` and the pixel size are read once on
  mount, so the row has to be remounted to show the new bytes.
- Pasting takes files and image flavours only; text is ignored without an error. The URL field is
  the deliberate path for a link, so the global paste capture has to step aside whenever a text
  field of ours holds focus and the clipboard carries no file - otherwise the field cannot be
  pasted into at all.

## Commands (npm + Node 22)

- `npm run build` / `build:firefox`: production builds → `.output/{chrome,firefox}-mv3`
- `npm run lint:types`: `wxt prepare` + `vue-tsc`
- `npm run lint:code` (`format` to format)
- `npm run lint:ext`: Firefox build + `web-ext lint`. Two warnings are expected and unfixable:
  `UNSAFE_VAR_ASSIGNMENT` fires on Vue's own `runtime-dom`, not on our code.
- `npm test`: Vitest
- `npm run release <version>`: full release, see README

## Internationalization

All user-facing strings live in `public/_locales/{en,de}/messages.json` and are accessed via `t()`
(`lib/i18n.ts`), never hardcoded. Add every new key to **both** locales. German uses the informal
"Du" form.

## Key Technical Details

- `typescript` is pinned to 6.x: `vue-tsc` cannot drive TypeScript 7 yet.
- `web-ext` is a devDependency because WXT 0.21 declares it as an optional peer; without it `wxt`
  falls back to its manual runner and no browser is launched for `npm run dev`.
- The unified `browser` API (`wxt/browser`) is used instead of raw `chrome.*`.
- `browser.storage.sync` requires the explicit Gecko ID in `wxt.config.ts` on Firefox.
- A `<dialog>` cannot host a shadow root — it wraps a `<div>` that does.
