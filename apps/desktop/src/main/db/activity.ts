import type Database from "better-sqlite3"

export interface ActivityEvent {
  id: number
  ts: string
  kind: string
  message: string
}

// Append-only activity log for things that have no intrinsic timestamp
// (e.g. MCP config writes and agent adaptations performed by Skillbox).
// Skill add/update events are derived from skill timestamps instead, so only
// record MCP and adapt events here.
export class ActivityStore {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  add(kind: "mcp" | "skill", message: string): void {
    this.db
      .prepare("INSERT INTO activity (ts, kind, message) VALUES (?, ?, ?)")
      .run(new Date().toISOString(), kind, message)
  }

  list(limit = 20): ActivityEvent[] {
    return this.db
      .prepare("SELECT id, ts, kind, message FROM activity ORDER BY id DESC LIMIT ?")
      .all(limit) as ActivityEvent[]
  }
}
