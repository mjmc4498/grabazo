// Grabazo — grabaciones guardadas en la computadora (IndexedDB del origen de la extensión).
//
//   chunks  partes de la grabación en curso (una por segundo): si Chrome se cierra a
//           mitad de una grabación, lo grabado hasta ahí se recupera al volver.
//   videos  datos de cada grabación terminada (título, duración, miniatura…)
//   blobs   el archivo de video de cada grabación (separado, para listar sin cargarlo)

const DB_NAME = 'grabazo';
const DB_VERSION = 1;
let opening = null;

export function openDb() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('chunks')) {
        const chunks = db.createObjectStore('chunks', { keyPath: ['rec', 'i'] });
        chunks.createIndex('rec', 'rec');
      }
      if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Otra pestaña con una versión nueva de la base: se cierra esta conexión.
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('abort'));
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------- grabación en curso

export async function saveChunk(rec, i, blob, meta = null) {
  const db = await openDb();
  const tx = db.transaction('chunks', 'readwrite');
  tx.objectStore('chunks').put({ rec, i, blob, ...(meta ? { meta } : {}) });
  return done(tx);
}

export async function chunksOf(rec) {
  const db = await openDb();
  const rows = await result(db.transaction('chunks').objectStore('chunks').index('rec').getAll(rec));
  return rows.sort((a, b) => a.i - b.i);
}

export async function clearChunks(rec) {
  const db = await openDb();
  const tx = db.transaction('chunks', 'readwrite');
  tx.objectStore('chunks').delete(IDBKeyRange.bound([rec, -Infinity], [rec, Infinity]));
  return done(tx);
}

// Grabaciones que quedaron a medias (Chrome se cerró o la pestaña del grabador se cerró).
export async function pendingRecordings() {
  const db = await openDb();
  const keys = await result(db.transaction('chunks').objectStore('chunks').getAllKeys());
  return [...new Set(keys.map((k) => k[0]))];
}

// ---------------------------------------------------------------- grabaciones terminadas

export async function putVideo(meta, blob) {
  const db = await openDb();
  const tx = db.transaction(['videos', 'blobs'], 'readwrite');
  tx.objectStore('videos').put(meta);
  if (blob) tx.objectStore('blobs').put({ id: meta.id, blob });
  return done(tx);
}

export async function getVideo(id) {
  const db = await openDb();
  const tx = db.transaction(['videos', 'blobs']);
  const [meta, row] = await Promise.all([result(tx.objectStore('videos').get(id)), result(tx.objectStore('blobs').get(id))]);
  return meta ? { meta, blob: row?.blob || null } : null;
}

export async function listVideos() {
  const db = await openDb();
  const rows = await result(db.transaction('videos').objectStore('videos').getAll());
  return rows.sort((a, b) => b.created - a.created);
}

export async function updateVideo(id, patch) {
  const db = await openDb();
  const tx = db.transaction('videos', 'readwrite');
  const store = tx.objectStore('videos');
  const meta = await result(store.get(id));
  if (meta) store.put({ ...meta, ...patch, id });
  await done(tx);
  return meta ? { ...meta, ...patch, id } : null;
}

export async function deleteVideo(id) {
  const db = await openDb();
  const tx = db.transaction(['videos', 'blobs'], 'readwrite');
  tx.objectStore('videos').delete(id);
  tx.objectStore('blobs').delete(id);
  return done(tx);
}

export function newId() {
  const t = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 5);
  return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}-${rand}`;
}

// «Grabación 17 oct 2026, 21:05»
export function defaultTitle(date = new Date()) {
  const d = date.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
  const h = date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `Grabación ${d}, ${h}`;
}
