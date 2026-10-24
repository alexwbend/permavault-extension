import { ItemIndex, html, css } from "replaywebpage";
import { icon } from "../icons";
import { property } from "lit/decorators.js";

import prettyBytes from "pretty-bytes";
import { type WrRecCollInfo } from "./coll-info";
import { type WrRecItem } from "../types";

import type { PropertyValues } from "lit";

//============================================================================
export class WrRecCollIndex extends ItemIndex {
  @property({ type: Object })
  deleteConfirm: WrRecItem | null = null;
  ipfsSharePending = 0;

  private _poll?: number | NodeJS.Timer;

  sortedItems: WrRecItem[] = [];

  @property({ type: Object })
  shareOpts: unknown;

  static get styles() {
    return [
      super.styles,
      css`
        .section.no-top-padding {
          width: calc(100% - 32px);
          max-width: 1180px;
          margin: 0 auto;
          padding: 12px 0 32px;
        }

        .panel-heading.index-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }

        .item-count {
          font-size: 12.5px;
          font-weight: 500;
          letter-spacing: 0;
          color: var(--pv-muted);
        }

        .empty-state {
          width: 100%;
          padding: 40px 20px 48px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          text-align: center;
          color: var(--pv-ink2);
          font-size: 14px;
        }

        .empty-state p {
          max-width: 420px;
          margin: 0;
        }

        .empty-tile {
          width: 56px;
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          color: var(--pv-ink);
          background: linear-gradient(180deg, #fff 0%, #f2f2f5 100%);
          box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.1), inset 0 1px 0 #fff, 0 8px 18px -10px rgba(0, 0, 0, 0.3);
        }

        .sort-header .control.has-icons-left .icon {
          height: 34px;
          color: var(--pv-icon-muted);
        }

        .sort-header .select select,
        .sort-header .button {
          height: 34px;
          font-size: 13.5px;
        }

        .sort-header .select:not(.is-multiple) {
          height: 34px;
        }

        .ic {
          fill: none;
          stroke: currentColor;
          stroke-width: 1.5;
          stroke-linecap: square;
          stroke-linejoin: miter;
        }
      `,
    ];
  }

  renderHeader() {
    const count = this.items.length;
    return html`<h2 class="panel-heading panel-color index-head">
      <span>${this.headerName}</span>
      ${count ? html`<span class="item-count">${count} ${count === 1 ? "item" : "items"}</span>` : ""}
    </h2>`;
  }

  get sortKeys() {
    return [
      { key: "title", name: "Title" },

      { key: "ctime", name: this.dateName },

      { key: "mtime", name: "Date Modified" },

      { key: "size", name: "Total Size" },

      { key: "loadUrl", name: "Source" },
    ];
  }

  firstUpdated() {
    this.loadItems();

    this._poll = setInterval(() => {
      if (!this.ipfsSharePending) {
        this.loadItems();
      }
    }, 10000);
  }

  updated(changedProperties: PropertyValues<this>) {
    super.updated(changedProperties);

    if (changedProperties.has("sortedItems") && this.sortedItems?.length) {
      this.dispatchEvent(
        new CustomEvent("colls-updated", {
          detail: { colls: this.sortedItems },
        }),
      );
    }
  }

  renderItemInfo(item: WrRecItem) {
    return html` <wr-rec-coll-info
      style="overflow: visible"
      data-coll="${item.id!}"
      .item=${item}
      .shareOpts=${this.shareOpts}
      @ipfs-share="${this.onIpfsShare}"
    >
    </wr-rec-coll-info>`;
  }

  render() {
    return html` ${super.render()} ${this.renderDeleteConfirm()} `;
  }

  renderDeleteConfirm() {
    if (!this.deleteConfirm) {
      return null;
    }

    return html` <wr-modal
      bgClass="has-background-grey-lighter"
      @modal-closed="${() => (this.deleteConfirm = null)}"
      title="Confirm Delete"
    >
      <p>
        Are you sure you want to permanentely delete the archive
        <b>${this.deleteConfirm.title}</b>
        (Size:
        <b>${prettyBytes(Number(this.deleteConfirm.size))}</b>)
      </p>
      <button @click="${this.doDelete}" class="button is-danger">Delete</button>
      <button @click="${() => (this.deleteConfirm = null)}" class="button">
        Cancel
      </button>
    </wr-modal>`;
  }

  // @ts-expect-error - TS7006 - Parameter 'event' implicitly has an 'any' type.
  onIpfsShare(event) {
    if (event.detail.pending) {
      this.ipfsSharePending++;
    } else {
      this.ipfsSharePending--;
    }
  }

  // @ts-expect-error - TS7006 - Parameter 'event' implicitly has an 'any' type.
  onDeleteColl(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!this.sortedItems) {
      return;
    }

    const index = Number(event.currentTarget.getAttribute("data-coll-index"));

    this.deleteConfirm = this.sortedItems[index];
  }

  async doDelete() {
    if (!this.deleteConfirm) {
      return;
    }

    this._deleting[this.deleteConfirm.sourceUrl] = true;
    this.requestUpdate();

    const info = this.renderRoot.querySelector<WrRecCollInfo>(
      `wr-rec-coll-info[data-coll="${this.deleteConfirm.id}"]`,
    );

    if (info) {
      await info.doDelete();
    }

    this.deleteConfirm = null;
  }

  renderEmpty() {
    return html`<div class="empty-state">
      <span class="empty-tile" aria-hidden="true">${icon("folder", 22)}</span>
      <p>No archived items. Click "New Archiving Session" above to begin archiving pages!</p>
    </div>`;
  }
}

customElements.define("wr-rec-coll-index", WrRecCollIndex);
