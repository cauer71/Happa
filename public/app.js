// Ablauf: Foto aufnehmen -> Tesseract.js erkennt den Text -> Text an den Server (SQLite).
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

function setStatus(msg, kind = '') {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`;
}

// Fotos werden vor der OCR verkleinert - das beschleunigt die Erkennung.
// Das Bild verlaesst den Browser nie, gespeichert wird ausschliesslich der Text.
function downscale(dataUrl, maxSide = 1600, quality = 0.85) {
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

// Kamera und Galerie laufen ueber die File-Inputs - der Weg, der auf iOS und
// Android zuverlaessig funktioniert. Die Livevorschau braucht getUserMedia und
// ist nur ueber HTTPS bzw. localhost erlaubt.
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
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
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
    setStatus('Foto übernommen. Jetzt OCR starten.');
    input.value = '';   // dasselbe Foto laesst sich sonst kein zweites Mal waehlen
  };
  reader.readAsDataURL(file);
}
$('camInput').addEventListener('change', fileChosen);
$('pickInput').addEventListener('change', fileChosen);

$('ocr').addEventListener('click', async () => {
  if (!imageDataUrl) return;
  const lang = $('lang').value;
  $('ocr').disabled = true;
  progress.hidden = false;
  progress.value = 0;
  setStatus('Sprachdaten werden geladen, das kann beim ersten Mal etwas dauern …');

  try {
    const { data } = await Tesseract.recognize(imageDataUrl, lang, {
      logger: (m) => {
        if (typeof m.progress === 'number') progress.value = m.progress;
        if (m.status) setStatus(`${m.status} … ${Math.round((m.progress ?? 0) * 100)} %`);
      },
    });
    textEl.value = data.text.trim();
    textEl.dataset.confidence = data.confidence ?? '';
    $('save').disabled = !textEl.value;
    setStatus(
      textEl.value
        ? `Erkennung fertig (Konfidenz ${Math.round(data.confidence)} %). Text prüfen und speichern.`
        : 'Kein Text erkannt. Anderes Foto oder bessere Beleuchtung versuchen.',
      textEl.value ? 'ok' : 'error'
    );
  } catch (err) {
    setStatus(`OCR fehlgeschlagen: ${err.message}`, 'error');
  } finally {
    progress.hidden = true;
    $('ocr').disabled = false;
  }
});

textEl.addEventListener('input', () => {
  $('save').disabled = !textEl.value.trim();
});

$('save').addEventListener('click', async () => {
  const body = {
    text: textEl.value,
    language: $('lang').value,
    confidence: Number(textEl.dataset.confidence) || null,
  };
  $('save').disabled = true;
  try {
    const res = await fetch('/api/scans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? res.statusText);
    setStatus(`Gespeichert (ID ${json.id}).`, 'ok');
    await loadList();
  } catch (err) {
    setStatus(`Speichern fehlgeschlagen: ${err.message}`, 'error');
  } finally {
    $('save').disabled = !textEl.value.trim();
  }
});

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
    meta.textContent = `#${scan.id} · ${new Date(scan.created_at).toLocaleString('de-DE')} · ${scan.language ?? '—'}`
      + (scan.confidence ? ` · ${Math.round(scan.confidence)} %` : '');
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
