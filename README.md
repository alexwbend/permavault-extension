# Permavault Browser Extension

**Capture it before it changes or disappears.**

A link tells you where a page was. Permavault helps you keep what was there.
Record pages from your own browser, keep a local archive, and choose which
captures to preserve permanently with a verifiable record.

Built for lawyers, investigators, journalists and researchers who need more
than a bookmark. Preserve a source for your reporting, a page for your case,
or a reference for your research before the original changes.

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/permavault/paaomlkokoeefimflfhfajnjcggpkeon)** ·
[Explore Permavault](https://permavault.xyz) ·
[Open your account](https://app.permavault.xyz)

## Keep the page. Keep the proof.

- **Capture from the browser you already use.** Record pages through your own
  signed-in session, including subscription pages and consent screens you have
  already passed. Capture available content a remote server may not be able to
  reach.
- **Preserve more than a screenshot.** The Webrecorder capture engine packages
  recorded page resources into a portable web archive (WACZ). Keep it in the
  local library or download a copy to open with a compatible replay tool.
- **Make the evidence independent of the vendor.** Permanent saves store the
  archive and its proof on Arweave, a decentralized storage network designed for
  permanence. Download the evidence package to check the capture's integrity
  without relying on Permavault's website.
- **Choose who can read the stored copy.** A regular permanent save publishes
  the readable archive. A private article save locks it in your browser before
  upload, so Permavault cannot open the stored copy on its own.
- **Pay for what you keep.** Start with local recording or an eligible free
  seven-day save. Pay once to make it permanent. No subscription or sales call.

**Proof is included, not an extra purchase.** Permanent saves include a signed
capture record and independent timestamping through OpenTimestamps, which
anchors the committed record in Bitcoin. Confirmation takes time; History
shows the proof's status. Download the evidence package once it is ready.

## Get started

1. [Install the extension](https://chromewebstore.google.com/detail/permavault/paaomlkokoeefimflfhfajnjcggpkeon)
   and pin it to your browser toolbar.
2. To send captures to Permavault, sign in by email and approve the extension
   on the website using the code shown in its popup. You can also record and
   download locally without an account.
3. Open the page you want to preserve. Choose a regular save or turn on
   **Private**, review where the capture will go, and start recording.
   Eligible article saves upload automatically after recording finishes;
   larger regular captures ask you to review before spending.
4. Follow the popup's progress. Check the result: a temporary save shows its
   expiry and the option to make it permanent. Check **History** in the app for
   storage and proof status.

For private article saves, first set up your **Private Vault** on the website
and save and check your **Recovery Kit**. The extension keeps the readable
original in its local library on this device, even when the uploaded copy is
locked.

## Clear prices. No subscription.

The extension is free to install, and local recording and export are free.
Storage services are paid in USD.

| Capture | Temporary storage | Make permanent |
| --- | --- | --- |
| Regular article save, up to 10 MB | Free for 7 days | **$0.99 per save** |
| Private article save, up to 10 MB | Free for 7 days, locked before upload | **$1.99 per save** |
| Regular browser capture, over 10 MB and up to 100 MB | Payment required before permanent upload | **$4.99 individually**, or use a capture from a pack |
| Larger supported regular captures | Review the measured price before payment | One total based on size, shown before checkout |

Capture packs: **10 for $39** or **50 for $149**. Private article saves are
limited to 10 MB and are paid separately from regular capture packs.

**A seven-day save is temporary.** Unpaid saves are deleted at expiry. Local
copies remain in your browser until you remove them or clear the extension's
data; download any copy you want to safeguard.

Optional **Certificates of Authenticity** are available after permanent storage:
**$9 Basic** or **$39 Legal**. The Legal tier adds an RFC 3161 timestamp, a
chain-of-custody appendix and a declaration template designed to support
authentication under FRE 902(13)/(14). Its evidence package states whether
the issued timestamp qualifies under eIDAS. The Legal timestamp is issued at
certificate purchase and dates the committed record.

## Know what your capture proves

This extension records resources available during the selected browser
recording. Some sites, dynamic elements or resources may not record completely.
Review the archive before relying on it; screenshots and exhibit PDFs are not
available for every capture.

Permavault labels these captures as made in your browser session. Its signed
record attests to receipt and sealing of the uploaded archive; Permavault did
not independently fetch the source page. For public pages, the website also
offers server-side capture. A signature or timestamp does not establish
authorship or prove that a source's claims are true.

An accepted upload is not confirmation of permanent storage. Check the final
storage and proof status in History. If a large upload pauses when the popup
closes, reopen it to continue the retained package.

## Your storage choice matters

**Regular saves:** Permavault can read the uploaded archive. Making it permanent
publishes it on Arweave, where anyone with its location can read it and it
cannot be deleted. Record only material you are willing and entitled to publish.

**Private article saves:** the extension encrypts the archive before upload.
The permanent copy stays locked, but its existence, approximate size, date and
the fact your account made a capture are visible. Losing every working device
and your Recovery Kit means you cannot open it. Keep the kit safe, and remember
that the local original is still readable on this device.

Recording starts when you choose to capture a page; the extension does not
continuously record your browsing. Permanent storage is designed for permanence;
a particular gateway or future retrieval is not guaranteed.

[Read the privacy policy](https://app.permavault.xyz/privacy).

## Development

Use **Node 22.x** (22.13 or later) and **Yarn Classic 1.22.x**.

```bash
yarn install --frozen-lockfile
yarn build-dev   # development build -> dist/ext
yarn build       # production build -> dist/ext
```

Load `dist/ext` as an unpacked extension from `chrome://extensions`
(Developer mode → Load unpacked).

Run the checks used by the extension's build workflow:

```bash
node --test tests/*.test.cjs
yarn run tsc --noEmit
yarn build
```

GitHub Actions builds and packages the extension; Chrome Web Store submission
and publication are separate release steps. See the [release checklist](store/SUBMISSION-CHECKLIST.md).

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
