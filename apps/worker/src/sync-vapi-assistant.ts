import { createDatabase, PostgresAssistantSyncRepository } from "@hvac/db";
import { SyncVapiAssistant, VapiAdapter } from "@hvac/voice";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const organizationId = process.argv[2]?.trim();
if (!organizationId) {
  throw new Error(
    "Usage: pnpm --filter @hvac/worker sync:vapi-assistant -- <organization-id>",
  );
}

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED?.trim() ??
  requiredEnvironment("DATABASE_URL");
const { db, pool } = createDatabase(databaseUrl);

try {
  const service = new SyncVapiAssistant(
    new VapiAdapter({ privateKey: requiredEnvironment("VAPI_PRIVATE_KEY") }),
    new PostgresAssistantSyncRepository(db),
    {
      voiceApiBaseUrl: requiredEnvironment("VOICE_API_BASE_URL"),
      serverCredentialId: requiredEnvironment("VAPI_SERVER_CREDENTIAL_ID"),
    },
  );
  const result = await service.execute(organizationId);
  console.info(
    JSON.stringify({
      organizationId: result.organizationId,
      providerAssistantId: result.providerAssistantId,
      configVersion: result.configVersion,
      promptVersion: result.promptVersion,
      toolContractVersion: result.toolContractVersion,
      action: result.action,
      deployedAt: result.deployedAt.toISOString(),
    }),
  );
} finally {
  await pool.end();
}
