import {
  createBookingParametersSchema,
  vapiToolCallsEnvelopeSchema,
  type VapiToolResult,
  type VapiToolResultsResponse,
} from "@hvac/contracts";
import { CreateBooking } from "@hvac/domain";
import type { FastifyPluginAsync } from "fastify";

const TOOL_NAME = "create_booking";

interface CreateBookingRoutesOptions {
  service: CreateBooking;
}

function toolResult(name: string, toolCallId: string, value: unknown): VapiToolResult {
  return { name, toolCallId, result: JSON.stringify(value) };
}

export const createBookingRoutes: FastifyPluginAsync<
  CreateBookingRoutesOptions
> = async (app, options) => {
  app.post(
    "/v1/vapi/tools/create-booking",
    async (request, reply): Promise<VapiToolResultsResponse | void> => {
      const envelope = vapiToolCallsEnvelopeSchema.safeParse(request.body);
      if (!envelope.success) {
        await reply.code(400).send({
          error: "invalid_tool_request",
          request_id: request.id,
        });
        return;
      }

      const vapiCallId = envelope.data.message.call.id;
      const results = await Promise.all(
        envelope.data.message.toolCallList.map(async (call) => {
          if (call.name !== TOOL_NAME) {
            return toolResult(call.name, call.id, { error: "unsupported_tool" });
          }
          const parameters = createBookingParametersSchema.safeParse(
            call.parameters,
          );
          if (!parameters.success) {
            return toolResult(call.name, call.id, {
              status: "unavailable",
              reason: "INVALID_PARAMETERS",
            });
          }

          try {
            return toolResult(
              call.name,
              call.id,
              await options.service.execute({
                vapiCallId,
                toolCallId: call.id,
                slotToken: parameters.data.slot_token,
                customerRef: parameters.data.customer_ref,
                propertyRef: parameters.data.property_ref,
                serviceCode: parameters.data.service_code,
                callerConfirmed: parameters.data.caller_confirmed,
                summary: parameters.data.summary,
              }),
            );
          } catch (error) {
            request.log.error(
              { err: error, vapi_call_id: vapiCallId, tool_call_id: call.id },
              "booking request failed",
            );
            return toolResult(call.name, call.id, {
              status: "failed",
              reason: "BOOKING_UNAVAILABLE",
            });
          }
        }),
      );
      return { results };
    },
  );
};
