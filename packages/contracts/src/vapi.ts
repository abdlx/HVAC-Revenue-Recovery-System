import { z } from "zod";

export const checkServiceAreaParametersSchema = z
  .object({
    zip_code: z.string().regex(/^\d{5}$/, "zip_code must contain exactly five digits"),
    city: z.string().trim().min(1).max(100).optional(),
    state: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
  })
  .strict();

export const lookupCustomerParametersSchema = z.object({}).strict();

const serviceCodeSchema = z.string().trim().regex(/^[A-Z0-9_]{2,64}$/);
const localReferenceSchema = z.string().uuid();

export const getAvailableSlotsParametersSchema = z
  .object({
    service_code: serviceCodeSchema,
    property_ref: localReferenceSchema,
    preferred_date: z.iso.date().optional(),
    day_part: z.enum(["MORNING", "AFTERNOON", "EVENING"]).optional(),
  })
  .strict();

export const createBookingParametersSchema = z
  .object({
    slot_token: z.string().regex(/^slot_[A-Za-z0-9_-]{32,128}$/),
    customer_ref: localReferenceSchema,
    property_ref: localReferenceSchema,
    service_code: serviceCodeSchema,
    caller_confirmed: z.boolean(),
    summary: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const requestHumanParametersSchema = z
  .object({
    reason_code: z.enum([
      "CUSTOMER_REQUESTED_HUMAN",
      "LIFE_SAFETY",
      "COMMERCIAL_REQUEST",
      "EXISTING_JOB_ISSUE",
      "UNSUPPORTED_SERVICE",
      "SYSTEM_FAILURE",
    ]),
    priority: z.enum(["NORMAL", "HIGH", "EMERGENCY"]).default("NORMAL"),
  })
  .strict();

export const vapiToolCallSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    parameters: z.unknown().optional(),
    arguments: z.unknown().optional(),
  })
  .refine(
    (call) => call.parameters !== undefined || call.arguments !== undefined,
    "tool call must include parameters or arguments",
  )
  .transform((call) => ({
    id: call.id,
    name: call.name,
    parameters: call.parameters ?? call.arguments,
  }));

export const vapiToolCallsEnvelopeSchema = z.object({
  message: z
    .object({
      type: z.literal("tool-calls"),
      call: z.object({ id: z.string().min(1) }).passthrough(),
      toolCallList: z.array(vapiToolCallSchema).min(1),
    })
    .passthrough(),
});

const vapiEventDateSchema = z.union([z.string(), z.number()]);

export const vapiServerEventEnvelopeSchema = z.object({
  message: z
    .object({
      type: z.string().trim().min(1),
      timestamp: vapiEventDateSchema.optional(),
      status: z.string().trim().min(1).optional(),
      startedAt: vapiEventDateSchema.optional(),
      endedAt: vapiEventDateSchema.optional(),
      endedReason: z.string().optional(),
      transcript: z.string().optional(),
      call: z
        .object({
          id: z.string().min(1),
          assistantId: z.string().min(1).optional(),
          phoneNumberId: z.string().min(1).optional(),
          startedAt: vapiEventDateSchema.optional(),
          endedAt: vapiEventDateSchema.optional(),
          customer: z
            .object({ number: z.string().min(1).optional() })
            .passthrough()
            .optional(),
        })
        .passthrough(),
      artifact: z
        .object({ transcript: z.string().optional() })
        .passthrough()
        .optional(),
      analysis: z
        .object({ summary: z.string().optional() })
        .passthrough()
        .optional(),
    })
    .passthrough(),
});

export type CheckServiceAreaParameters = z.infer<
  typeof checkServiceAreaParametersSchema
>;

export type LookupCustomerParameters = z.infer<
  typeof lookupCustomerParametersSchema
>;

export type GetAvailableSlotsParameters = z.infer<
  typeof getAvailableSlotsParametersSchema
>;

export type CreateBookingParameters = z.infer<
  typeof createBookingParametersSchema
>;

export type RequestHumanParameters = z.infer<
  typeof requestHumanParametersSchema
>;

export type VapiToolCallsEnvelope = z.infer<
  typeof vapiToolCallsEnvelopeSchema
>;

export type VapiServerEventEnvelope = z.infer<
  typeof vapiServerEventEnvelopeSchema
>;

export interface VapiToolResult {
  name: string;
  toolCallId: string;
  result: string;
}

export interface VapiToolResultsResponse {
  results: VapiToolResult[];
}

export interface RequestHumanResult {
  action: "TRANSFER" | "CALLBACK";
  destination: { type: "number" | "sip"; value: string } | null;
  notes_for_agent: string;
}
