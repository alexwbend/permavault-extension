# Chrome Web Store release checklist

This is a release checklist, not a claim that the item was submitted or approved.

## Verify publisher access

Open https://chrome.google.com/webstore/devconsole with the intended publisher account. Confirm registration, publisher identity and the actual Permavault item. Record its item ID from the console; never reuse the upstream ArchiveWeb.page ID. If account access or registration is missing, the account owner must complete that step.

## Validate the exact candidate

Build from the final committed extension source with Node 22, including all tests and TypeScript checks. Exclude unrelated local edits. Use the resulting ZIP or the matching GitHub Actions artifact, not the older untracked store/permavault-extension-0.1.0.zip. Check the candidate manifest version against any existing Store item before updating it.

Deploy the matching website extension-approval endpoints before testing native email sign-in. Load the candidate unpacked in Chrome and check:

1. Email approval shows the same code in the extension and requires the intended account's explicit approval. Reopening the popup completes sign-in.
2. A zero-balance account can record an eligible article and receives a temporary save with exact expiry, not a permanent-success claim.
3. The $0.99 action opens the intended save's checkout. Verify the resulting paid storage/proof status in History.
4. A package over 10 MB requires review before spending; a package over 100 MB shows a measured price and preserves payment/upload identity across popup closure and resumed upload.
5. Switching accounts cannot send or charge for another account's retained package.
6. Captures from separate recording actions do not include earlier pages. Local download works independently of payment.

Use owned test pages and approved test/payment fixtures. Do not publish sensitive material to test the flow.

## Prepare console materials

Use LISTING.md, PRIVACY-PRACTICES.md and PERMISSIONS.md after matching them to the exact candidate and live privacy policy. Keep the Webrecorder attribution and AGPL source link. Capture screenshots of native email approval, public-destination notice, recording, staged expiry, measured payment and History. Check the console's current screenshot size requirements. Redact account information and private page content.

The debugger permission may require a demonstration of explicit recording start and stop. A short video can show those actions and explain the local library and chosen upload destination.

## Submit only with verified access and release authorization

Uploading a build, saving a draft, submitting review and publishing are distinct steps. Record the actual console outcome. An uploaded ZIP or a successful CI build is not Store approval. After approval, update product install links to the verified Permavault Store URL and verify the published version.
