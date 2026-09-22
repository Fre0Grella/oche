/**
 * Local storage: matches as append-only event logs, captured frames, and a few
 * settings.
 *
 * Everything stays on the device. A `SyncAdapter` boundary is deliberately not
 * introduced yet — there is nothing to sync with — but this module is the only
 * place that touches persistence, so adding one later is a single file.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import { DEFAULT_SETTINGS, type CapturedFrame, type Settings, type StoredMatch } from './types.js';

export { DEFAULT_SETTINGS };
export type { CapturedFrame, Settings, StoredMatch } from './types.js';

interface OcheDB extends DBSchema {
  matches: {
    key: string;
    value: StoredMatch;
    indexes: { 'by-updated': number };
  };
  frames: {
    key: string;
    value: CapturedFrame;
    indexes: { 'by-ts': number };
  };
  settings: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = 'oche';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<OcheDB>> | null = null;

/** In-memory stand-in, so tests and private-mode browsers still work. */
const memory = {
  matches: new Map<string, StoredMatch>(),
  settings: new Map<string, unknown>(),
};

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function db(): Promise<IDBPDatabase<OcheDB> | null> {
  if (!hasIndexedDB()) return null;
  if (!dbPromise) {
    dbPromise = openDB<OcheDB>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          const matches = database.createObjectStore('matches', { keyPath: 'id' });
          matches.createIndex('by-updated', 'updatedAt');
          database.createObjectStore('settings');
        }
        if (oldVersion < 2) {
          const frames = database.createObjectStore('frames', { keyPath: 'id' });
          frames.createIndex('by-ts', 'ts');
        }
      },
    });
  }
  try {
    return await dbPromise;
  } catch {
    // Blocked or unavailable (private window, cleared site data): fall back.
    return null;
  }
}

/**
 * The database, for the frame store. Frames are megabytes of JPEG, so there is
 * no in-memory fallback for them: without IndexedDB the capture lab says so
 * rather than filling a tab's heap and losing the lot on reload.
 */
export async function framesDb(): Promise<IDBPDatabase<OcheDB> | null> {
  return db();
}

export async function putMatch(match: StoredMatch): Promise<void> {
  const database = await db();
  if (!database) {
    memory.matches.set(match.id, match);
    return;
  }
  await database.put('matches', match);
}

export async function getMatch(id: string): Promise<StoredMatch | undefined> {
  const database = await db();
  if (!database) return memory.matches.get(id);
  return database.get('matches', id);
}

export async function deleteMatch(id: string): Promise<void> {
  const database = await db();
  if (!database) {
    memory.matches.delete(id);
    return;
  }
  await database.delete('matches', id);
}

/** Most recently updated first. */
export async function listMatches(limit = 50): Promise<StoredMatch[]> {
  const database = await db();
  if (!database) {
    return [...memory.matches.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }
  const all = await database.getAllFromIndex('matches', 'by-updated');
  return all.reverse().slice(0, limit);
}

export async function loadSettings(): Promise<Settings> {
  const database = await db();
  const read = async (key: keyof Settings): Promise<unknown> =>
    database ? database.get('settings', key) : memory.settings.get(key);

  const entries = await Promise.all(
    (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).map(async (key) => [key, await read(key)] as const),
  );

  const settings = { ...DEFAULT_SETTINGS };
  for (const [key, value] of entries) {
    if (value !== undefined) (settings as Record<string, unknown>)[key] = value;
  }
  return settings;
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  const database = await db();
  if (!database) {
    memory.settings.set(key, value);
    return;
  }
  await database.put('settings', value, key);
}

/** How much room the browser is giving us, for the capture lab's warning. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}
