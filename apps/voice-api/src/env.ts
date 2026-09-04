import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  VAPI_SERVER_TOKEN: z.string().min(32),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type VoiceApiEnv = z.infer<typeof envSchema>;

export function parseEnv(env: NodeJS.ProcessEnv): VoiceApiEnv {
  return envSchema.parse(env);
}
