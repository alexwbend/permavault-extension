// Carton for the local library (PV-588). The library is built from
// ReplayWeb.page components styled with Bulma, each in its own shadow root,
// so one layer of overrides is added to every one of them rather than
// rewriting their markup.
import { css } from "replaywebpage";
import type { CSSResult } from "lit";

export const carton: CSSResult = css`
  :host {
    --pv-ink: #18181b;
    --pv-ink2: #3f3f46;
    --pv-muted: #6b6b76;
    --pv-icon-muted: #71717a;
    --pv-accent: #5651d8;
    --pv-accent-hi: #6460e0;
    --pv-accent-ink: #4b45c6;
    --pv-top: #fafafb;
    --pv-fill: #f2f2f5;
    --pv-fill2: #f5f5f7;
    --pv-hover: #f7f7f9;
    --pv-line: #e9e9ee;
    --pv-edge: #e4e4e9;
    --pv-red: #c2410c;
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: var(--pv-ink);
    -webkit-font-smoothing: antialiased;
  }

  a {
    color: var(--pv-accent-ink);
  }

  a:hover {
    color: var(--pv-accent);
  }

  .content h3,
  .content h4,
  .modal-card-title,
  .panel-heading {
    font-family: inherit;
    letter-spacing: -0.005em;
  }

  /* Buttons: flat, 8px corners. White with an edge by default, indigo for the main action. */
  .button {
    height: 36px;
    padding: 0 14px;
    border: 0;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    color: var(--pv-ink);
    background: #fff;
    box-shadow: 0 0 0 1px var(--pv-edge);
  }

  .button.is-small {
    height: 34px;
    font-size: 13.5px;
  }

  .button,
  .button.is-small {
    border-radius: 8px !important;
  }

  .button:hover,
  .button.is-hovered {
    color: var(--pv-ink);
    background: var(--pv-hover);
    box-shadow: 0 0 0 1px var(--pv-edge);
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
    box-shadow: 0 0 0 1px var(--pv-edge);
  }

  .button[disabled] {
    opacity: 0.45;
    box-shadow: 0 0 0 1px var(--pv-edge);
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
  .button.is-primary[disabled],
  .button.is-primary:focus:not(:focus-visible),
  .button.is-link:focus:not(:focus-visible) {
    color: #fff;
    background: var(--pv-accent);
    box-shadow: none;
  }

  .button.is-primary:hover,
  .button.is-link:hover {
    background: var(--pv-accent-hi);
  }

  .button.is-primary:focus,
  .button.is-primary:active,
  .button.is-primary.is-active,
  .button.is-link:focus,
  .button.is-link:active {
    /* Bulma's own focus rules are more specific and carry ReplayWeb.page's green. */
    color: #fff !important;
    background: var(--pv-accent) !important;
  }

  .button.is-danger,
  .button.is-danger:hover {
    color: #fff;
    background: var(--pv-red);
    box-shadow: none;
  }

  .button.is-warning,
  .button.is-light,
  .button.is-warning:hover,
  .button.is-light:hover {
    color: var(--pv-ink);
    background: var(--pv-fill2);
    box-shadow: none;
  }

  .button.is-loading::after {
    border-color: transparent transparent currentColor currentColor !important;
  }

  .delete {
    width: 28px;
    height: 28px;
    max-width: 28px;
    max-height: 28px;
    border-radius: 8px;
    background: var(--pv-fill2);
  }

  .delete::before,
  .delete::after {
    background-color: var(--pv-ink2);
  }

  .delete:hover {
    background: var(--pv-fill);
  }

/* Fields */
  .input,
  .textarea,
  .select select {
    height: 40px;
    border: 0;
    border-radius: 8px;
    background: #fff;
    color: var(--pv-ink);
    box-shadow: 0 0 0 1px var(--pv-edge);
    font-size: 14px;
  }

  .select.is-small,
  .select.is-small select,
  .is-small .select select {
    height: 34px;
    font-size: 13.5px;
    border-radius: 8px;
  }

  .input.is-small {
    height: 34px;
    font-size: 13.5px;
    border-radius: 8px;
  }

  .input:focus,
  .textarea:focus,
  .select select:focus {
    background: #fff;
    box-shadow: 0 0 0 1.5px var(--pv-accent);
  }

  .input::placeholder {
    color: var(--pv-icon-muted);
  }

  .select:not(.is-multiple):not(.is-loading)::after {
    border-color: var(--pv-ink2);
  }

  .field.has-addons .control:not(:first-child):not(:last-child) .input,
  .field.has-addons .control:first-child:not(:only-child) .input {
    border-radius: 8px 0 0 8px;
  }

  .field.has-addons .control:last-child:not(:only-child) .button {
    height: 40px;
    border-radius: 0 8px 8px 0;
  }

  .label,
  label.label {
    font-size: 13px;
    font-weight: 500;
    color: var(--pv-ink2);
  }

  .help,
  .is-size-7 {
    color: var(--pv-muted);
  }

  input[type="checkbox"] {
    accent-color: var(--pv-accent);
  }

  /* Cards */
  .panel {
    overflow: hidden;
    border-radius: 10px;
    background: #fff;
    box-shadow: 0 0 0 1px var(--pv-line);
  }

  .panel-heading,
  .panel-color {
    padding: 20px 20px 10px;
    border: 0;
    border-radius: 10px 10px 0 0;
    background: transparent !important;
    color: var(--pv-ink);
    font-size: 17px !important;
    font-weight: 600;
  }

  .panel-block {
    border-color: var(--pv-line);
    border-bottom: 0;
    padding: 10px 20px;
  }

  .panel-block:not(:last-child),
  .panel-tabs:not(:last-child) {
    border-bottom: 1px solid var(--pv-line);
  }

  .message,
  .message-body {
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--pv-ink2);
  }

  .notification {
    border-radius: 8px;
    background: var(--pv-fill2);
    color: var(--pv-ink2);
  }

  /* Tags keep 6px corners; Carton has no round capsules. */
  .tag {
    border-radius: 6px;
    background: var(--pv-fill2);
    color: var(--pv-ink2);
    font-weight: 500;
  }

  .tabs a {
    color: var(--pv-muted);
    border-bottom-color: var(--pv-line);
  }

  .tabs li.is-active a {
    color: var(--pv-accent-ink);
    border-bottom: 2px solid var(--pv-accent);
    font-weight: 500;
  }

  .tabs ul {
    border-bottom-color: var(--pv-line);
  }

  /* Dialogs */
  .modal-background {
    background: rgba(24, 24, 27, 0.32);
  }

  .modal-card {
    border-radius: 20px;
    box-shadow: 0 24px 64px -20px rgba(24, 24, 27, 0.35), 0 0 0 1px var(--pv-line);
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
    font-size: 20px;
    font-weight: 600;
    color: var(--pv-ink);
  }

  /* The loader shows a Carton spinner, not ReplayWeb.page's own logo. */
  fa-icon[aria-label="ReplayWeb.page Logo"] {
    display: none;
  }

  .is-justify-content-center:has(> fa-icon[aria-label="ReplayWeb.page Logo"])::before {
    content: "";
    width: 28px;
    height: 28px;
    margin-bottom: 16px;
    border: 2.5px solid var(--pv-edge);
    border-top-color: var(--pv-accent);
    border-radius: 50%;
    animation: pv-spin 0.9s linear infinite;
  }

  @keyframes pv-spin {
    to {
      transform: rotate(360deg);
    }
  }

  progress.progress::-webkit-progress-bar {
    background: var(--pv-fill);
  }

  progress.progress::-webkit-progress-value {
    background: var(--pv-accent);
  }
`;

/** Adds the Carton layer to a ReplayWeb.page component we do not own. */
export function themeElement(tag: string) {
  const ctor = customElements.get(tag) as unknown as { elementStyles?: unknown[] } | undefined;
  if (ctor?.elementStyles && !ctor.elementStyles.includes(carton)) {
    ctor.elementStyles = [...ctor.elementStyles, carton];
  }
}
