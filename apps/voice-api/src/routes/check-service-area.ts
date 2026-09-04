import {
  checkServiceAreaParametersSchema,
  vapiToolCallsEnvelopeSchema,
  type VapiToolResult,
  type VapiToolResultsResponse,
} from "@hvac/contracts";
import { CheckServiceArea } from "@hvac/domain";
import type { FastifyPluginAsync } from "fastify";

const TOOL_NAME = "check_service_area";
const RETRY_MESSAGE =
  "I’m unable to verify the service area right now. Do not offer an appointment; offer a human callback.";

interface CheckServiceAreaRoutesOptions {
  service: CheckServiceArea;
}

function toolResult(
  name: string,
  toolCallId: string,
  value: unknown,
): VapiToolResult {
  return { name, toolCallId, result: JSON.stringify(value) };
}

export const checkServiceAreaRoutes: FastifyPluginAsync<
  CheckServiceAreaRoutesOptions
> = async (app, options) => {
  app.post(
    "/v1/vapi/tools/check-service-area",
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
            return toolResult(call.name, call.id, {
              error: "unsupported_tool",
              notes_for_agent: "This tool is not available at this endpoint.",
            });
          }

          const parameters = checkServiceAreaParametersSchema.safeParse(
            call.parameters,
          );

          if (!parameters.success) {
            return toolResult(call.name, call.id, {
              serviced: false,
              service_zone: null,
              notes_for_agent:
                "Ask the caller for a valid five-digit ZIP code before continuing.",
            });
          }

          try {
            const decision = await options.service.execute(
              vapiCallId,
              parameters.data.zip_code,
            );
            return toolResult(call.name, call.id, decision);
          } catch (error) {
            request.log.error(
              { err: error, vapi_call_id: vapiCallId, tool_call_id: call.id },
              "service area lookup failed",
            );
            return toolResult(call.name, call.id, {
              serviced: false,
              service_zone: null,
              notes_for_agent: RETRY_MESSAGE,
            });
          }
        }),
      );

      return { results };
    },
  );
};
