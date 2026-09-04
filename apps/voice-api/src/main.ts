import {
  createDatabase,
  PostgresServiceAreaRepository,
} from "@hvac/db";
import { buildApp } from "./app.js";
import { parseEnv } from "./env.js";

const env = parseEnv(process.env);
const { db, pool } = createDatabase(env.DATABASE_URL);
const app = await buildApp({
  repository: new PostgresServiceAreaRepository(db),
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
 