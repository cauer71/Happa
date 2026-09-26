// Happa – Einstieg: Startanimation, Tabs, Overlays.
import { render } from "preact";
import { useEffect } from "preact/hooks";
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

function TabBar({ tab }) {
  const idx = TABS.findIndex((t) => t.id === tab);
  return html`
    <nav class="tabbar-wrap">
      <div class="tabbar glass" role="tablist">
        <i class="tab-lens" style=${`transform:translateX(${idx * 100}%)`}></i>
        ${TABS.map((t) => html`
          <button class=${cx("tab", t.id === tab && "active")} role="tab" aria-selected=${t.id === tab}
            onClick=${() => setTab(t.id)}>${t.icon()}<span>${t.label}</span></button>`)}
      </div>
      <button class="fab" aria-label="Essen fotografieren" onClick=${() => { haptic(); openCamera({}); }}>${Icon.camera()}</button>
    </nav>`;
}

function Overlays({ overlays }) {
  return overlays.map((o) => html`<div key=${o.id}>${o.render({ id: o.id, closing: o.closing })}</div>`);
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
  return html`
    ${s.phase === "onboarding" ? html`<${Onboarding}/>` : html`<div key=${s.tab}><${View}/></div><${TabBar} tab=${s.tab}/>`}
    <${Overlays} overlays=${s.overlays}/>
    <${Toast}/>
    <${Celebrate}/>`;
}

// ── Start ──
const started = performance.now();
const initialTab = location.hash.slice(1);
if (TABS.some((t) => t.id === initialTab)) state.tab = initialTab;

function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = Math.max(0, (reduce ? 300 : 1500) - (performance.now() - started));
  setTimeout(() => {
    splash.classList.add("out");
    setTimeout(() => splash.remove(), 600);
  }, wait);
}

render(html`<${App}/>`, document.getElementById("app"));
boot().finally(hideSplash);

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
