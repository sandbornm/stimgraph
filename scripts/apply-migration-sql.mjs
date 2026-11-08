const addColumn = /^\s*ALTER\s+TABLE\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?\s+ADD\s+(?:COLUMN\s+)?[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?/i;

export function applyMigrationSql(db, sql) {
  const statements = sql.split(/-->\s*statement-breakpoint/g).map((part) => part.trim()).filter(Boolean);
  for (const statement of statements) {
    const match = statement.match(addColumn);
    if (match) {
      const [, table, column] = match;
      const existing = db.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
      if (existing) continue;
    }
    db.exec(statement);
  }
}
