import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function runMigrations(db: Database.Database, migrationsDir: string): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _schema_version (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const applied = new Set(
    (db.prepare("SELECT version FROM _schema_version").all() as { version: string }[]).map(
      (r) => r.version,
    ),
  );
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const insert = db.prepare("INSERT INTO _schema_version (version, applied_at) VALUES (?, ?)");
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      insert.run(file, Date.now());
    })();
  }
}
