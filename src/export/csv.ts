import { stringify } from "csv-stringify/sync";
import type { ResultSet } from "../drivers/types";

export function toCsv(rs: ResultSet): string {
  return stringify(rs.rows, {
    header: true,
    columns: rs.columns.map((c) => c.name),
  });
}
