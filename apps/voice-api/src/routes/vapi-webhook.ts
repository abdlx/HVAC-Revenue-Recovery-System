import { createHash } from "node:crypto";
import { vapiServerEventEnvelopeSchema } from "@hvac/contracts";
import { IngestVapiCallEvent } from "@hvac/domain";
import type { FastifyPluginAsync } from "fastify";

interface VapiWebhookRoutesOptions {
  service: IngestVapiCallEvent;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

function parseVapiDate(value: string | number | undefined): Date | null {
  if (value === undefined) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const vapiWebhookRoutes: FastifyPluginAsync<VapiWebhookRoutesOptions> =
  async (app, options) => {
    app.post("/v1/webhooks/vapi", async (request, reply) => {
      const envelope = vapiServerEventEnvelopeSchema.safeParse(request.body);

      if (!envelope.success) {
        return reply.code(400).send({
          error: "invalid_vapi_event",
          request_id: request.id,
        });
      }

      const { message } = envelope.data;
      const eventTime = parseVapiDate(message.timestamp);
      const startedAt = parseVapiDate(
        message.startedAt ?? message.call.startedAt,
      );
      const explicitEndedAt = parseVapiDate(
        message.endedAt ?? message.call.endedAt,
      );
      const endedAt =
        explicitEndedAt ??
        (message.type === "end-of-call-report" || message.status === "ended"
          ? eventTime
          : null);
      const providerEventId = createHash("sha256")
        .update(canonicalize(message))
        .digest("hex");

      try {
        const result = await options.service.execute({
          providerEventId,
          vapiCallId: message.call.id,
          providerAssistantId: message.call.assistantId ?? null,
          providerPhoneNumberId: message.call.phoneNumberId ?? null,
          eventType: message.type,
          status: message.status ?? null,
          callerPhoneE164: message.call.customer?.number ?? null,
          startedAt,
          answeredAt:
            message.status === "in-progress" ? eventTime ?? new Date() : null,
          endedAt,
          endedReason: message.endedReason ?? null,
          transcript: message.artifact?.transcript ?? message.transcript ?? null,
          summary: message.analysis?.summary ?? null,
          rawPayload: request.body as Record<string, unknown>,
        });

        if (result.status === "unknown_call_context") {
          request.log.error(
            {
              vapi_call_id: message.call.id,
              vapi_assistant_id: message.call.assistantId,
              event_type: message.type,
            },
            "Vapi event has no trusted tenant mapping",
          );
          return reply.code(202).send({
            accepted: false,
            reason: "unknown_call_context",
          });
        }

        return {
          accepted: true,
          duplicate: result.status === "duplicate",
        };
      } catch (error) {
        request.log.error(
          {
            err: error,
            vapi_call_id: message.call.id,
            event_type: message.type,
          },
          "Vapi event persistence failed",
        );
        return reply.code(503).send({
          error: "event_persistence_unavailable",
          request_id: request.id,
        });
      }
    });
  };
