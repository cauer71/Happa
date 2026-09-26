// Kleine Vorschaubilder der fotografierten Mahlzeiten – nur im Browser (IndexedDB),
// damit die Datenbank auf dem Server schlank bleibt.

const DB = "happa";
const STORE = "thumbs";
let dbp = null;
const memory = new Map();

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
  }
  return dbp;
}

export async function putThumb(id, dataUrl) {
  memory.set(id, dataUrl);
  const db = await open();
  if (!db) return;
  db.transaction(STORE, "readwrite").objectStore(STORE).put(dataUrl, id);
}

export async function getThumb(id) {
  if (memory.has(id)) return memory.get(id);
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => { if (req.result) memory.set(id, req.result); resolve(req.result || null); };
    req.onerror = () => resolve(null);
  });
}

export async function deleteThumb(id) {
  memory.delete(id);
  const db = await open();
  if (!db) return;
  db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
}

export async function clearThumbs() {
  memory.clear();
  const db = await open();
  if (!db) return;
  db.transaction(STORE, "readwrite").objectStore(STORE).clear();
}
