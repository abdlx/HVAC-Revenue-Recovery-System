# HVAC Revenue Recovery

Production-oriented monorepo for recovering missed and after-hours HVAC demand.
The current vertical slice authenticates Vapi, enforces tenant-scoped service
areas and escalation destinations, and idempotently persists call events.

## Workspace

- `apps/web` — Next.js contractor dashboard.
- `apps/voice-api` — persistent Fastify API for latency-sensitive voice tools.
- `apps/worker` — asynchronous job runtime (processors follow after the voice slice).
- `packages/contracts` — provider request/response validation.
- `packages/crm` — Jobber OAuth, encrypted token lifecycle, and GraphQL transport.
- `packages/domain` — provider-independent business rules.
- `packages/db` — Drizzle schema and Lakebase Postgres repositories.
- `packages/voice` — deterministic assistant compiler and Vapi provider adapter.

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

## Implemented voice contracts

`POST /v1/vapi/tools/check-service-area`

- Requires `Authorization: Bearer <VAPI_SERVER_TOKEN>`.
- Accepts Vapi's `tool-calls` server message envelope.
- Resolves the organization from the trusted Vapi call ID.
- Executes a tenant-scoped ZIP lookup.
- Fails closed and never accepts an organization ID from model arguments.

`POST /v1/vapi/tools/request-human`

- Resolves the destination from tenant-owned escalation policy.
- Rejects caller/model-supplied phone numbers.
- Falls back to a dispatcher callback when no safe destination is configured.

`POST /v1/webhooks/vapi`

- Accepts authenticated Vapi server events.
- Resolves new calls through the provisioned assistant mapping.
- Deduplicates provider retries using a canonical event fingerprint.
- Normalizes lifecycle timestamps, transcript, summary, and end reason.

## Vapi assistant sync

After saving a tenant's `assistant_config_json`, run the explicit worker sync command:

```bash
pnpm --filter @hvac/worker sync:vapi-assistant -- <organization-id>
```

The command requires `DATABASE_URL`, `VAPI_PRIVATE_KEY`, `VAPI_SERVER_CREDENTIAL_ID`,
and `VOICE_API_BASE_URL`. It creates the tenant assistant once, patches it only when
the deterministic configuration hash changes, and persists provider/config versions
only after Vapi succeeds.

Health probes are available at `GET /health/live` and `GET /health/ready`.
