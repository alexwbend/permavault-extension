# Extension brand assets

The vectors follow Permavault's locked K5 Graphite design (PV-207). The mark's
paths come from the main repository's `brand/` directory; keep them and their
proportions unchanged.

- `icon.svg`, `icon-48.svg`, `icon-32.svg`, `icon-16.svg`: the production
  toolbar icon, a graphite square (`#5A5A5D` to `#2C2C2E`) with a white mark.
  The mark sits closer to the edge at 16 and 32 px so it stays legible.
- `icon-dev.svg`: the purple development icon with a white mark.
- `permavault-logo.svg`: `brand/logo/permavault-logo-mono.svg`, the symbol and
  wordmark shown in the popup header.
- `permavault-mark.svg`: `brand/symbol/permavault-symbol-mono.svg`.

The extension build copies `static/`, so regenerate the shipped files whenever
these vectors change. Use Node 22 and an existing Sharp installation; Sharp is
only an asset-generation tool and is not an extension dependency:

```bash
node scripts/generate-icons.cjs --sharp-module /absolute/path/to/sharp
```

The command generates `assets/icon-32.png`, `assets/icon-128.png`,
`static/icon-16.png`, `static/icon-32.png`, `static/icon-48.png`,
`static/icon.png`, `static/icon-dev.png`, `static/permavault-logo.svg` and
`static/permavault-mark.svg`. Commit the vectors and generated files together.

`store/icon.png` is the Store listing icon (96 px artwork with 16 px clear
space, as the Store asks). It comes from the design source with the other
Store images and is not generated here.
