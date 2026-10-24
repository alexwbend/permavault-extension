// K5 Graphite for the local library (PV-207). The library is built from
// ReplayWeb.page components styled with Bulma, each in its own shadow root,
// so one layer of overrides is added to every one of them rather than
// rewriting their markup.
import { css } from "replaywebpage";
import type { CSSResult } from "lit";

export const graphite: CSSResult = css`
  :host {
    --pv-ink: #1d1d1f;
    --pv-ink2: #3a3a3c;
    --pv-muted: #56565b;
    --pv-icon-muted: #86868b;
    --pv-accent: #48484a;
    --pv-fill: rgba(118, 118, 128, 0.12);
    --pv-fill2: rgba(118, 118, 128, 0.08);
    --pv-line: rgba(0, 0, 0, 0.08);
    --pv-card-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04), 0 18px 40px -22px rgba(0, 0, 0, 0.22);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Geist", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: var(--pv-ink);
    letter-spacing: -0.006em;
    -webkit-font-smoothing: antialiased;
  }

  a {
    color: var(--pv-ink);
  }

  a:hover {
    color: var(--pv-ink2);
  }

  .content h3,
  .content h4,
  .modal-card-title,
  .panel-heading {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Geist", system-ui, sans-serif;
    letter-spacing: -0.02em;
  }

  /* Buttons: option I. Secondary by default, graphite for the main action. */
  .button {
    height: 36px;
    padding: 0 14px;
    border: 0;
    border-radius: 7px;
    font-size: 14px;
    font-weight: 560;
    color: var(--pv-ink);
    background: linear-gradient(180deg, #fff 0%, #f8f8f9 100%);
    box-shadow: inset 0 0 0 1px rgba(29, 29, 31, 0.28), 0 1px 1px rgba(0, 0, 0, 0.04);
  }

  .button.is-small {
    height: 34px;
    font-size: 13.5px;
  }

  .button,
  .button.is-small {
    border-radius: 7px !important;
  }

  .button:hover,
  .button.is-hovered {
    color: var(--pv-ink);
    background: #f1f1f3;
    box-shadow: inset 0 0 0 1px rgba(29, 29, 31, 0.36), 0 1px 1px rgba(0, 0, 0, 0.04);
  }

  .button:focus-visible,
  .input:focus-visible,
  select:focus-visible,
  a:focus-visible,
  input[type="checkbox"]:focus-visible {
    outline: 2px solid var(--pv-accent);
    outline-offset: 2px;
  }

  .button:focus:not(:focus-visible) {
    box-shadow: inset 0 0 0 1px rgba(29, 29, 31, 0.28), 0 1px 1px rgba(0, 0, 0, 0.04);
  }

  .button[disabled] {
    opacity: 0.45;
    box-shadow: inset 0 0 0 1px rgba(29, 29, 31, 0.2);
  }

  .button .icon,
  .button fa-icon {
    color: inherit;
  }

  .button.is-primary,
  .button.is-link,
  .button.is-info,
  .button.is-success,
  .button.is-primary:hover,
  .button.is-link:hover,
  .button.is-link.is-outlined,
  .button.is-link.is-outlined:hover,
  .button.is-primary[disabled] {
    color: #fff;
    background: linear-gradient(180deg, #333336 0%, #1d1d1f 60%, #18181a 100%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 0 0.5px #000, 0 1px 3px -1px rgba(0, 0, 0, 0.25);
  }

  .button.is-primary:hover,
  .button.is-link:hover {
    background: linear-gradient(180deg, #3a3a3d 0%, #262628 60%, #1d1d1f 100%);
  }

  .button.is-primary .icon,
  .button.is-link .icon {
    width: 36px;
    height: 36px;
    margin-left: -14px !important;
    margin-right: 10px !important;
    box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.2);
  }

  .button.is-danger,
  .button.is-danger:hover {
    color: #fff;
    background: linear-gradient(180deg, #e5484d 0%, #b42318 100%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 0 0 0.5px #8c1c13;
  }

  .button.is-warning,
  .button.is-light,
  .button.is-warning:hover,
  .button.is-light:hover {
    color: var(--pv-ink);
    background: linear-gradient(180deg, #f4f4f6 0%, #ededf0 100%);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  }

  .button.is-loading::after {
    border-color: transparent transparent currentColor currentColor !important;
  }

  .delete {
    width: 28px;
    height: 28px;
    max-width: 28px;
    max-height: 28px;
    background: var(--pv-fill);
  }

  .delete::before,
  .delete::after {
    background-color: var(--pv-ink2);
  }

  .delete:hover {
    background: rgba(118, 118, 128, 0.2);
  }

  /* Fields */
  .input,
  .textarea,
  .select select {
    height: 44px;
    border: 0;
    border-radius: 9px;
    background: var(--pv-fill2);
    color: var(--pv-ink);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
    font-size: 14.5px;
  }

  .select.is-small,
  .select.is-small select,
  .is-small .select select {
    height: 34px;
    font-size: 13.5px;
    border-radius: 7px;
  }

  .input.is-small {
    height: 34px;
    font-size: 13.5px;
    border-radius: 7px;
  }

  .input:focus,
  .textarea:focus,
  .select select:focus {
    background: #fff;
    box-shadow: inset 0 0 0 1.5px var(--pv-accent);
  }

  .input::placeholder {
    color: var(--pv-icon-muted);
  }

  .select:not(.is-multiple):not(.is-loading)::after {
    border-color: var(--pv-ink2);
  }

  .field.has-addons .control:not(:first-child):not(:last-child) .input,
  .field.has-addons .control:first-child:not(:only-child) .input {
    border-radius: 9px 0 0 9px;
  }

  .field.has-addons .control:last-child:not(:only-child) .button {
    height: 44px;
    border-radius: 0 9px 9px 0;
  }

  .label,
  label.label {
    font-size: 13px;
    font-weight: 600;
    color: var(--pv-ink2);
  }

  .help,
  .is-size-7 {
    color: var(--pv-muted);
  }

  input[type="checkbox"] {
    accent-color: var(--pv-ink);
  }

  /* Cards */
  .panel {
    overflow: hidden;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: var(--pv-card-shadow);
  }

  .panel-heading,
  .panel-color {
    padding: 20px 20px 10px;
    border: 0;
    border-radius: 16px 16px 0 0;
    background: transparent !important;
    color: var(--pv-ink);
    font-size: 17px !important;
    font-weight: 700;
  }

  .panel-block {
    border-color: var(--pv-line);
    border-bottom: 0;
    padding: 10px 20px;
  }

  .panel-block:not(:last-child),
  .panel-tabs:not(:last-child) {
    border-bottom: 0.5px solid var(--pv-line);
  }

  .message,
  .message-body {
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--pv-ink2);
  }

  .notification {
    border-radius: 12px;
    background: var(--pv-fill2);
    color: var(--pv-ink2);
  }

  .tag {
    border-radius: 999px;
    background: var(--pv-fill);
    color: var(--pv-ink2);
    font-weight: 600;
  }

  .tabs a {
    color: var(--pv-muted);
    border-bottom-color: var(--pv-line);
  }

  .tabs li.is-active a {
    color: var(--pv-ink);
    border-bottom: 2px solid var(--pv-ink);
    font-weight: 600;
  }

  .tabs ul {
    border-bottom-color: rgba(0, 0, 0, 0.12);
  }

  /* Dialogs */
  .modal-background {
    background: rgba(28, 28, 30, 0.32);
    backdrop-filter: blur(6px);
  }

  .modal-card {
    border-radius: 20px;
    box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.45), 0 0 0 0.5px rgba(0, 0, 0, 0.1);
  }

  .modal-card-head,
  .modal-card-head.has-background-grey-lighter,
  .modal-card-foot,
  .modal-card-body {
    border: 0;
    background: #fff !important;
  }

  .modal-card-head {
    padding: 24px 24px 8px;
  }

  .modal-card-body {
    padding: 12px 24px 24px;
    color: var(--pv-ink2);
  }

  .modal-card-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--pv-ink);
  }
`;

/** Adds the graphite layer to a ReplayWeb.page component we do not own. */
export function themeElement(tag: string) {
  const ctor = customElements.get(tag) as unknown as { elementStyles?: unknown[] } | undefined;
  if (ctor?.elementStyles && !ctor.elementStyles.includes(graphite)) {
    ctor.elementStyles = [...ctor.elementStyles, graphite];
  }
}
