/** Статусы задачи сборки видео */
export type TaskStatus = "pending" | "processing" | "success" | "failed";

/** Запись о задаче в БД */
export interface ITask {
  /** UUID задачи */
  id: string;
  /** Текущий статус */
  status: TaskStatus;
  /** Описание текущего шага (может быть null) */
  step: string | null;
  /** Сколько раз уже пытались выполнить сборку */
  retries: number;
  /** Когда задачa была создана */
  created_at: string; // ISO-строка
  /** Когда последний раз обновлялась запись */
  updated_at: string; // ISO-строка
}

/** Методы, которые предоставляет наш Database */
export interface IDatabase {
  // ─── Задачи ───
  createTask(id: string): void;
  updateTask(id: string, status: TaskStatus, step?: string | null): void;
  incrementRetries(id: string): number;
  getTask(id: string): ITask | undefined;

  // ─── Токены ───

  /**
   * Сохраняет HMAC-SHA256(rawToken) в таблице tokens
   */
  createToken(tokenHash: string): void;

  /**
   * Читает запись по хэшу
   */
  getToken(
    tokenHash: string
  ): { token_hash: string; created_at: string } | undefined;

  /**
   * Проверяет «сырой» токен:
   * делает HMAC и сверяет наличие в таблице
   */
  isValidToken(rawToken: string): boolean;
}
