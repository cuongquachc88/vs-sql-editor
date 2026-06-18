// Map common PostgreSQL OIDs to human-readable type names. When we use
// `rowMode: "array"` the pg library only hands us the OID number in
// `field.dataTypeID`, so we resolve it ourselves for display in the grid.
//
// Source: https://github.com/postgres/postgres/blob/master/src/include/catalog/pg_type.dat
const OID_NAMES: Record<number, string> = {
  16: "bool",
  17: "bytea",
  18: "char",
  19: "name",
  20: "int8",
  21: "int2",
  22: "int2vector",
  23: "int4",
  24: "regproc",
  25: "text",
  26: "oid",
  114: "json",
  142: "xml",
  600: "point",
  601: "lseg",
  602: "path",
  603: "box",
  604: "polygon",
  628: "line",
  650: "cidr",
  700: "float4",
  701: "float8",
  718: "circle",
  774: "macaddr8",
  790: "money",
  829: "macaddr",
  869: "inet",
  1000: "_bool",
  1005: "_int2",
  1007: "_int4",
  1009: "_text",
  1014: "_bpchar",
  1015: "_varchar",
  1016: "_int8",
  1021: "_float4",
  1022: "_float8",
  1042: "bpchar",
  1043: "varchar",
  1082: "date",
  1083: "time",
  1114: "timestamp",
  1184: "timestamptz",
  1186: "interval",
  1266: "timetz",
  1700: "numeric",
  2950: "uuid",
  3802: "jsonb",
};

export function pgTypeName(oid: number): string {
  return OID_NAMES[oid] ?? `oid:${oid}`;
}
