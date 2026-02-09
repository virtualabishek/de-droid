import { app } from "electron";
import path from "path";
import Database from "better-sqlite3";
import fs from "fs";

let db: Database.Database;

function getDatabasePath(): string {
  const userDataPath = app.getPath("userData");
  return path.join(userDataPath, "de-droid.db");
}

export function initDatabase(): Database.Database {
  if (db) return db;
  const dbPath = getDatabasePath();
  console.log("[DB] initializing the datbase at: ", dbPath);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  db = new Database(dbPath);
  db.pragma(("journal_node" = WAL));
}
