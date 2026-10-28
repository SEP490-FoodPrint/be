# Repository Guidelines

## Project Structure & Module Organization

FoodPrint uses strict TypeScript, Express, PostgreSQL, and Prisma. The application runs as CommonJS: `package.json` declares `type: commonjs`, TypeScript uses Node16 module resolution, and Prisma generates a `cjs` client. This is the single coding guide; explain work in Vietnamese and implement only confirmed requirements.

- `src/app.ts` exports the Express app factory, with an injected rate limiter for testing; `src/server.ts` connects to PostgreSQL and Redis before starting HTTP.
- `src/config/env.ts` loads configuration and checks the local database URL. `src/config/prisma.ts` exports the shared Prisma client and connection helper.
- `src/modules/<feature>/` contains routes, controllers, services, and validation for read-only business API samples. See `src/modules/README.md` for module ownership and endpoint mappings; register routers in `src/routes/index.ts`. These initial list endpoints require `SYSTEM_ADMIN` in `SYSTEM`; tenant-specific access needs an approved policy.
- `src/middlewares/`, `src/constants/`, `src/utils/`, and `src/types/` contain shared middleware, role constants, helpers, and request types.
- `prisma/schema.prisma` models the approved new database design from the SQL source identified in `database/SCHEMA_BASELINE.md`, using the `foodprint` schema. The previously connected local database is not the source of truth for these models. Use PascalCase model/enum names and camelCase fields with `@map`/`@@map` to preserve SQL identifiers; keep `@@schema("foodprint")`. The baseline records SQL version, verified mappings, database-only rules, and deployment status. `prisma.config.ts` supplies the CLI URL. Generated client code goes in `src/generated/prisma/`; compiled JavaScript goes in `dist/`. Never hand-edit or commit generated output.

## Build, Test, and Development Commands

Run from the repository root after configuring your own `.env`:

- `npm ci`: install locked dependencies.
- `npm run prisma:validate`: validate the Prisma schema.
- `npm run prisma:generate`: generate the TypeScript/CommonJS client without changing the database.
- `npm run typecheck`: check source and Prisma configuration types.
- `npm run dev`: watch and run `src/server.ts` with tsx.
- `npm run build`: generate Prisma Client and compile the application; `npm start` runs `dist/server.js`.
- `npm run db:check`: check database connection (Azure PostgreSQL or local) using Prisma and `SELECT 1`.
- `npm run db:migrate`: create and apply schema migrations to PostgreSQL using `prisma migrate dev`.
- `npm run db:push`: push schema changes directly to PostgreSQL without migration files.
- `npm run db:pull`: introspect and update `prisma/schema.prisma` from PostgreSQL.
- `npm run db:studio`: open Prisma Studio web interface to inspect and manage data.
- `docker compose up -d --no-recreate --wait redis`: start the local Redis service without recreating existing containers. Never use `--remove-orphans` or delete volumes to resolve setup issues.
- `npm run redis:check`: check the local Redis connection with `PING`.
- `npm run test:rate-limit`: run database-free HTTP tests with the Node test runner; `npm run test:rate-limit:redis` checks the local Docker Redis store using isolated test prefixes.
- `npm run test:cache`: test the shared cache helper without infrastructure; `npm run test:cache:redis` verifies it against local Redis with isolated test keys.
- `npm run test:modules`: test business list authorization, pagination, safe projections, serialization, and error handling without PostgreSQL or Redis.
- `npm run test:unit`: run all configured infrastructure-free tests, including role middleware; add new unit test files to this script as they are introduced.
- `npm run lint` / `npm run lint:fix`: check code quality or explicitly apply ESLint fixes.
- `npm run format:check` / `npm run format`: check formatting or explicitly format supported handwritten files.
- `npm run validate`: run lint, format checking, typecheck, and build in order; it stops at the first failure.

ESLint flat config, Prettier, and Node's built-in rate-limit/cache tests are configured; no external test framework or coverage threshold is configured. Record actual checks and blocked prerequisites. Backend changes require typecheck/build; PostgreSQL connection changes also require `db:check`, and Redis connection changes require `redis:check`, when local infrastructure is available. HTTP `/api/health` checks the API process, not the ongoing database connection.

## Coding Style & Architecture

Use two spaces, double quotes, semicolons, camelCase functions/variables, PascalCase types, and uppercase role constants. Prettier owns formatting; ESLint checks code quality with conflicting formatting rules disabled. Existing source still has formatting violations; do not reformat the whole repository as an unrelated change. Relative TypeScript imports are extensionless in the current CommonJS runtime; preserve `.js` extensions wherever relative ESM imports are used. Use filenames such as `menu.routes.ts`, `menu.controller.ts`, `menu.service.ts`, and `menu.validation.ts`.

Controllers call services and forward errors with `next(error)`; services use the shared Prisma client. Do not create Sequelize models, duplicate database clients, or infer business fields from examples. Keep approved database identifiers unchanged. Related writes requiring atomicity use `prisma.$transaction`.

Prisma uses `partialIndexes` to represent conditional indexes from the approved SQL; preserve their predicates and use real primary keys for unique operations. `IngredientLot.inventoryTransactions` is a list: receipt-only uniqueness does not make the relationship one-to-one. CHECK constraints and seed rows belong to the SQL source. The approved SQL contains no functions or triggers: backend services own business validation, lifecycle transitions, and inventory posting. Mapped `updated_at` fields use Prisma `@updatedAt`; writes outside Prisma must set timestamps explicitly. Client generation does not deploy database rules or implement services. Do not overwrite the new models by introspecting a legacy database; verify the intended database version against the baseline before any explicitly authorized re-introspection.

## Rate Limiting & Redis

The shared middleware factory requires an explicit store. Runtime API counters use Redis with a separate `foodprint:rate-limit:<namespace>:` prefix per policy; MemoryStore is only used in isolated unit tests. Never flush Redis or delete keys belonging to another namespace.

The `/api` limiter is always enabled, defaults to 300 requests per minute per IP, skips OPTIONS and health GET/HEAD, and returns 429 through the shared response helper. Redis failures must fail closed with 503, without a memory fallback. Preserve default IP/IPv6 handling and `trust proxy: false` for the current direct local setup.

Services may use `cache.getOrSet` and `cache.invalidate` from `src/utils/cache.ts` for explicitly selected reads. Build keys with `buildCacheKey`, including trusted organization/user access scope and every normalized query parameter. Use JSON DTOs, a runtime `isValid` guard, and a positive `ttlSeconds`; convert Date/Decimal/BigInt explicitly before caching. Cache reads/writes may bypass Redis on failure; loader errors propagate and rate-limit behavior stays unchanged.

Invalidate affected exact keys after database commit; invalidation failures throw `CacheInvalidationError` and need handling without assuming the database write failed. Never flush Redis or use wildcard deletion. Concurrent loads are deduplicated only within one shared helper instance; this is not a distributed lock or a cross-process consistency guarantee.

## Local Database Policy

The backend supports connecting to Azure Database for PostgreSQL (`foodprint_db`) with SSL or local PostgreSQL via `DATABASE_URL` in an untracked `.env`. The sample contains placeholders; never commit credentials, JWT secrets, or dumps. Do not deploy or connect to remote/shared databases or create SSH database tunnels.

Do not create business models or run introspection, DDL, migrations, `prisma db push`, reset, imports, or volume deletion without explicit task authorization. Connection setup and client generation do not authorize schema/data changes. Preserve existing local data and credentials.

## Authentication & HTTP Responses

Preserve one account per role and use `ROLES`/`ORG_TYPES` from `src/constants/roles.ts`. Authenticate internal business endpoints before organization/role checks, with explicit nonempty allowlists for restricted endpoints. Keep existing role values and labels.

Controllers use `sendSuccess(res, data, message, statusCode)` and `sendError(res, message, statusCode, errors)` from `src/utils/response.ts`. Preserve success/error envelopes and never expose credentials or secrets.

## Commit & Pull Request Guidelines

Use Conventional Commits such as `feat(auth): implement login validation`, consistent with the initial `feat:` commit. Keep `main` stable; branch work from `dev` and open PRs into `dev`, then promote reviewed changes from `dev` to `main` through a PR. Name work branches `<type>/<kebab-case-description>` using the commit types; follow [contribute.md](contribute.md) for examples and optional issue numbers. Branch naming is reviewed manually. Keep PRs focused, describe behavior/configuration changes, link relevant issues, and list real verification results. `npm ci` installs Husky hooks through `prepare`: pre-commit runs lint-staged checks without automatic rewrites, and commit-msg runs Commitlint. Generated Prisma output, build artifacts, environment files, SQL, and lockfiles are excluded from formatting/linting. `.github/workflows/ci.yml` checks commits, Prisma validation/generation, lint, formatting, types, build, and infrastructure-free tests on pushes/PRs for `main` and `dev`. CI uses a local placeholder URL, without database connections or deployment. GitHub branch protection must separately require the `Backend quality` check; a workflow file alone does not enforce merge restrictions.
