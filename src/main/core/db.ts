import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { dataDir } from '../paths'

// One local SQLite file for memory, chat history and tasks.
// node:sqlite ships with Electron's Node, so there's no native module to build.

let db: DatabaseSync | undefined

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'note',
  text TEXT NOT NULL,
  private INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(text, content='memories', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
`

export function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(join(dataDir, 'orbit.db'))
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    db.exec(SCHEMA)
    // Added in 0.9: what a running task is doing right now.
    try {
      db.exec('ALTER TABLE tasks ADD COLUMN progress TEXT')
    } catch {
      // already there
    }
  }
  return db
}

export const now = (): string => new Date().toISOString()

/**
 * Turns free text into a safe FTS5 query: significant words, OR-ed, each quoted.
 * Returns undefined when nothing searchable is left.
 */
export function ftsQuery(text: string): string | undefined {
  const words = text
    .toLowerCase()
    .match(/[\p{L}\p{N}@._-]{3,}/gu)
    ?.filter((w) => !STOP.has(w))
  if (!words?.length) return undefined
  return [...new Set(words)]
    .slice(0, 24)
    .map((w) => `"${w.replace(/"/g, '')}"`)
    .join(' OR ')
}

const STOP = new Set(
  'the and for are but not you all any can had her was one our out has him his how its may new now see who did get let put say she too use what when where which while with this that from they them then than there these those have will would could should about into your just like some more most very also been were being what\'s whats tell show give make want need please'.split(
    ' '
  )
)
