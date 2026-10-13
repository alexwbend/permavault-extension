# Extension brand assets

The vectors are copies of Permavault's canonical assets in the main repository's
`brand/` directory. Keep the mark's paths and proportions unchanged.

- `icon.svg`: `brand/extension-icon.svg`, recolored to Vault (`#16352B`) and
  Paper (`#FBF9F4`) for the production extension and Chrome Web Store.
- `icon-dev.svg`: `brand/extension-icon-dev.svg`, preserving its purple
  development background and white mark.
- `permavault-mark.svg`: `brand/symbol/permavault-symbol-mono.svg`, the popup's
  actual Permavault mark.

The extension build copies `static/`, so regenerate the shipped files whenever
these vectors change. Use Node 22 and an existing Sharp installation; Sharp is
only an asset-generation tool and is not an extension dependency:

```bash
node scripts/generate-icons.cjs --sharp-module /absolute/path/to/sharp
```

The command generates `assets/icon-32.png`, `assets/icon-128.png`,
`static/icon.png`, `static/icon-dev.png`, `static/permavault-mark.svg`, and
`store/icon.png`. Commit the vectors and generated files together. Use the
production `store/icon.png` in the Store console, matching the shipped package.
