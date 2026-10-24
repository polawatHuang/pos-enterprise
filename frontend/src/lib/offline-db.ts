/**
 * Tiny IndexedDB wrapper for what the till keeps for the days the internet is down: a copy of the
 * product list (to keep scanning) and the queue of cash bills not yet sent. Everything degrades to
 * "no offline mode" when IndexedDB is unavailable (private window, blocked storage).
 */
const DB_NAME = "pos-offline";
const STORES = { catalog: "catalog", queue: "queue" } as const;

let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORES.catalog);
      req.result.createObjectStore(STORES.queue, { keyPath: "clientRef" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

async function run<T>(store: keyof typeof STORES, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const idbPut = <T>(store: keyof typeof STORES, value: T, key?: IDBValidKey) => run(store, "readwrite", (s) => s.put(value, key));
export const idbGet = <T>(store: keyof typeof STORES, key: IDBValidKey) => run<T | undefined>(store, "readonly", (s) => s.get(key));
export const idbAll = <T>(store: keyof typeof STORES) => run<T[]>(store, "readonly", (s) => s.getAll());
export const idbDelete = (store: keyof typeof STORES, key: IDBValidKey) => run(store, "readwrite", (s) => s.delete(key));
