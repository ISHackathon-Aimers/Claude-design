const storageError = () => new Error('로그인 정보를 저장할 수 없어요. 브라우저의 사이트 데이터 저장을 허용한 뒤 다시 시도해 주세요.');

// Keep Supabase's existing localStorage keys, falling back to durable IndexedDB rather than memory.
export async function createPersistentStorage(host = globalThis) {
  try {
    const storage = host.localStorage;
    const probe = `aimers-auth-probe:${Math.random()}`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch { /* Some browser contexts block localStorage while IndexedDB remains available. */ }

  let factory;
  try { factory = host.indexedDB; } catch { throw storageError(); }
  if (!factory) throw storageError();
  const open = () => new Promise((resolve, reject) => {
    const request = factory.open('aimers-auth-v1', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('session'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError());
    request.onblocked = () => reject(storageError());
  });
  const run = async (mode, operation) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('session', mode);
        const request = operation(transaction.objectStore('session'));
        transaction.oncomplete = () => resolve(request.result ?? null);
        transaction.onerror = transaction.onabort = () => reject(storageError());
      });
    } finally { db.close(); }
  };
  const storage = {
    getItem: (key) => run('readonly', (store) => store.get(key)),
    setItem: (key, value) => run('readwrite', (store) => store.put(value, key)),
    removeItem: (key) => run('readwrite', (store) => store.delete(key)),
  };
  // Check write access before OAuth. Never silently degrade to a session lost on reload.
  await storage.setItem('__probe__', '1');
  await storage.removeItem('__probe__');
  return storage;
}
