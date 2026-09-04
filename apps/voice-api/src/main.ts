import {
  createDatabase,
  PostgresHumanEscalationRepository,
  PostgresServiceAreaRepository,
  PostgresVapiCallEventRepository,
} from "@hvac/db";
import { buildApp } from "./app.js";
import { parseEnv } from "./env.js";

const env = parseEnv(process.env);
const { db, pool } = createDatabase(env.DATABASE_URL);
const app = await buildApp({
  serviceAreaRepository: new PostgresServiceAreaRepository(db),
  vapiCallEventRepository: new PostgresVapiCallEventRepository(db),
  humanEscalationRepository: new PostgresHumanEscalationRepository(db),
  vapiServerToken: env.VAPI_SERVER_TOKEN,
  logger: {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.body.message.call.customer.number",
        "req.body.message.customer.number",
      ],
      censor: "[REDACTED]",
    },
  },
});

app.addHook("onClose", async () => {
  await pool.end();
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.fatal({ err: error }, "voice API failed to start");
  process.exitCode = 1;
}
