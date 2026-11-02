const DB_NAME = "empires-of-wars";
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("saves");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export const browserStorage = {
  async read(key = "current") {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("saves").objectStore("saves").get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  },
  async write(bytes, isValid) {
    const db = await database();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("saves", "readwrite"),
          store = tx.objectStore("saves");
        const previous = store.get("current");
        previous.onsuccess = () => {
          try {
            if (previous.result && isValid(previous.result))
              store.put(previous.result, "backup");
            store.put(bytes, "current");
          } catch {
            tx.abort();
          }
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () =>
          reject(tx.error || new Error("Save transaction was cancelled."));
      });
    } finally {
      db.close();
    }
  },
};
