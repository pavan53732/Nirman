// IndexedDB persistence for Execution Engine checkpoints (and large memory
// snapshots). localStorage has a ~5MB cap and blocks the main thread; IndexedDB
// handles large builds (hundreds of MB) asynchronously, so resume-after-crash
// works for long, multi-target workflows.
//
// Stores:
//   - checkpoints: keyed by id, indexed by workflowId + ts
//   - memory: full memory snapshots keyed by version
//   - artifacts: versioned artifact blobs (optional, for very large solutions)

const DB_NAME = "pavan-engine";
const DB_VERSION = 1;
const STORE_CHECKPOINTS = "checkpoints";
const STORE_MEMORY = "memory";
const STORE_ARTIFACTS = "artifacts";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CHECKPOINTS)) {
        const store = db.createObjectStore(STORE_CHECKPOINTS, { keyPath: "id" });
        store.createIndex("workflowId", "workflowId", { unique: false });
        store.createIndex("ts", "ts", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MEMORY)) {
        db.createObjectStore(STORE_MEMORY, { keyPath: "version" });
      }
      if (!db.objectStoreNames.contains(STORE_ARTIFACTS)) {
        db.createObjectStore(STORE_ARTIFACTS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = fn(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

/* ---------------- Checkpoints ---------------- */

export interface PersistedCheckpoint {
  id: string;
  workflowId: string;
  stageId: string;
  taskId?: string;
  ts: number;
  stageStatusSnapshot: Record<string, string>;
  memoryVersion: number;
  memorySnapshot?: unknown;
}

export async function idbSaveCheckpoint(cp: PersistedCheckpoint): Promise<void> {
  try {
    await tx(STORE_CHECKPOINTS, "readwrite", (store) => store.put(cp));
  } catch {
    /* IndexedDB may be unavailable (private mode); callers fall back to memory */
  }
}

export async function idbLoadCheckpoints(workflowId?: string): Promise<PersistedCheckpoint[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_CHECKPOINTS, "readonly");
      const store = transaction.objectStore(STORE_CHECKPOINTS);
      const idx = workflowId ? store.index("workflowId") : null;
      const req = idx ? idx.getAll(workflowId) : store.getAll();
      req.onsuccess = () => resolve((req.result as PersistedCheckpoint[]).sort((a, b) => a.ts - b.ts));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function idbLoadLatestCheckpoint(workflowId?: string): Promise<PersistedCheckpoint | null> {
  const all = await idbLoadCheckpoints(workflowId);
  return all[all.length - 1] ?? null;
}

export async function idbClearCheckpoints(): Promise<void> {
  try {
    await tx(STORE_CHECKPOINTS, "readwrite", (store) => store.clear());
  } catch {
    /* noop */
  }
}

/* ---------------- Memory snapshots ---------------- */

export interface PersistedMemory {
  version: number;
  ts: number;
  records: unknown[];
}

export async function idbSaveMemory(snapshot: PersistedMemory): Promise<void> {
  try {
    await tx(STORE_MEMORY, "readwrite", (store) => store.put(snapshot));
  } catch {
    /* noop */
  }
}

export async function idbLoadLatestMemory(): Promise<PersistedMemory | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MEMORY, "readonly");
      const store = transaction.objectStore(STORE_MEMORY);
      const openReq = store.openCursor(null, "prev");
      openReq.onsuccess = () => {
        const cursor = openReq.result;
        resolve(cursor ? (cursor.value as PersistedMemory) : null);
      };
      openReq.onerror = () => reject(openReq.error);
    });
  } catch {
    return null;
  }
}

/* ---------------- Capability detection ---------------- */

export function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}
