import { ColumnInterface, ForeignKeyInterface, TableInterface } from 'sql-ddl-to-json-schema';

export interface IDatabaseMigrationColumnsChange {
  type: 'columns_changed';
  table: string;
  oldColumns: ColumnInterface[];
  newColumns: ColumnInterface[];
  foreignKeys: ForeignKeyInterface[];
}

export interface IDatabaseMigrationTableRenameChange {
  type: 'table_renamed';
  oldName: string;
  newName: string;
}

export interface IDatabaseMigrationTableRemoveChange {
  type: 'table_removed';
  table: string;
}

export interface IDatabaseMigrationTableAddChange {
  type: 'table_added';
  table: TableInterface;
}

export type DatabaseMigrationChange =
  | IDatabaseMigrationColumnsChange
  | IDatabaseMigrationTableRenameChange
  | IDatabaseMigrationTableRemoveChange
  | IDatabaseMigrationTableAddChange;

export interface IDatabaseMigrationConfig {
  paths: {
    database: string;
    schema: string;
    backups: string;
  };
}
