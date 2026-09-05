import {
  CheckServiceArea,
  IngestVapiCallEvent,
  LookupCustomer,
  OfferAppointmentSlots,
  CreateBooking,
  RequestHuman,
  type HumanEscalationRepository,
  type ServiceAreaRepository,
  type VapiCallEventRepository,
} from "@hvac/domain";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import { hasValidBearerToken } from "./auth/bearer.js";
import { checkServiceAreaRoutes } from "./routes/check-service-area.js";
import { createBookingRoutes } from "./routes/create-booking.js";
import { getAvailableSlotsRoutes } from "./routes/get-available-slots.js";
import { lookupCustomerRoutes } from "./routes/lookup-customer.js";
import { requestHumanRoutes } from "./routes/request-human.js";
import { vapiWebhookRoutes } from "./routes/vapi-webhook.js";

export interface BuildAppOptions {
  serviceAreaRepository: ServiceAreaRepository;
  vapiCallEventRepository: VapiCallEventRepository;
  humanEscalationRepository: HumanEscalationRepository;
  customerLookup?: LookupCustomer;
  appointmentSlots?: OfferAppointmentSlots;
  createBooking?: CreateBooking;
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
      const ready = await options.serviceAreaRepository.ping();
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
        service: new CheckServiceArea(options.serviceAreaRepository),
      });
      await vapi.register(requestHumanRoutes, {
        service: new RequestHuman(options.humanEscalationRepository),
      });
      if (options.customerLookup) {
        await vapi.register(lookupCustomerRoutes, {
          service: options.customerLookup,
        });
      }
      if (options.appointmentSlots) {
        await vapi.register(getAvailableSlotsRoutes, {
          service: options.appointmentSlots,
        });
      }
      if (options.createBooking) {
        await vapi.register(createBookingRoutes, {
          service: options.createBooking,
        });
      }
      await vapi.register(vapiWebhookRoutes, {
        service: new IngestVapiCallEvent(options.vapiCallEventRepository),
      });
    },
  );

  return app;
}
