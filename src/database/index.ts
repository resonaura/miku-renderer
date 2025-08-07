import path from "path";
import SQLite from "better-sqlite3";
import { DatabaseMigrationModule } from "./dbmm.js";
import { env, storageDir } from "../config/index.js";
import { IDatabase, ITask, TaskStatus } from "./interfaces.js";
import crypto from "crypto";

export class Database implements IDatabase {
  private db: SQLite.Database;

  constructor() {
    const dbPath = path.resolve(storageDir, "db.sqlite");
    this.db = new SQLite(dbPath);
    new DatabaseMigrationModule({
      paths: {
        database: dbPath,
        schema: path.resolve(import.meta.dirname, "./schema.sql"),
        backups: path.resolve(storageDir, "backups"),
      },
    }).start();
  }

  createTask(id: string): void {
    this.db
      .prepare(`INSERT INTO tasks (id, status) VALUES (?, 'pending')`)
      .run(id);
  }

  updateTask(id: string, status: TaskStatus, step?: string | null): void {
    this.db
      .prepare(
        `UPDATE tasks
         SET status = ?, step = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(status, step ?? null, id);
  }

  incrementRetries(id: string): number {
    this.db
      .prepare(`UPDATE tasks SET retries = retries + 1 WHERE id = ?`)
      .run(id);
    const row: any = this.db
      .prepare(`SELECT retries FROM tasks WHERE id = ?`)
      .get(id);
    return row?.retries as number;
  }

  getTask(id: string): ITask | undefined {
    return this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
      | ITask
      | undefined;
  }

  public createToken(tokenHash: string): void {
    this.db
      .prepare(`INSERT INTO tokens (token_hash) VALUES (?)`)
      .run(tokenHash);
  }

  getToken(
    tokenHash: string
  ): { token_hash: string; created_at: string } | undefined {
    return this.db
      .prepare(`SELECT token_hash, created_at FROM tokens WHERE token_hash = ?`)
      .get(tokenHash) as any;
  }

  isValidToken(rawToken: string): boolean {
    const hash = crypto
      .createHmac("sha256", env.TOKEN_SECRET)
      .update(rawToken)
      .digest("hex");
    return !!this.getToken(hash);
  }
}
