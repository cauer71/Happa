// Kamera: Speisen per KI erkennen (Workers AI) oder Barcode scannen (Open Food Facts).
import { useState, useEffect, useRef } from "preact/hooks";
import { html, cx, haptic, uid, n0, parseNum, drawScaled, squareThumb, loadImage } from "../util.js";
import { Icon } from "../icons.js";
import { openOverlay, closeOverlay, state, toast } from "../store.js";
import { Seg } from "../ui.js";
import { mealForNow, makeEntry } from "../nutrition.js";
import { searchFoods, productAsFood } from "../foods.js";
import { api } from "../api.js";
import { commitEntries, mealOptions, openAdd, openPortion, openManual } from "./add.js";

const ZXING = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/+esm";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function openCamera({ meal, d, mode = "food" } = {}) {
  openOverlay((o) => html`<${CameraView} ...${o} meal=${meal ?? mealForNow()} d=${d ?? state.selected} initialMode=${mode}/>`);
}

// Barcode-Erkennung: eingebaut (Android/Chrome) oder ZXing (iPhone/Safari), bei Bedarf nachgeladen
async function makeDetector() {
  if ("BarcodeDetector" in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes("ean_13")) {
        const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"].filter((f) => formats.includes(f)) });
        return async (source) => (await det.detect(source))[0]?.rawValue || null;
      }
    } catch { /* weiter mit ZXing */ }
  }
  const { BrowserMultiFormatReader } = await import(ZXING);
  const reader = new BrowserMultiFormatReader();
  const canvas = document.createElement("canvas");
  return async (source) => {
    const w = source.videoWidth || source.naturalWidth || source.width;
    const h = source.videoHeight || source.naturalHeight || source.height;
    if (!w) return null;
    const scale = Math.min(1, 1000 / w);
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    try { return reader.decodeFromCanvas(canvas).getText(); } catch { return null; }
  };
}

function CameraView({ id, closing, meal: initialMeal, d, initialMode }) {
  const [mode, setMode] = useState(initialMode);
  const [stage, setStage] = useState("starting"); // starting | live | nolive | analyzing | result | error | lookup
  const [meal, setMeal] = useState(initialMeal);
  const [photo, setPhoto] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [codeText, setCodeText] = useState("");
  const [scanNote, setScanNote] = useState("");
  const video = useRef();
  const stream = useRef(null);
  const fileCapture = useRef();
  const fileGallery = useRef();

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  const start = async () => {
    setStage("starting");
    if (!navigator.mediaDevices?.getUserMedia) { setStage("nolive"); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false,
      });
      stream.current = s;
      video.current.srcObject = s;
      await video.current.play().catch(() => {});
      setStage("live");
    } catch {
      setStage("nolive");
    }
  };
  useEffect(() => { start(); return stop; }, []);
  useEffect(() => { if (closing) stop(); }, [closing]);
  const close = () => { stop(); closeOverlay(id); };

  // ── Barcode-Schleife ──
  useEffect(() => {
    if (mode !== "barcode" || stage !== "live") return;
    let cancelled = false;
    setScanNote("Barcode in den Rahmen halten");
    (async () => {
      let detect;
      try { detect = await makeDetector(); }
      catch { setScanNote("Barcode-Erkennung nicht verfügbar – Nummer eingeben"); return; }
      while (!cancelled) {
        const code = video.current && video.current.readyState >= 2 ? await detect(video.current) : null;
        if (code && /^\d{6,14}$/.test(code)) { if (!cancelled) lookup(code); return; }
        await sleep(220);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, stage]);

  const lookup = async (code) => {
    haptic("success");
    setStage("lookup");
    try {
      const { product } = await api(`/food/barcode/${code}`);
      stop();
      closeOverlay(id);
      openPortion(productAsFood(product), meal, d);
    } catch (err) {
      toast(err.status === 404 ? `Produkt ${code} ist bei Open Food Facts nicht bekannt` : err.message, "🔎");
      setStage(stream.current ? "live" : "nolive");
    }
  };

  // ── Foto → KI ──
  const analyze = async (p, withHint) => {
    setPhoto(p);
    setStage("analyzing");
    setError("");
    try {
      const res = await api("/recognize", { method: "POST", body: { image: p.image, d, hint: withHint || undefined } });
      if (!res.items.length) {
        setError("Auf dem Foto habe ich kein Essen erkannt. Versuch es noch einmal – am besten von schräg oben und mit gutem Licht.");
        setStage("error");
        return;
      }
      const items = res.items.map((it) => ({ ...it, on: true, text: String(it.grams), alts: [], alt: null }));
      setResult({ ...res, items });
      setStage("result");
      haptic("success");
      items.forEach((it, i) => searchFoods(it.query || it.name, 3).then((alts) =>
        setResult((r) => r && { ...r, items: r.items.map((x, j) => (j === i ? { ...x, alts } : x)) })).catch(() => {}));
    } catch (err) {
      setError(err.message);
      setStage("error");
    }
  };
  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    haptic("heavy");
    const p = { image: drawScaled(v, 1024), thumb: squareThumb(v, 160) };
    p.preview = p.image;
    stop();
    analyze(p);
  };
  const onFile = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    try {
      const img = await loadImage(file);
      if (mode === "barcode") {
        const detect = await makeDetector();
        const code = await detect(img);
        if (code) lookup(code); else toast("Auf dem Foto wurde kein Barcode gefunden", "🔎");
        return;
      }
      stop();
      analyze({ image: drawScaled(img, 1024), thumb: squareThumb(img, 160), preview: drawScaled(img, 1600, 0.85) });
    } catch (err) { toast(err.message, "⚠️"); }
  };
  const retake = () => { setResult(null); setPhoto(null); setHint(""); start(); };

  // ── Ergebnis bearbeiten ──
  const upd = (i, patch) => setResult((r) => ({ ...r, items: r.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const valuesOf = (it) => {
    const grams = Math.max(0, parseNum(it.text) || 0);
    const per100 = it.alt ? it.alt.per100 : {
      kcal: (it.kcal / it.grams) * 100, protein: (it.protein / it.grams) * 100,
      carbs: (it.carbs / it.grams) * 100, fat: (it.fat / it.grams) * 100,
    };
    return { grams, per100, kcal: per100.kcal * grams / 100 };
  };
  const chosen = result ? result.items.filter((it) => it.on && valuesOf(it).grams > 0) : [];
  const total = chosen.reduce((s, it) => s + valuesOf(it).kcal, 0);

  const commit = async () => {
    setBusy(true);
    const entries = chosen.map((it) => {
      const v = valuesOf(it);
      return makeEntry({ id: uid(), meal, name: it.name.trim() || "Mahlzeit", grams: v.grams, per100: v.per100, src: it.alt ? "b" : "k", emoji: it.emoji });
    });
    const foods = chosen.map((it) => {
      const v = valuesOf(it);
      return [{ name: it.name, emoji: it.emoji, per100: v.per100, src: it.alt ? "b" : "k", grams: v.grams, source: it.alt ? "BLS" : "KI-Foto" }, v.grams];
    });
    try {
      await commitEntries(d, entries, { thumb: photo?.thumb, foods });
      close();
    } catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };

  const showVideo = stage === "live" || stage === "starting" || (stage === "lookup" && stream.current);
  const frozen = photo && (stage === "analyzing" || stage === "result" || stage === "error");

  return html`
    <div class=${cx("camera", closing && "closing")} style=${closing ? "animation:fade-out .3s both" : ""}>
      <video ref=${video} playsinline muted autoplay style=${showVideo ? "" : "display:none"}></video>
      ${frozen && html`<img class="frozen" src=${photo.preview} alt="Aufgenommenes Foto"/>`}

      <div class="camera-top">
        <button class="icon-btn glass-dark" aria-label="Schließen" onClick=${close}>${Icon.close()}</button>
        ${(stage === "live" || stage === "starting" || stage === "nolive") && html`
          <div class="glass-dark" style="border-radius:14px;width:200px">
            <${Seg} options=${[{ value: "food", label: "Essen" }, { value: "barcode", label: "Barcode" }]} value=${mode} onChange=${setMode}/>
          </div>`}
        <button class="icon-btn glass-dark" aria-label="Stattdessen suchen" onClick=${() => { close(); openAdd(meal, d); }}>${Icon.search()}</button>
      </div>

      ${stage === "live" && html`<div class="viewfinder" style=${mode === "barcode" ? "aspect-ratio:1.9;border-radius:24px" : ""}></div>`}
      ${stage === "live" && html`<div class="camera-hint glass-dark">${mode === "barcode" ? scanNote : "Das ganze Essen ins Bild – von schräg oben"}</div>`}

      ${stage === "nolive" && html`
        <div class="scan" style="background:none;padding:24px">
          <div style="font-size:54px">${mode === "barcode" ? "🏷️" : "📸"}</div>
          <div style="font-size:20px;font-weight:700">${mode === "barcode" ? "Barcode fotografieren" : "Essen fotografieren"}</div>
          <div style="opacity:.75;max-width:300px;font-size:15px">Die Live-Kamera ist nicht verfügbar. Mach einfach ein Foto oder wähle eines aus der Galerie.</div>
          <button class="btn btn-primary" onClick=${() => fileCapture.current.click()}>${Icon.camera()} Foto aufnehmen</button>
          <button class="btn glass-dark" onClick=${() => fileGallery.current.click()}>${Icon.photo()} Aus der Galerie</button>
        </div>`}

      ${mode === "barcode" && (stage === "live" || stage === "nolive") && html`
        <form class="glass-dark" style="position:absolute;left:16px;right:16px;bottom:calc(var(--safe-bottom) + 132px);border-radius:22px;padding:6px;display:flex;gap:6px;max-width:420px;margin:0 auto"
          onSubmit=${(e) => { e.preventDefault(); const c = codeText.replace(/\D/g, ""); if (c.length >= 6) lookup(c); }}>
          <input class="field" style="background:rgba(255,255,255,.14);color:#fff;height:44px" inputmode="numeric" placeholder="Nummer unter dem Barcode"
            value=${codeText} onInput=${(e) => setCodeText(e.currentTarget.value)} aria-label="Barcode-Nummer"/>
          <button class="btn btn-primary small" style="height:44px" type="submit">Suchen</button>
        </form>`}

      ${(stage === "live" || stage === "nolive" || stage === "starting") && html`
        <div class="camera-bottom">
          <button class="icon-btn glass-dark" style="width:52px;height:52px;border-radius:26px" aria-label="Aus der Galerie" onClick=${() => fileGallery.current.click()}>${Icon.photo()}</button>
          ${mode === "food" && stage === "live" ? html`<button class="shutter" aria-label="Foto aufnehmen" onClick=${capture}></button>` : html`<div style="width:80px"></div>`}
          <button class="icon-btn glass-dark" style="width:52px;height:52px;border-radius:26px" aria-label="Manuell eintragen" onClick=${() => { close(); openManual(meal, d); }}>${Icon.pencil()}</button>
        </div>`}

      ${(stage === "analyzing" || stage === "lookup") && html`
        <div class="scan">
          <div class="scan-label glass-dark"><span class="spinner"></span>${stage === "lookup" ? "Suche Produkt …" : "Happa schaut genau hin …"}</div>
        </div>`}

      ${stage === "error" && html`
        <div class="sheet" style="position:absolute;color:var(--text)">
          <div class="sheet-body" style="padding-top:22px;text-align:center">
            <div style="font-size:44px">🤔</div>
            <p style="font-size:17px;margin:8px 0 18px">${error}</p>
            <button class="btn btn-primary block" onClick=${retake}>${Icon.camera()} Neues Foto</button>
            <button class="btn btn-tint block" style="margin-top:10px" onClick=${() => { close(); openAdd(meal, d); }}>${Icon.search()} Stattdessen suchen</button>
          </div>
        </div>`}

      ${stage === "result" && result && html`
        <section class="sheet" style="position:absolute;max-height:74dvh;color:var(--text)" aria-label="Erkannte Speisen">
          <div class="sheet-head" style="padding-top:14px">
            <button class="icon-btn sm fill" aria-label="Neues Foto" onClick=${retake}>${Icon.refresh()}</button>
            <div class="sheet-title">${result.dish || "Erkannt"}</div>
            <div style="width:32px"></div>
          </div>
          <div class="sheet-body">
            <${Seg} options=${mealOptions} value=${meal} onChange=${setMeal}/>
            <div style="margin-top:12px">
              ${result.items.map((it, i) => {
                const v = valuesOf(it);
                return html`
                  <div class=${cx("ai-item", !it.on && "off")} key=${i}>
                    <div class="top">
                      <button class=${cx("check", it.on && "on")} aria-label=${it.on ? "Abwählen" : "Auswählen"} onClick=${() => { haptic(); upd(i, { on: !it.on }); }}>${Icon.check()}</button>
                      <div style="font-size:26px">${it.emoji}</div>
                      <div class="grow"><input class="name" value=${it.name} aria-label="Bezeichnung" onInput=${(e) => upd(i, { name: e.currentTarget.value })}/>
                        <div class="row" style="gap:6px;font-size:12px;color:var(--text-2)"><div class="conf"><i style=${`width:${it.confidence * 100}%`}></i></div>${it.confidence >= 0.75 ? "ziemlich sicher" : it.confidence >= 0.45 ? "unsicher" : "geraten"}</div>
                      </div>
                      <div class="entry-kcal">${n0(v.kcal)} <span class="muted" style="font-size:12px">kcal</span></div>
                    </div>
                    <div class="gram-row">
                      <button class="icon-btn sm fill" aria-label="Weniger" onClick=${() => { haptic(); upd(i, { text: String(Math.max(0, v.grams - 10)) }); }}>−</button>
                      <input inputmode="decimal" value=${it.text} aria-label="Gramm" onInput=${(e) => upd(i, { text: e.currentTarget.value })} onFocus=${(e) => e.currentTarget.select()}/>
                      <span class="muted" style="font-size:14px">g</span>
                      <button class="icon-btn sm fill" aria-label="Mehr" onClick=${() => { haptic(); upd(i, { text: String(v.grams + 10) }); }}>+</button>
                    </div>
                    ${it.alts.length > 0 && html`
                      <div class="alt">
                        <div style="font-size:12px;color:var(--text-2);margin-bottom:6px">Nährwerte aus der Datenbank verwenden:</div>
                        <div class="chips">
                          <button class=${cx("chip", !it.alt && "on")} onClick=${() => upd(i, { alt: null })}>KI-Schätzung</button>
                          ${it.alts.map((a) => html`<button class=${cx("chip", it.alt?.name === a.name && "on")} onClick=${() => { haptic(); upd(i, { alt: a }); }}>${a.name}</button>`)}
                        </div>
                      </div>`}
                  </div>`;
              })}
            </div>
            <label class="label" for="ai-hint">Stimmt etwas nicht?</label>
            <div class="row" style="gap:8px">
              <input id="ai-hint" class="field" placeholder="z. B. „mit Vollkornnudeln, halbe Portion“" value=${hint} onInput=${(e) => setHint(e.currentTarget.value)}/>
              <button class="btn btn-tint small" style="height:50px" disabled=${!hint.trim()} onClick=${() => analyze(photo, hint.trim())}>${Icon.sparkles()}</button>
            </div>
            <p class="fine">Mengen und Nährwerte sind Schätzungen der KI (${result.model}). Noch ${result.left} Fotos heute.</p>
          </div>
          <div class="sheet-foot">
            <button class="btn btn-primary block" disabled=${!chosen.length || busy} onClick=${commit}>
              ${busy ? html`<span class="spinner"></span>` : html`${Icon.check()} ${chosen.length} ${chosen.length === 1 ? "Eintrag" : "Einträge"} · ${n0(total)} kcal eintragen`}
            </button>
          </div>
        </section>`}

      <input ref=${fileCapture} class="sr" type="file" accept="image/*" capture="environment" onChange=${onFile} tabindex="-1" aria-hidden="true"/>
      <input ref=${fileGallery} class="sr" type="file" accept="image/*" onChange=${onFile} tabindex="-1" aria-hidden="true"/>
    </div>`;
}
