import { CheckServiceArea, type ServiceAreaRepository } from "@hvac/domain";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import { hasValidBearerToken } from "./auth/bearer.js";
import { checkServiceAreaRoutes } from "./routes/check-service-area.js";

export interface BuildAppOptions {
  repository: ServiceAreaRepository;
  vapiServerToken: string;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: "x-request-id",
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      const ready = await options.repository.ping();
      return ready
        ? { status: "ready" }
        : reply.code(503).send({ status: "not_ready" });
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  app.register(
    async (vapi) => {
      vapi.addHook("onRequest", async (request, reply) => {
        if (
          !hasValidBearerToken(
            request.headers.authorization,
            options.vapiServerToken,
          )
        ) {
          await reply.code(401).send({ error: "unauthorized" });
        }
      });

      await vapi.register(checkServiceAreaRoutes, {
        service: new CheckServiceArea(options.repository),
      });
    },
  );

  return app;
}
