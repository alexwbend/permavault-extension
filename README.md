# Permavault Browser Extension

**Archive web pages permanently, directly from your browser.**

This extension is the browser capture arm of [Permavault](https://permavault.xyz):
one click saves the page you are looking at, exactly as you see it, and seals it
into your Permavault vault. It exists for the pages a server cannot reach: your
logged-in sessions, your subscriptions, the consent walls you have already
answered.

Captures made in your browser are labeled as such in your vault. Permavault
attests to receiving and sealing them; the page itself was delivered by your
browser session. Server-side captures remain the higher evidence tier for
anything public.

## Status

M1: fork + rebrand + strip. The one-click Permavault flow (sign-in, "Archive
this page", vault upload) lands in M2/M3. See the roadmap in the Permavault
tracker (PV-207).

## Development

Requires Node >= 22.13 < 23 and Yarn Classic (1.22.x).

```bash
yarn install
yarn build-dev   # development build -> dist/ext
yarn build       # production build -> dist/ext
```

Load `dist/ext` as an unpacked extension from `chrome://extensions`
(Developer mode → Load unpacked).

## Provenance and license

This is a fork of
[ArchiveWeb.page](https://github.com/webrecorder/archiveweb.page) by
[Webrecorder](https://webrecorder.net), and the recording engine is entirely
their work. Our thanks to the Webrecorder project for building and publishing
it.

Licensed [AGPL-3.0-or-later](LICENSE.md), same as upstream. Modifications are
Copyright Permavault; original code Copyright Webrecorder Software. The names
"ArchiveWeb.page" and "Webrecorder" are trademarks of their owner and are used
here only to attribute provenance.
