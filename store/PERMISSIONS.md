# Permission justifications (Privacy practices tab)

Each block below is ready to paste into the matching justification field in
the Chrome Web Store Developer Console. Reviewers read these closely, and
`debugger` plus broad host access is the combination most likely to trigger
extra questions or a request for a demo video.

## debugger

```
Permavault's core function is recording a web page exactly as the user's browser loaded it, so the page can be preserved as a standards-compliant web archive (WARC/WACZ). The Chrome DevTools protocol is the only reliable way to observe a tab's full network traffic for this purpose. The extension attaches the debugger only to the tab the user explicitly chose to archive, only after the user clicks "Archive this page", and detaches automatically when the capture stops. No browsing data is inspected, modified, or collected for any other purpose.
```

## webRequest

```
Used together with the capture engine to observe the requests a page makes while an archive is being recorded, so every resource that makes up the page is preserved in the archive. Observation starts only when the user starts a capture and ends when it stops.
```

## Host permissions (*://*/*)

```
Users can archive any page they are able to visit in their own browser, which is the product's single purpose. The extension never accesses a host on its own initiative: a capture starts only when the user clicks "Archive this page" on the tab they are viewing, and only that tab is recorded.
```

## activeTab

```
Identifies the tab the user wants to archive and takes a single screenshot of the visible page at the moment the user clicks Archive. That screenshot becomes the first page of the exhibit PDF included with the sealed record.
```

## tabs

```
Reads the URL and title of the active tab so the capture can be labeled correctly in the user's vault and matched to its source. No browsing history is collected or transmitted.
```

## contextMenus

```
Adds one "Archive this page" entry to the right-click menu as an alternative to clicking the toolbar icon. Same action, same single purpose.
```

## storage

```
Stores the user's sign-in session and capture settings locally in the browser.
```

## unlimitedStorage

```
While a page is being recorded, its resources are staged locally in the extension's own storage before being packaged into one archive file. Large pages can exceed the default storage quota. This data stays on the user's machine until the user chooses to upload the capture, and the local copy can be deleted by the user at any time.
```

## Remote code

```
The extension does not execute remote code. All JavaScript and WebAssembly ship inside the extension package. WebAssembly (covered by the wasm-unsafe-eval content security policy) is used by the capture engine for compression and archive packaging, and is bundled locally, never fetched at runtime.
```
