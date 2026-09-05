import {
  getAvailableSlotsParametersSchema,
  vapiToolCallsEnvelopeSchema,
  type VapiToolResult,
  type VapiToolResultsResponse,
} from "@hvac/contracts";
import { OfferAppointmentSlots } from "@hvac/domain";
import type { FastifyPluginAsync } from "fastify";

const TOOL_NAME = "get_available_slots";

interface GetAvailableSlotsRoutesOptions {
  service: OfferAppointmentSlots;
}

function toolResult(name: string, toolCallId: string, value: unknown): VapiToolResult {
  return { name, toolCallId, result: JSON.stringify(value) };
}

export const getAvailableSlotsRoutes: FastifyPluginAsync<
  GetAvailableSlotsRoutesOptions
> = async (app, options) => {
  app.post(
    "/v1/vapi/tools/get-available-slots",
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
          const parameters = getAvailableSlotsParametersSchema.safeParse(
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
                serviceCode: parameters.data.service_code,
                propertyRef: parameters.data.property_ref,
                ...(parameters.data.preferred_date
                  ? { preferredDate: parameters.data.preferred_date }
                  : {}),
                ...(parameters.data.day_part
                  ? { dayPart: parameters.data.day_part }
                  : {}),
              }),
            );
          } catch (error) {
            request.log.error(
              { err: error, vapi_call_id: vapiCallId, tool_call_id: call.id },
              "availability lookup failed",
            );
            return toolResult(call.name, call.id, {
              status: "unavailable",
              reason: "AVAILABILITY_UNAVAILABLE",
            });
          }
        }),
      );
      return { results };
    },
  );
};
