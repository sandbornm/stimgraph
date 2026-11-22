export function uniqueOwnerId(rows: Array<{ id: string }> | undefined): string | undefined {
  return rows?.length === 1 ? rows[0].id : undefined;
}
