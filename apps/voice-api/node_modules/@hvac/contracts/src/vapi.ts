import { z } from "zod";

export const checkServiceAreaParametersSchema = z
  .object({
    zip_code: z.string().regex(/^\d{5}$/, "zip_code must contain exactly five digits"),
    city: z.string().trim().min(1).max(100).optional(),
    state: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
  })
  .strict();

export const vapiToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  parameters: z.unknown(),
});

export const vapiToolCallsEnvelopeSchema = z.object({
  message: z
    .object({
      type: z.literal("tool-calls"),
      call: z.object({ id: z.string().min(1) }).passthrough(),
      toolCallList: z.array(vapiToolCallSchema).min(1),
    })
    .passthrough(),
});

export type CheckServiceAreaParameters = z.infer<
  typeof checkServiceAreaParametersSchema
>;

export type VapiToolCallsEnvelope = z.infer<
  typeof vapiToolCallsEnvelopeSchema
>;

export interface VapiToolResult {
  name: string;
  toolCallId: string;
  result: string;
}

export interface VapiToolResultsResponse {
  results: VapiToolResult[];
}
