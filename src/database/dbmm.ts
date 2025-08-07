import fs from 'fs';
import { Parser, CompactJSONFormat, TableInterface, ForeignKeyInterface, ColumnInterface } from 'sql-ddl-to-json-schema';
import { DatabaseMigrationChange, IDatabaseMigrationConfig } from './dbmm.interfaces.js';
import Database from 'better-sqlite3';
import path from 'path';
import { highlight } from 'cli-highlight';

export class DatabaseMigrationModule {
  private config: IDatabaseMigrationConfig;

  constructor(config: IDatabaseMigrationConfig) {
    this.config = config;
  }

  private sqliteSchemaToMySQLSchema(input: string) {
    // Удаляем ненужные строки (например, PRAGMA и транзакции)
    const removeRegex = /(PRAGMA foreign_keys = OFF;|BEGIN TRANSACTION;|COMMIT;)/g;

    // Убираем кавычки вокруг ключей
    const keyRegex = /"([\w_]+)"/g;

    // Заменяем AUTOINCREMENT на AUTO_INCREMENT
    const autoIncrementRegex = /\bAUTOINCREMENT\b/g;

    // Заменяем CHECK на ENUM, включая сложные и многострочные случаи
    const checkRegex = /(\w+)\s+TEXT(?:\s+NOT NULL)?\s+CHECK\s*\(\s*\1\s+IN\s*\(([\s\S]*?)\)\s*\)/gi;

    // Заменяем тип данных REAL на DOUBLE
    const realRegex = /\bREAL\b/g;

    // Обрабатываем CHECK (json_valid("column"))
    const jsonValidCheckRegex = /CHECK\s*\(\s*json_valid\s*\(\s*(\w+)\s*\)\s*\)/gi;

    // Преобразование текста
    const cleanedText = input
      .replace(removeRegex, '') // Удаляем ненужные строки
      .replace(keyRegex, '$1') // Убираем кавычки вокруг ключей
      .replace(autoIncrementRegex, 'AUTO_INCREMENT') // Заменяем AUTOINCREMENT
      .replace(realRegex, 'DOUBLE') // Заменяем тип данных REAL на DOUBLE
      .replace(
        checkRegex,
        (_, column, values) => `${column} ENUM(${values.replace(/\s+/g, ' ').trim()})${input.includes(`${column} TEXT NOT NULL`) ? ' NOT NULL' : ''}`
      ) // Заменяем CHECK на ENUM
      .replace(jsonValidCheckRegex, '') // Заменяем CHECK (json_valid("column"))
      .trim(); // Убираем лишние пробелы

    return cleanedText;
  }

  // Функция для чтения JSON файла
  private readSchemaFile(filePath: string) {
    return fs.readFileSync(filePath, 'utf8');
  }

  // Функция сравнения JSON структур
  private compareJSONSchemas(oldSchema: CompactJSONFormat[], newSchema: CompactJSONFormat[]) {
    const changes: DatabaseMigrationChange[] = [];
    const renamedTables = new Map();

    const oldTables = new Map(oldSchema.map(table => [table.name, table]));
    const newTables = new Map(newSchema.map(table => [table.name, table]));

    // Проверяем возможное переименование таблиц
    for (const [oldName, oldTable] of oldTables) {
      const matchingTable = Array.from(newTables.values()).find(
        newTable => JSON.stringify(oldTable.columns) === JSON.stringify(newTable.columns) && oldTable.name !== newTable.name
      );

      if (matchingTable && !newTables.get(oldName)) {
        renamedTables.set(oldName, matchingTable.name);
        newTables.delete(matchingTable.name);
      }
    }

    // Обработка переименованных таблиц
    for (const [oldName, newName] of renamedTables) {
      changes.push({ type: 'table_renamed', oldName, newName });
      oldTables.delete(oldName);
    }

    // Проверяем удаление и изменение таблиц
    for (const [name, oldTable] of oldTables) {
      if (!newTables.has(name)) {
        changes.push({ type: 'table_removed', table: name });
      } else {
        const newTable = newTables.get(name)!;
        changes.push(...this.compareTables(oldTable, newTable));
      }
    }

    // Проверяем добавление новых таблиц
    for (const [name, newTable] of newTables) {
      if (!oldTables.has(name)) {
        changes.push({ type: 'table_added', table: newTable });
      }
    }

    return changes;
  }

  // Функция сравнения таблиц
  private compareTables(oldTable: TableInterface, newTable: TableInterface) {
    const changes: DatabaseMigrationChange[] = [];

    const oldColumns = oldTable.columns?.map(col => col) ?? [];
    const newColumns = newTable.columns?.map(col => col) ?? [];
    const foreignKeys = newTable.foreignKeys ?? [];

    // Проверяем изменение колонок
    if (JSON.stringify(oldColumns) !== JSON.stringify(newColumns)) {
      changes.push({
        type: 'columns_changed',
        table: oldTable.name,
        oldColumns,
        newColumns,
        foreignKeys,
      });
    }

    return changes;
  }

  // Функция генерации SQL кода для миграций
  private generateSQLFromChanges(changes: DatabaseMigrationChange[]) {
    const migrations = [];

    for (const change of changes) {
      const migration = [];

      switch (change.type) {
        case 'table_removed':
          migration.push(`-- Table '${change.table}' removed.`);
          migration.push(`DROP TABLE IF EXISTS ${change.table};`);
          break;
        case 'table_added':
          migration.push(`-- Table '${change.table.name}' added.`);
          migration.push(this.generateCreateTableSQL(change.table));
          break;
        case 'table_renamed':
          migration.push(`-- Table '${change.oldName}' renamed to '${change.newName}'.`);
          migration.push(`ALTER TABLE ${change.oldName} RENAME TO ${change.newName};`);
          break;
        case 'columns_changed':
          migration.push(`-- Columns in table '${change.table}' changed. Requires table recreation:`);
          migration.push(
            this.generateRecreateTableSQL(change.table, change.oldColumns, change.newColumns, change.foreignKeys)
              .split('\n') // Split the string into an array of lines
              .map(line => '\t' + line) // Add a tab character to each line
              .join('\n')
          );
          break;
      }

      migrations.push(migration);
    }

    return 'PRAGMA foreign_keys = OFF;\n\n' + migrations.map(m => m.join('\n')).join('\n\n');
  }

  // Генерация SQL для создания таблицы
  private generateCreateTableSQL(table: TableInterface) {
    const foreignKeysSQL = (table.foreignKeys || []).map(fk => this.generateForeignKeySQL(fk)).join(',\n  ');

    const columnsSQL = table.columns?.map(col => this.generateColumnSQL(col)).join(',\n  ');

    const constraintsSQL = [columnsSQL, foreignKeysSQL].filter(Boolean).join(',\n  ');

    return `DROP TABLE IF EXISTS ${table.name};\nCREATE TABLE ${table.name} (\n  ${constraintsSQL}\n);`;
  }

  private wrapSQLDatatypeValueWithQuotesIfNeeded(type: string, value: string | number | boolean | null) {
    if(value === 'CURRENT_TIMESTAMP') return value;
    
    switch (type.toLowerCase()) {
      case 'int':
      case 'integer':
      case 'double':
      case 'float':
        return value; // Числовые значения без кавычек
      case 'boolean':
        return value; // Логические значения
      default:
        return `'${value}'`; // Для всех остальных типов добавляем кавычки
    }
  }

  // Функция для получения значения по умолчанию для типа данных
  private getDefaultForSQLDatatype(type: string) {
    switch (type.toLowerCase()) {
      case 'int':
      case 'integer':
        return '0';
      case 'text':
      case 'blob':
        return "''"; // Пустая строка
      case 'boolean':
        return 'FALSE';
      case 'timestamp':
      case 'datetime':
        return "'1970-01-01 00:00:00'"; // UNIX epoch
      case 'double':
      case 'float':
        return '0.0';
      default:
        return 'NULL'; // На случай неизвестного типа
    }
  }

  private generateForeignKeySQL(foreignKey: ForeignKeyInterface) {
    const onDeleteAction = foreignKey?.reference.on?.find(r => r.trigger === 'delete');
    const onUpdateAction = foreignKey?.reference.on?.find(r => r.trigger === 'update');

    return (
      `FOREIGN KEY (${foreignKey.columns?.[0]?.column}) REFERENCES ${foreignKey.reference.table}(${foreignKey.reference.columns?.[0]?.column})` +
      (onDeleteAction ? ` ON DELETE ${onDeleteAction.action.toUpperCase()}` : '') +
      (onUpdateAction ? ` ON UPDATE ${onUpdateAction.action.toUpperCase()}` : '')
    );
  }

  // Генерация SQL для пересоздания таблицы
  private generateRecreateTableSQL(
    tableName: string,
    oldStructure: ColumnInterface[],
    newStructure: ColumnInterface[],
    foreignKeys: ForeignKeyInterface[]
  ) {
    const newColumns = newStructure.filter(col => !col.options?.autoincrement).map(col => col.name);

    const columnMappings = newStructure
      .filter(col => !col.options?.autoincrement)
      .map(newCol => {
        const oldCol = oldStructure.find(col => col.name === newCol.name);

        if (oldCol) {
          // Колонка есть в старой таблице, просто копируем её
          return newCol.name;
        } else {
          // Новая колонка
          if (newCol.options?.default !== undefined) {
            // Если есть дефолтное значение, оставляем его
            return `${this.wrapSQLDatatypeValueWithQuotesIfNeeded(newCol.type.datatype, newCol.options.default)} AS ${newCol.name}`;
          } else if (newCol.options?.nullable === true) {
            // Если поле nullable, подставляем NULL
            return `NULL AS ${newCol.name}`;
          } else {
            // Для NOT NULL нужно подставить "пустое" значение в зависимости от типа
            return this.getDefaultForSQLDatatype(newCol.type.datatype) + ` AS ${newCol.name}`;
          }
        }
      });

    const foreignKeysSQL = (foreignKeys || []).map(fk => this.generateForeignKeySQL(fk)).join(',\n  ');

    return `
-- Step 1: Create a temporary table with the new structure
CREATE TABLE ${tableName}_temp (
  ${newStructure.map(col => this.generateColumnSQL(col)).join(',\n  ') + (foreignKeysSQL ? `,\n  ${foreignKeysSQL}` : '')}
);

-- Step 2: Copy data from the old table to the new table
INSERT INTO ${tableName}_temp (${newColumns.join(', ')})
SELECT ${columnMappings.join(', ')} FROM ${tableName};

-- Step 3: Drop the old table
DROP TABLE ${tableName};

-- Step 4: Rename the temporary table to the original name
ALTER TABLE ${tableName}_temp RENAME TO ${tableName};
`;
  }

  // Генерация SQL для колонки
  private generateColumnSQL(column: ColumnInterface) {
    let type = column?.type?.datatype?.toUpperCase();

    if (type === 'INT') {
      type = 'INTEGER';
    }

    if (type === 'ENUM') {
      if (column.type.values && column.type.values.length > 0)
        type = `TEXT CHECK (${column.name} IN (${column.type.values.map(s => `'${s}'`).join(', ')}))`;
      else type = 'TEXT';
    }

    let sql = `${column.name} ${type}`;
    if (column?.type?.length && column.type.length < 65535) sql += `(${column.type.length})`;
    if (column?.options?.nullable === false) sql += ' NOT NULL';
    if (column?.options?.default !== undefined)
      sql += ` DEFAULT ${this.wrapSQLDatatypeValueWithQuotesIfNeeded(column.type.datatype, column.options.default)}`;
    if (column?.options?.autoincrement === true) sql += ' PRIMARY KEY AUTOINCREMENT';

    return sql;
  }

  private sqliteSchemaToJSON(schema: string) {
    const sql = this.sqliteSchemaToMySQLSchema(schema);
    const parser = new Parser(); // Указываем SQLite как тип базы данных
    parser.feed(sql);

    return parser.toCompactJson();
  }

  private sqliteDBToSchema(path: string): string {
    const db = new Database(path, { readonly: true });

    // Extract schema excluding system tables (like sqlite_*)
    const rows: any[] = db
      .prepare("SELECT sql FROM sqlite_master WHERE sql NOT NULL AND type NOT IN ('meta', 'view') AND name NOT LIKE 'sqlite_%';")
      .all();

    // Combine all statements into a single schema
    const schema = rows.length > 0 ? rows.map(row => row.sql).join(';\n') + ';' : '';

    db.close();

    return schema;
  }

  private createBackup(config: IDatabaseMigrationConfig, migrationSQL: string) {
    // Создаем папку backups, если её нет
    const backupsDir = path.resolve(config.paths.backups);
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    // Создаем подпапку с текущей датой и временем
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); // Замена ":" и "." для совместимости с файловой системой
    const backupDirPath = path.join(backupsDir, timestamp);
    fs.mkdirSync(backupDirPath);

    // Путь для сохранения текущей базы данных
    const backupDbPath = path.join(backupDirPath, 'before.sqlite');

    // Путь для сохранения SQL файла миграции
    const migrationFilePath = path.join(backupDirPath, 'migration.sql');

    // Копируем базу данных
    try {
      fs.copyFileSync(config.paths.database, backupDbPath);
      fs.writeFileSync(migrationFilePath, migrationSQL, 'utf8');
      console.log(`💾 Backup created at: ${backupDirPath}`);
    } catch (err) {
      console.error(`🛑 Failed to create backup:`, err);
    }
  }

  private applyMigrationWithBackup(config: IDatabaseMigrationConfig, migrationSQL: string) {
    // Создаем бэкап
    this.createBackup(config, migrationSQL);

    console.log('📤 Applying migration script...');
    // Применяем миграцию
    try {
      const db = new Database(config.paths.database);
      db.exec(migrationSQL);
      db.close();
      console.log('✅ Migration script applied successfully.');
    } catch (err) {
      console.error(`🛑 Migration failed:`, err);
    }
  }

  public start() {
    try {
      console.log('🌊 Starting Database Migration Module...');

      // Запуск
      const oldSchema = this.sqliteDBToSchema(this.config.paths.database);

      const newSchema = this.readSchemaFile(this.config.paths.schema);

      const oldJSON = this.sqliteSchemaToJSON(oldSchema);
      const newJSON = this.sqliteSchemaToJSON(newSchema);

      const changes = this.compareJSONSchemas(oldJSON, newJSON);

      if (changes.length > 0) {
        const sql = this.generateSQLFromChanges(changes);

        console.log(
          '🔎 Changes detected:\n\n' +
            highlight(
              JSON.stringify(changes, null, 2)
                .split('\n')
                .map(s => '\t' + s)
                .join('\n'),
              {
                language: 'json',
              }
            )
        );
        console.log(
          '\n🟣 SQL Migration Script:\n\n' +
            highlight(sql, {
              language: 'sql',
            })
              .split('\n')
              .map(s => '\t' + s)
              .join('\n') +
            '\n'
        );

        this.applyMigrationWithBackup(this.config, sql);
      } else {
        console.log('⚪️ No changes detected');
      }

      console.log('🟡 Exiting Database Migration Module...');
    } catch (error) {
      console.error(`🛑 Error durring migrations:`, error);
      process.exit();
    }
  }
}
