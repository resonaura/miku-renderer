PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE
  IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, -- uuid
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'processing', 'success', 'failed')
    ),
    step TEXT, -- текущее под-состояние
    retries INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE
  IF NOT EXISTS tokens (
    token_hash TEXT PRIMARY KEY, -- хранит хэш или зашифрованный токен
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- ваш dump таблиц users/messages и остального…
COMMIT;