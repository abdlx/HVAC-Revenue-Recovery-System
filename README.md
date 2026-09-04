# HVAC Revenue Recovery

Production-oriented monorepo for recovering missed and after-hours HVAC demand.
The first vertical slice is the authenticated Vapi-to-Fastify service-area tool.

## Workspace

- `apps/web` — Next.js contractor dashboard.
- `apps/voice-api` — persistent Fastify API for latency-sensitive voice tools.
- `apps/worker` — asynchronous job runtime (processors follow after the voice slice).
- `packages/contracts` — provider request/response validation.
- `packages/domain` — provider-independent business rules.
- `packages/db` — Drizzle schema and Lakebase Postgres repositories.

## Local setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env` and provide branch-specific credentials.
3. Generate a migration with `pnpm db:generate`.
4. Apply it with the direct connection: `pnpm db:migrate`.
5. Verify it with `pnpm --filter @hvac/db db:verify`.
6. Run the voice API with `pnpm dev:voice-api`.

Use `DATABASE_URL` (pooled) for application requests and
`DATABASE_URL_UNPOOLED` (direct) for migrations.

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Implemented voice contract

`POST /v1/vapi/tools/check-service-area`

- Requires `Authorization: Bearer <VAPI_SERVER_TOKEN>`.
- Accepts Vapi's `tool-calls` server message envelope.
- Resolves the organization from the trusted Vapi call ID.
- Executes a tenant-scoped ZIP lookup.
- Fails closed and never accepts an organization ID from model arguments.

Health probes are available at `GET /health/live` and `GET /health/ready`.
