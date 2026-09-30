import type Database from "better-sqlite3"
import { planPathIdentityRemap } from "../skill-storage-records"

const MAX_CACHE_ENTRIES = 500

export interface TranslationPreference {
  identity: string
  cacheKey: string
  sourceHash: string
  sourceDescription: string | null
  translatedDescription: string | null
  showTranslation: boolean
}

export class TranslationCacheStore {
  constructor(private db: Database.Database) {}

  get(cacheKey: string): string | null {
    const row = this.db
      .prepare("SELECT content FROM translation_cache WHERE cache_key = ?")
      .get(cacheKey) as { content: string } | undefined

    if (!row) return null
    this.db
      .prepare("UPDATE translation_cache SET accessed_at = datetime('now') WHERE cache_key = ?")
      .run(cacheKey)
    return row.content
  }

  set(cacheKey: string, content: string): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO translation_cache (cache_key, content, created_at, accessed_at)
           VALUES (?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(cache_key) DO UPDATE SET
             content = excluded.content,
             accessed_at = datetime('now')`,
        )
        .run(cacheKey, content)

      this.db
        .prepare(
          `DELETE FROM translation_cache
           WHERE cache_key IN (
             SELECT cache_key FROM translation_cache
             ORDER BY accessed_at DESC
             LIMIT -1 OFFSET ?
           )`,
        )
        .run(MAX_CACHE_ENTRIES)
    })()
  }

  getPreference(identity: string): TranslationPreference | null {
    const row = this.db
      .prepare(
        `SELECT identity, cache_key, source_hash, source_description,
                translated_description, show_translation
         FROM translation_preferences
         WHERE identity = ?`,
      )
      .get(identity) as {
        identity: string
        cache_key: string
        source_hash: string
        source_description: string | null
        translated_description: string | null
        show_translation: number
      } | undefined

    return row ? this.mapPreference(row) : null
  }

  listPreferences(): TranslationPreference[] {
    const rows = this.db
      .prepare(
        `SELECT p.identity, p.cache_key, p.source_hash, p.source_description,
                p.translated_description, p.show_translation
         FROM translation_preferences p
         INNER JOIN translation_cache c ON c.cache_key = p.cache_key
         ORDER BY p.updated_at DESC`,
      )
      .all() as Array<{
        identity: string
        cache_key: string
        source_hash: string
        source_description: string | null
        translated_description: string | null
        show_translation: number
      }>

    return rows.map((row) => this.mapPreference(row))
  }

  remapPreferenceIdentities(previous: string, next: string): void {
    const identities = this.db
      .prepare("SELECT identity FROM translation_preferences")
      .all() as Array<{ identity: string }>
    const plan = planPathIdentityRemap(
      identities.map(({ identity }) => identity),
      previous,
      next,
    )
    const remove = this.db.prepare("DELETE FROM translation_preferences WHERE identity = ?")
    const update = this.db.prepare(
      "UPDATE translation_preferences SET identity = ?, updated_at = datetime('now') WHERE identity = ?",
    )
    this.db.transaction(() => {
      for (const identity of plan.removals) remove.run(identity)
      for (const { identity, nextIdentity } of plan.updates) update.run(nextIdentity, identity)
    })()
  }

  setPreference(preference: TranslationPreference): void {
    this.db
      .prepare(
        `INSERT INTO translation_preferences (
           identity, cache_key, source_hash, source_description,
           translated_description, show_translation, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(identity) DO UPDATE SET
           cache_key = excluded.cache_key,
           source_hash = excluded.source_hash,
           source_description = excluded.source_description,
           translated_description = excluded.translated_description,
           show_translation = excluded.show_translation,
           updated_at = excluded.updated_at`,
      )
      .run(
        preference.identity,
        preference.cacheKey,
        preference.sourceHash,
        preference.sourceDescription,
        preference.translatedDescription,
        preference.showTranslation ? 1 : 0,
      )
  }

  private mapPreference(row: {
    identity: string
    cache_key: string
    source_hash: string
    source_description: string | null
    translated_description: string | null
    show_translation: number
  }): TranslationPreference {
    return {
      identity: row.identity,
      cacheKey: row.cache_key,
      sourceHash: row.source_hash,
      sourceDescription: row.source_description,
      translatedDescription: row.translated_description,
      showTranslation: Boolean(row.show_translation),
    }
  }
}
