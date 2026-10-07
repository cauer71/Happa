import { html } from "./util.js";

// Schlichte Linien-Symbole im Stil der SF Symbols (24er Raster)
const svg = (paths, fill = false) => html`<svg viewBox="0 0 24 24" fill=${fill ? "currentColor" : "none"}
  stroke=${fill ? "none" : "currentColor"} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true">${paths}</svg>`;

export const Icon = {
  today: () => svg(html`<path d="M7 3v8a2 2 0 0 0 4 0V3M9 3v18M16.5 3C14.6 3 14 6 14 9s1 4 2.5 4v8M16.5 3c1.3 0 2.5 2.5 2.5 6"/>`),
  chart: () => svg(html`<path d="M3 20h18"/><path d="M5 16l4.5-5 4 3L20 6"/><path d="M15 6h5v5"/>`),
  person: () => svg(html`<circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-4 4.3-6 8-6s6.8 2 8 6"/>`),
  camera: () => svg(html`<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3l1.4-2h5.6l1.4 2h1.3A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>`),
  plus: () => svg(html`<path d="M12 5v14M5 12h14"/>`),
  close: () => svg(html`<path d="M6 6l12 12M18 6L6 18"/>`),
  check: () => svg(html`<path d="M5 12.5l4.5 4.5L19 7.5"/>`),
  search: () => svg(html`<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>`),
  barcode: () => svg(html`<path d="M4 6v12M7 6v12M10.5 6v12M13 6v12M16.5 6v12M20 6v12"/>`),
  pencil: () => svg(html`<path d="M15.5 4.5l4 4L8 20H4v-4z"/><path d="M13.5 6.5l4 4"/>`),
  photo: () => svg(html`<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16l-5-5-8 8"/>`),
  chevron: () => svg(html`<path d="M9 5l7 7-7 7"/>`),
  back: () => svg(html`<path d="M15 5l-7 7 7 7"/>`),
  left: () => svg(html`<path d="M14.5 6l-6 6 6 6"/>`),
  right: () => svg(html`<path d="M9.5 6l6 6-6 6"/>`),
  dumbbell: () => svg(html`<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>`),
  star: () => svg(html`<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>`),
  starFill: () => svg(html`<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>`, true),
  trash: () => svg(html`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>`),
  scale: () => svg(html`<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M8.5 9a5 5 0 0 1 7 0L13 11.5"/>`),
  drop: () => svg(html`<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/>`),
  flame: () => svg(html`<path d="M12 21c-3.9 0-7-2.7-7-6.6 0-3.6 2.8-5.7 4-9.4 1.9 1.5 2.4 3.4 2.4 4.9C12.6 8.6 14 7.4 14.6 5c2.5 2.3 4.4 5.4 4.4 9.4 0 3.9-3.1 6.6-7 6.6z"/>`),
  target: () => svg(html`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`),
  bolt: () => svg(html`<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>`),
  moon: () => svg(html`<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>`),
  download: () => svg(html`<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>`),
  logout: () => svg(html`<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>`),
  info: () => svg(html`<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>`),
  sparkles: () => svg(html`<path d="M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z"/>`),
  refresh: () => svg(html`<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4.5V9h-4.5"/>`),
  bulb: () => svg(html`<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>`),
  flash: () => svg(html`<path d="M13 3L6 14h5l-1 7 7-11h-5z"/>`),
};
