const DB_NAME = "playable-player-db";
const DB_VERSION = 1;
const PLAYABLE_STORE = "playables";
const FILE_STORE = "files";

export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PLAYABLE_STORE)) {
        db.createObjectStore(PLAYABLE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listPlayables() {
  const db = await openDb();
  return withStore(db, PLAYABLE_STORE, "readonly", (store) => getAll(store));
}

export async function savePlayable(playable, files) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PLAYABLE_STORE, FILE_STORE], "readwrite");
    tx.objectStore(PLAYABLE_STORE).put(playable);
    for (const file of files) {
      tx.objectStore(FILE_STORE).put(file);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function deletePlayable(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PLAYABLE_STORE, FILE_STORE], "readwrite");
    tx.objectStore(PLAYABLE_STORE).delete(id);
    const fileStore = tx.objectStore(FILE_STORE);
    const cursorRequest = fileStore.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      if (cursor.key.startsWith(`${id}/`)) {
        cursor.delete();
      }
      cursor.continue();
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function updatePlayable(playable) {
  const db = await openDb();
  return withStore(db, PLAYABLE_STORE, "readwrite", (store) => put(store, playable));
}

export async function clearLibrary() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PLAYABLE_STORE, FILE_STORE], "readwrite");
    tx.objectStore(PLAYABLE_STORE).clear();
    tx.objectStore(FILE_STORE).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

function withStore(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    Promise.resolve(fn(store)).then(resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

function getAll(store) {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function put(store, value) {
  return new Promise((resolve, reject) => {
    const request = store.put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
