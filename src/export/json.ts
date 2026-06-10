import type { ResultSet } from "../drivers/types";

export function toJson(rs: ResultSet): string {
  const objects = rs.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    rs.columns.forEach((col, i) => {
      obj[col.name] = row[i];
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}
