import { randomUUID } from 'node:crypto'
import { getDb, now } from './db'

export type ConversationRow = { id: string; title: string; model: string; created_at: string; updated_at: string }
export type MessageRow = { id: number; role: 'user' | 'assistant'; text: string; created_at: string }

export function createConversation(firstMessage: string, model: string): string {
  const id = randomUUID()
  const title = firstMessage.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled'
  const t = now()
  getDb().prepare('INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, title, model, t, t)
  return id
}

export function addMessage(conversationId: string, role: 'user' | 'assistant', text: string): void {
  const t = now()
  getDb().prepare('INSERT INTO messages (conversation_id, role, text, created_at) VALUES (?, ?, ?, ?)').run(conversationId, role, text, t)
  getDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(t, conversationId)
}

export function listConversations(limit = 200): ConversationRow[] {
  return getDb().prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?').all(limit) as ConversationRow[]
}

export function getMessages(conversationId: string): MessageRow[] {
  return getDb().prepare('SELECT id, role, text, created_at FROM messages WHERE conversation_id = ? ORDER BY id').all(conversationId) as MessageRow[]
}

/** Deletes the last user message and everything after it (retry / edit the last message). */
export function deleteLastExchange(conversationId: string): void {
  getDb()
    .prepare("DELETE FROM messages WHERE conversation_id = ? AND id >= (SELECT MAX(id) FROM messages WHERE conversation_id = ? AND role = 'user')")
    .run(conversationId, conversationId)
}

export function getConversation(id: string): ConversationRow | undefined {
  return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined
}

export function deleteConversation(id: string): void {
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id)
}
