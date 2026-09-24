# Privacy practices submission draft

Review these declarations against the exact candidate package and the live privacy policy before submitting. Do not treat a draft as a completed Store certification.

## Single purpose

Permavault records pages explicitly selected by the user as local web archives and, with the user's destination acknowledgement, uploads them for temporary saving or paid public permanent storage with a capture record.

## Data handled

| Category | Actual handling |
| --- | --- |
| Authentication information | Email sign-in is completed on the Permavault website. A short-lived extension approval request and private verifier are retained locally until exchange for a dedicated session. Session tokens remain in extension storage and are sent to the Permavault API for authenticated requests. For the optional key-file method, the JWK is sent to the Permavault backend over HTTPS for sign-in and retained locally for renewal. The backend also stores an encrypted copy with that session. It is not a browser-only authentication method. |
| Personally identifiable information | The account identifier is retained for authentication and account ownership checks. Email is processed by the website's email sign-in flow. Selected page content may contain other personal information. |
| Website content | The selected page's resources, URL, title and optional screenshot are recorded locally. Upload sends readable archive contents to Permavault. Eligible small captures are temporary until paid; permanent captures are published as readable records. Private Capture is unavailable here. |
| Browsing URLs / history | The popup reads the active tab URL and title when opened and the recorder handles URLs associated with a requested capture. It does not continuously record browsing history. Declare these selected URLs rather than claiming no URLs are handled. |
| Personal communications, health, financial, location or other sensitive information | These can be present in a page the user selects. The recorder does not remove them. Do not certify that such content can never be collected. Account/payment processing also follows the website privacy policy. |
| Local files and settings | The local library, exact pending archive bytes, capture settings, account binding, payment operation and upload session identifiers are stored in the browser. Pending upload packages survive popup closure so payment or upload can continue without recording different bytes. |

## Purpose and transfers

Capture data is used to provide recording, archival and verification. Requests go to the selected page's resource hosts and the Permavault API; checkout opens Stripe. Published capture data is stored on Arweave and can be retrieved by anyone with its location. No sale of user data, advertising profile or lending assessment is part of this implementation. The publisher must confirm the applicable Store certification statements before submission.

## Policy and distribution

Privacy policy: https://app.permavault.xyz/privacy

The extension is free to install; optional paid services use USD through Stripe. Publisher identity, item ID, distribution regions and actual publication status must come from the verified Developer Console. None is inferred from an upstream Webrecorder item.
