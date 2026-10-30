import { createHash } from "node:crypto";

// Use inside a transaction with search_path fixed to pg_catalog, public.
// Prisma's bookkeeping table is excluded; business schema objects remain covered.
export const migrationCatalogQueries = {
  tables: `SELECT c.relname AS name,c.relkind::text AS kind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='foodprint' AND c.relname<>'_prisma_migrations'
      AND c.relkind IN ('r','p','v','m','S','f') ORDER BY c.relname`,
  columns: `SELECT c.relname AS table_name,a.attname AS name,a.attnum::int AS position,
      format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,
      pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='foodprint' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations'
    ORDER BY c.relname,a.attnum`,
  constraints: `SELECT r.relname AS table_name,c.conname AS name,c.contype::text AS type,
      c.convalidated AS validated,pg_get_constraintdef(c.oid,true) AS definition
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname='foodprint' AND r.relname<>'_prisma_migrations'
    ORDER BY r.relname,c.conname`,
  indexes: `SELECT t.relname AS table_name,i.relname AS name,ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary,ix.indisvalid AS valid,
      pg_get_indexdef(ix.indexrelid) AS definition,pg_get_expr(ix.indpred,ix.indrelid) AS predicate
    FROM pg_index ix JOIN pg_class t ON t.oid=ix.indrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class i ON i.oid=ix.indexrelid
    WHERE n.nspname='foodprint' AND t.relname<>'_prisma_migrations' ORDER BY t.relname,i.relname`,
  enums: `SELECT t.typname AS name,e.enumlabel AS label,e.enumsortorder::float AS position
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
    WHERE n.nspname='foodprint' ORDER BY t.typname,e.enumsortorder`,
  extensions: `SELECT e.extname AS name,n.nspname AS schema_name
    FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
    WHERE e.extname IN ('pgcrypto','citext') ORDER BY e.extname`,
  triggers: `SELECT c.relname AS table_name,t.tgname AS name,pg_get_triggerdef(t.oid,true) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='foodprint' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
  functions: `SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='foodprint' ORDER BY p.proname,arguments`,
  policies: `SELECT tablename AS table_name,policyname AS name,permissive,roles::text[] AS roles,cmd,qual,with_check
    FROM pg_policies WHERE schemaname='foodprint' ORDER BY tablename,policyname`,
} as const;

export type CatalogSection = keyof typeof migrationCatalogQueries;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function catalogFingerprint(rows: readonly unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(rows)))
    .digest("hex");
}
