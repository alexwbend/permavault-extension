# Chrome Web Store submission checklist

Everything I can prepare is prepared. This is the remaining path, in order.
Steps marked [Alex] need your Google account or a decision.

## 1. Developer account [Alex]

- Go to https://chrome.google.com/webstore/devconsole and register.
- One-time $5 fee, payable only by the account owner.
- Publisher display name suggestion: `Permavault`. Verify the email you want
  shown publicly; it appears on the listing.

## 2. Privacy policy sentence [done]

Applied and pushed (permavault bee3caf): the "What We Collect" section now
names the browser extension and states it records a page only when the user
clicks Archive. The technical-record detail list is scoped to server-made
captures, since browser-session captures honestly lack server IP and TLS
forensics. Goes live with the next frontend deploy.

## 3. Package upload [done, ready]

- `store/permavault-extension-0.1.0.zip`, built from `yarn build` output.
- Console: Items > New item > upload zip.
- Version note: 0.1.0 is fine for a first submission; bump to 1.0.0 only if
  you want the store page to read "stable" from day one.

## 4. Store listing tab

- Paste from `store/LISTING.md`: name, short description, detailed
  description, category Productivity, language English.
- Icon: `dist/ext/icon.png` (128 x 128, already correct).
- Screenshots: see section 6.

## 5. Privacy practices tab

- Paste from `store/PERMISSIONS.md` (one block per permission field) and
  `store/PRIVACY-PRACTICES.md` (single purpose, data usage items,
  certifications, policy URL).
- Expect the `debugger` permission to draw the closest look. If review
  stalls or comes back with questions, the answer is a 60 to 90 second
  screen recording showing: click icon > Archive this page > progress >
  done > capture visible in vault. Record it once and keep it on hand.

## 6. Screenshots [Alex, 20 minutes]

Must be 1280 x 800 PNG (or 640 x 400). I cannot drive your Chrome to the
extension popup, so these are yours to take. Shot list, in order:

1. Popup open on a real article, signed in, balance visible,
   "Archive this page" button. Use a page without a paywall for clarity.
2. Capture running: the progress state in the popup.
3. Done state: the "View in vault" link visible.
4. The vault web app with the new capture row and its signed record.
5. Optional: the exhibit PDF open in the viewer.

Tips: use a clean browser profile with no other extensions, light mode,
bookmark bar hidden, window sized so screenshots come out at 1280 x 800
natively (any larger and Chrome scales them down).

## 7. Submit and review

- Typical review: a few days. Broad host access plus `debugger` can push it
  to a manual review; that is normal and not a rejection signal.
- If rejected, the notice names the violated policy by section. Paste it to
  me verbatim and I will draft the response or the code change.

## 8. After approval

- Flip the README badge and the web app's footer/Guide to link the store
  listing instead of "load unpacked".
- Consider PV-209 (lite tier) before the announcement push, so pricing copy
  on the listing matches what new users will pay.
