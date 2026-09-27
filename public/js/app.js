// Happa – Einstieg: Startanimation, Tabs, Overlays.
import { render } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { html, cx, haptic, applyTheme } from "./util.js";
import { useStore, boot, state, setTab } from "./store.js";
import { Icon } from "./icons.js";
import { Toast, Celebrate } from "./ui.js";
import { TodayView } from "./views/today.js";
import { ProgressView } from "./views/progress.js";
import { ProfileView } from "./views/profile.js";
import { Onboarding } from "./views/onboarding.js";
import { openCamera } from "./views/camera.js";

const TABS = [
  { id: "heute", label: "Heute", icon: Icon.today },
  { id: "fortschritt", label: "Fortschritt", icon: Icon.chart },
  { id: "profil", label: "Profil", icon: Icon.person },
];

// Die Glas-Linse gleitet unter den aktiven Tab – unten als Kapsel, am PC in der Seitenleiste.
function TabBar({ tab, inert }) {
  const bar = useRef();
  const lens = useRef();
  useLayoutEffect(() => {
    const place = () => {
      const el = bar.current?.querySelector(".tab.active");
      const l = lens.current;
      if (!el || !l) return;
      const first = !l.dataset.placed;
      if (first) l.style.transition = "none"; // beim Start nicht hineingleiten
      l.style.width = el.offsetWidth + "px";
      l.style.height = el.offsetHeight + "px";
      l.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
      if (first) { void l.offsetWidth; l.style.transition = ""; l.dataset.placed = "1"; }
    };
    place();
    addEventListener("resize", place);
    return () => removeEventListener("resize", place);
  }, [tab]);
  return html`
    <nav class="tabbar-wrap" aria-label="Hauptnavigation" inert=${inert}>
      <div ref=${bar} class="tabbar glass">
        <i ref=${lens} class="tab-lens" aria-hidden="true"></i>
        ${TABS.map((t) => html`
          <button class=${cx("tab", t.id === tab && "active")} aria-current=${t.id === tab ? "page" : undefined}
            onClick=${() => setTab(t.id)}>${t.icon()}<span>${t.label}</span></button>`)}
      </div>
      <button class="fab" aria-label="Essen fotografieren"
        onClick=${() => { haptic(); openCamera({ d: state.tab === "heute" ? state.selected : state.today }); }}>${Icon.camera()}</button>
    </nav>`;
}

// Nur das oberste Overlay ist bedienbar; darunterliegende sind "inert".
function Overlays({ overlays }) {
  const top = overlays.filter((o) => !o.closing).pop();
  return overlays.map((o) => html`<div key=${o.id} inert=${o !== top}>${o.render({ id: o.id, closing: o.closing })}</div>`);
}

function ErrorScreen({ message }) {
  return html`
    <main class="onb" style="justify-content:center">
      <div class="card glass center">
        <div style="font-size:44px">😕</div>
        <h2 style="margin:8px 0">Das hat nicht geklappt</h2>
        <p class="muted">${message}</p>
        <button class="btn btn-primary block" onClick=${() => location.reload()}>Erneut versuchen</button>
      </div>
    </main>`;
}

function App() {
  const s = useStore();
  useEffect(() => { applyTheme(s.profile.theme); }, [s.profile.theme]);
  useEffect(() => {
    document.body.classList.toggle("lock", s.overlays.length > 0 || !!s.celebrate);
  }, [s.overlays.length, s.celebrate]);

  if (s.phase === "boot") return null;
  if (s.phase === "error") return html`<${ErrorScreen} message=${s.error}/>`;

  const View = s.tab === "fortschritt" ? ProgressView : s.tab === "profil" ? ProfileView : TodayView;
  const covered = s.overlays.some((o) => !o.closing) || !!s.celebrate;
  return html`
    ${s.phase === "onboarding"
      ? html`<div inert=${covered}><${Onboarding}/></div>`
      : html`<div key=${s.tab} inert=${covered}><${View}/></div><${TabBar} tab=${s.tab} inert=${covered}/>`}
    <${Overlays} overlays=${s.overlays}/>
    <${Toast}/>
    <${Celebrate}/>`;
}

// ── Start ──
const started = performance.now();
const initialTab = location.hash.slice(1);
if (TABS.some((t) => t.id === initialTab)) state.tab = initialTab;

function hideSplash() {
  clearTimeout(window.__happaWatchdog);
  const splash = document.getElementById("splash");
  if (!splash) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = Math.max(0, (reduce ? 300 : 1500) - (performance.now() - started));
  setTimeout(() => {
    splash.classList.add("out");
    setTimeout(() => splash.remove(), 600);
  }, wait);
}

// iOS-Tastatur: Höhe als CSS-Variable, damit Sheets darüber bleiben
if (window.visualViewport) {
  const vv = window.visualViewport;
  const onVV = () => {
    const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb", (kb > 80 ? kb : 0) + "px");
  };
  vv.addEventListener("resize", onVV);
  vv.addEventListener("scroll", onVV);
}

render(html`<${App}/>`, document.getElementById("app"));
boot().finally(hideSplash);

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
