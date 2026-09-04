import {
  requestHumanParametersSchema,
  vapiToolCallsEnvelopeSchema,
  type RequestHumanResult,
  type VapiToolResult,
  type VapiToolResultsResponse,
} from "@hvac/contracts";
import { RequestHuman } from "@hvac/domain";
import type { FastifyPluginAsync } from "fastify";

const TOOL_NAME = "request_human";

interface RequestHumanRoutesOptions {
  service: RequestHuman;
}

function toolResult(
  name: string,
  toolCallId: string,
  value: RequestHumanResult | { error: string; notes_for_agent: string },
): VapiToolResult {
  return { name, toolCallId, result: JSON.stringify(value) };
}

export const requestHumanRoutes: FastifyPluginAsync<
  RequestHumanRoutesOptions
> = async (app, options) => {
  app.post(
    "/v1/vapi/tools/request-human",
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

          const parameters = requestHumanParametersSchema.safeParse(
            call.parameters,
          );
          if (!parameters.success) {
            return toolResult(call.name, call.id, {
              error: "invalid_human_request",
              notes_for_agent:
                "Ask whether the caller wants a dispatcher callback, then retry with an approved reason and priority.",
            });
          }

          try {
            const decision = await options.service.execute({
              vapiCallId,
              toolCallId: call.id,
              reasonCode: parameters.data.reason_code,
              priority: parameters.data.priority,
            });
            return toolResult(call.name, call.id, {
              action: decision.action,
              destination: decision.destination,
              notes_for_agent: decision.notesForAgent,
            });
          } catch (error) {
            request.log.error(
              { err: error, vapi_call_id: vapiCallId, tool_call_id: call.id },
              "human escalation lookup failed",
            );
            return toolResult(call.name, call.id, {
              action: "CALLBACK",
              destination: null,
              notes_for_agent:
                "The transfer configuration is unavailable. Tell the caller a dispatcher will call them back.",
            });
          }
        }),
      );

      return { results };
    },
  );
};
