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

function showImage(dataUrl) {
  imageDataUrl = dataUrl;
  snapshot.src = dataUrl;
  snapshot.hidden = false;
  placeholder.hidden = true;
  $('ocr').disabled = false;
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  preview.hidden = true;
  $('shoot').disabled = true;
}

$('startCam').addEventListener('click', async () => {
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
    $('shoot').disabled = false;
    setStatus('Kamera bereit.');
  } catch (err) {
    setStatus(`Kamera nicht verfügbar (${err.message}). Bitte "Bild auswählen" nutzen.`, 'error');
  }
});

$('shoot').addEventListener('click', () => {
  canvas.width = preview.videoWidth;
  canvas.height = preview.videoHeight;
  canvas.getContext('2d').drawImage(preview, 0, 0);
  showImage(canvas.toDataURL('image/jpeg', 0.9));
  stopCamera();
  setStatus('Foto aufgenommen.');
});

$('file').addEventListener('change', (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  stopCamera();
  const reader = new FileReader();
  reader.onload = () => {
    showImage(reader.result);
    setStatus(`Bild geladen: ${file.name}`);
  };
  reader.readAsDataURL(file);
});

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
    imageDataUrl: $('withImage').checked ? imageDataUrl : null,
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
