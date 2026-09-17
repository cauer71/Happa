// Ablauf: Foto aufnehmen -> Text erkennen -> Text an den Server (Datenbank).
// Zwei Erkennungswege: serverseitig über Workers AI (genau) oder Tesseract.js
// im Browser (funktioniert offline, liest aber deutlich schlechter).
const $ = (id) => document.getElementById(id);
const preview = $('preview');
const snapshot = $('snapshot');
const placeholder = $('placeholder');
const canvas = $('canvas');
const statusEl = $('status');
const progress = $('progress');
const textEl = $('text');

let stream = null;
let imageDataUrl = null;
let lastEngine = null;
let lastConfidence = null;

function setStatus(msg, kind = '') {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`;
}

// Fotos werden vor der Erkennung verkleinert: schneller hochgeladen und für
// die Modelle völlig ausreichend. Das Bild verlässt den Browser nur für den
// Leseauftrag, gespeichert wird ausschließlich der Text.
function downscale(dataUrl, maxSide = 1600, quality = 0.9) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      if (scale === 1 && dataUrl.length < 700_000) return resolve(dataUrl);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function showImage(dataUrl) {
  imageDataUrl = await downscale(dataUrl);
  snapshot.src = imageDataUrl;
  snapshot.hidden = false;
  preview.hidden = true;
  placeholder.hidden = true;
  $('ocr').disabled = false;
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  preview.hidden = true;
  $('shoot').hidden = true;
  $('startCam').textContent = 'Livekamera';
}

// Kamera und Galerie laufen über die File-Inputs - der Weg, der auf iOS und
// Android zuverlässig funktioniert. Die Livevorschau braucht getUserMedia und
// ist nur über HTTPS bzw. localhost erlaubt.
function liveCameraPossible() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

$('photoBtn').addEventListener('click', () => $('camInput').click());
$('pickBtn').addEventListener('click', () => $('pickInput').click());

$('startCam').hidden = !liveCameraPossible();

$('startCam').addEventListener('click', async () => {
  if (stream) { stopCamera(); setStatus(''); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 2048 } },
      audio: false,
    });
    preview.srcObject = stream;
    preview.hidden = false;
    snapshot.hidden = true;
    placeholder.hidden = true;
    await preview.play();
    $('shoot').hidden = false;
    $('startCam').textContent = 'Livekamera aus';
    setStatus('Kamera bereit.');
  } catch (err) {
    stream = null;
    $('startCam').hidden = true;
    setStatus('Die Livekamera ist nicht verfügbar. Nimm „Foto aufnehmen“ — das öffnet die Kamera des Geräts.', 'error');
  }
});

$('shoot').addEventListener('click', () => {
  canvas.width = preview.videoWidth;
  canvas.height = preview.videoHeight;
  canvas.getContext('2d').drawImage(preview, 0, 0);
  showImage(canvas.toDataURL('image/jpeg', 0.9)).then(() => setStatus('Foto aufgenommen.'));
  stopCamera();
});

function fileChosen(ev) {
  const input = ev.target;
  const file = input.files?.[0];
  if (!file) return;
  stopCamera();
  const reader = new FileReader();
  reader.onload = async () => {
    await showImage(reader.result);
    setStatus('Foto übernommen. Jetzt ablesen lassen.');
    input.value = '';   // dasselbe Foto lässt sich sonst kein zweites Mal wählen
  };
  reader.readAsDataURL(file);
}
$('camInput').addEventListener('change', fileChosen);
$('pickInput').addEventListener('change', fileChosen);

// --- Erkennung --------------------------------------------------------------

async function readWithAi() {
  setStatus('Der Server liest das Foto…');
  const res = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      imageDataUrl,
      language: $('lang').value,
      mode: $('mode').value,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return { text: json.empty ? '' : json.text, confidence: null };
}

async function readWithTesseract() {
  const lang = $('lang').selectedOptions[0].dataset.tess || 'deu';
  progress.hidden = false;
  progress.value = 0;
  setStatus('Sprachdaten werden geladen, das kann beim ersten Mal dauern …');
  try {
    const { data } = await Tesseract.recognize(imageDataUrl, lang, {
      logger: (m) => {
        if (typeof m.progress === 'number') progress.value = m.progress;
        if (m.status) setStatus(`${m.status} … ${Math.round((m.progress ?? 0) * 100)} %`);
      },
    });
    return { text: data.text.trim(), confidence: data.confidence ?? null };
  } finally {
    progress.hidden = true;
  }
}

$('ocr').addEventListener('click', async () => {
  if (!imageDataUrl) return;
  const engine = $('engine').value;
  $('ocr').disabled = true;
  textEl.value = '';
  updateSaveState();

  try {
    const result = engine === 'ai' ? await readWithAi() : await readWithTesseract();
    textEl.value = result.text;
    lastEngine = engine;
    lastConfidence = result.confidence;
    updateSaveState();

    if (!result.text) {
      setStatus('Auf dem Foto war kein lesbarer Text. Näher heran, mehr Licht, dann noch einmal.', 'error');
    } else if (engine === 'ai') {
      setStatus('Abgelesen. Text prüfen und speichern.', 'ok');
    } else {
      setStatus(`Abgelesen (Konfidenz ${Math.round(result.confidence ?? 0)} %). Text prüfen und speichern.`, 'ok');
    }
  } catch (err) {
    setStatus(engine === 'ai'
      ? `Serverseitige Erkennung fehlgeschlagen: ${err.message}. Du kannst auf „Im Browser“ umschalten.`
      : `Erkennung fehlgeschlagen: ${err.message}`, 'error');
  } finally {
    $('ocr').disabled = false;
  }
});

// --- Speichern und Liste ----------------------------------------------------

function updateSaveState() {
  $('save').disabled = !textEl.value.trim();
}
textEl.addEventListener('input', updateSaveState);

$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  try {
    const res = await fetch('/api/scans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: textEl.value,
        language: $('lang').value,
        confidence: lastConfidence,
        engine: lastEngine,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? res.statusText);
    setStatus(`Gespeichert (ID ${json.id}).`, 'ok');
    await loadList();
  } catch (err) {
    setStatus(`Speichern fehlgeschlagen: ${err.message}`, 'error');
  } finally {
    updateSaveState();
  }
});

const ENGINE_LABEL = { ai: 'Server-KI', tesseract: 'Browser' };

async function loadList() {
  const res = await fetch('/api/scans?limit=50');
  const { scans } = await res.json();
  const list = $('list');
  list.innerHTML = '';
  if (!scans.length) {
    list.innerHTML = '<li class="empty">Noch keine Einträge.</li>';
    return;
  }
  for (const scan of scans) {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const parts = [`#${scan.id}`, new Date(scan.created_at).toLocaleString('de-DE'), scan.language ?? '—'];
    if (scan.engine) parts.push(ENGINE_LABEL[scan.engine] ?? scan.engine);
    if (scan.confidence) parts.push(`${Math.round(scan.confidence)} %`);
    meta.textContent = parts.join(' · ');

    const pre = document.createElement('pre');
    pre.textContent = scan.text;

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Löschen';
    del.addEventListener('click', async () => {
      await fetch(`/api/scans/${scan.id}`, { method: 'DELETE' });
      await loadList();
    });

    meta.append(del);
    li.append(meta, pre);
    list.append(li);
  }
}

$('reload').addEventListener('click', loadList);
loadList();
