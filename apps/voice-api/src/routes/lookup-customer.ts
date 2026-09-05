import {
  lookupCustomerParametersSchema,
  vapiToolCallsEnvelopeSchema,
  type VapiToolResult,
  type VapiToolResultsResponse,
} from "@hvac/contracts";
import { LookupCustomer } from "@hvac/domain";
import type { FastifyPluginAsync } from "fastify";

const TOOL_NAME = "lookup_customer";

interface LookupCustomerRoutesOptions {
  service: LookupCustomer;
}

function toolResult(
  name: string,
  toolCallId: string,
  value: unknown,
): VapiToolResult {
  return { name, toolCallId, result: JSON.stringify(value) };
}

export const lookupCustomerRoutes: FastifyPluginAsync<
  LookupCustomerRoutesOptions
> = async (app, options) => {
  app.post(
    "/v1/vapi/tools/lookup-customer",
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
          if (!lookupCustomerParametersSchema.safeParse(call.parameters).success) {
            return toolResult(call.name, call.id, {
              error: "invalid_customer_lookup",
              notes_for_agent:
                "Customer lookup uses the authenticated call number and accepts no caller-supplied identifiers.",
            });
          }

          try {
            return toolResult(
              call.name,
              call.id,
              await options.service.execute(vapiCallId),
            );
          } catch (error) {
            request.log.error(
              { err: error, vapi_call_id: vapiCallId, tool_call_id: call.id },
              "customer lookup failed",
            );
            return toolResult(call.name, call.id, {
              status: "unavailable",
              reason: "CUSTOMER_LOOKUP_UNAVAILABLE",
            });
          }
        }),
      );

      return { results };
    },
  );
};
