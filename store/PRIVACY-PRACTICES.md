# Privacy practices answers (Privacy practices tab)

Console fields and the answers to give, consistent with
https://app.permavault.xyz/privacy.

## Single purpose statement

```
Permavault archives web pages permanently at the user's explicit request. The user chooses a page, clicks Archive, and the page is recorded in their own browser session, sealed with a cryptographic signature, and stored permanently so it can be verified and shared later.
```

## Data usage: what the extension handles

Declare these item types in the console:

| Console item | Answer |
| --- | --- |
| Authentication information | YES. Account token and Arweave keyfile, used only to sign the user in to their Permavault account. Stored locally in the browser. |
| Website content | YES. Only the pages the user explicitly chooses to archive. That content is uploaded to the user's Permavault account and stored permanently as a public record. |
| Personally identifiable information | Only the account identifiers needed for sign-in (wallet address, or email if the account uses one on the web app). |
| Personal communications | NO |
| Health / financial info | NO |
| Location | NO |
| Web history | NO. The extension reads the active tab's URL only when the user starts a capture. |
| User activity | NO |
| Search history | NO |

## Data usage certification (checkboxes)

All three statements are true and safe to certify:

1. Data is not sold to third parties, outside the approved use cases.
2. Data is not used or transferred for purposes unrelated to the item's single purpose.
3. Data is not used or transferred to determine creditworthiness or for lending purposes.

## Privacy policy URL

```
https://app.permavault.xyz/privacy
```

Known gap: the policy covers capture records but does not yet name the
browser extension. One sentence to add before submitting (draft in
SUBMISSION-CHECKLIST.md), because reviewers do check that the policy covers
the extension's data flows.

## Visibility / distribution

- Visibility: Public (once approved).
- Regions: all, unless you want an EU-first soft launch.
- Pricing in console: Free (captures are sold through the web app, not
  through Chrome payments, which is allowed because the extension itself
  charges nothing).
