# Permission justifications (Privacy practices tab)

Each block below is ready to paste into the matching justification field in
the Chrome Web Store Developer Console. Reviewers read these closely, and
`debugger` plus broad host access is the combination most likely to trigger
extra questions or a request for a demo video.

## debugger

```
Permavault's core function is recording available resources from a page in the user's browser session, so the page can be preserved as a standards-compliant web archive (WARC/WACZ). The capture engine uses the Chrome DevTools protocol to observe resource requests during the selected recording. The extension attaches the debugger only to the tab the user explicitly chose to archive, only after the user clicks "Record and upload this page" or a local recording action, and detaches automatically when the capture stops. No browsing data is inspected, modified, or collected for any other purpose.
```

## webRequest

```
Used together with the capture engine to observe the requests a page makes while an archive is being recorded, so available resources can be preserved in the archive. Observation starts only when the user starts a capture and ends when it stops.
```

## Host permissions (*://*/*)

```
Users can request a recording of pages they visit in their own browser, which is the product's single purpose. API requests also support sign-in, pricing, upload and progress. For page recording, a capture starts only when the user clicks "Record and upload this page" or a local recording action on the tab they are viewing, and recording is scoped to that requested capture session.
```

## activeTab

```
Identifies the tab the user wants to archive and takes a single screenshot of the visible page at the moment the user clicks Archive. When supported by the upload path, that optional screenshot can be used for an exhibit PDF. A screenshot or exhibit is not guaranteed.
```

## tabs

```
Reads the URL and title of the active tab so the capture can be labeled correctly in the user's vault and matched to its source. The selected page URL is included in an uploaded capture; continuous browsing history is not recorded.
```

## contextMenus

```
Adds actions to record the selected page and open the local library or Permavault website. These support the same recording and archival purpose.
```

## storage

```
Stores the sign-in session, pending approval verifier, capture settings, account binding and payment/upload identifiers locally in the browser.
```

## unlimitedStorage

```
While a page is being recorded, its resources are staged locally in the extension's own storage before being packaged into one archive file. Large pages can exceed the default storage quota. This data stays on the user's machine until the user chooses to upload the capture, and the local copy can be deleted by the user at any time.
```

## Remote code

```
The extension application JavaScript and WebAssembly ship inside the extension package. Archived website resources can include that website's own scripts as captured content. WebAssembly (covered by the wasm-unsafe-eval content security policy) is used by the capture engine and hashing utilities, and is bundled locally, never fetched at runtime.
```
