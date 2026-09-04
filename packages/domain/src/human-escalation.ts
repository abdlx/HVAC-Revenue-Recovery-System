export const humanRequestReasonCodes = [
  "CUSTOMER_REQUESTED_HUMAN",
  "LIFE_SAFETY",
  "COMMERCIAL_REQUEST",
  "EXISTING_JOB_ISSUE",
  "UNSUPPORTED_SERVICE",
  "SYSTEM_FAILURE",
] as const;

export type HumanRequestReasonCode = (typeof humanRequestReasonCodes)[number];
export type HumanRequestPriority = "NORMAL" | "HIGH" | "EMERGENCY";

export interface HumanEscalationRequest {
  vapiCallId: string;
  toolCallId: string;
  reasonCode: HumanRequestReasonCode;
  priority: HumanRequestPriority;
}

export type HumanEscalationDecision =
  | {
      action: "TRANSFER";
      destination: { type: "number" | "sip"; value: string };
      notesForAgent: string;
    }
  | {
      action: "CALLBACK";
      destination: null;
      notesForAgent: string;
    };

export interface HumanEscalationRepository {
  resolveAndRecordHumanRequest(
    request: HumanEscalationRequest,
  ): Promise<HumanEscalationDecision | null>;
}

export class RequestHuman {
  constructor(private readonly repository: HumanEscalationRepository) {}

  async execute(
    request: HumanEscalationRequest,
  ): Promise<HumanEscalationDecision> {
    const decision = await this.repository.resolveAndRecordHumanRequest(request);

    return (
      decision ?? {
        action: "CALLBACK",
        destination: null,
        notesForAgent:
          "A live transfer is not configured. Tell the caller a dispatcher will call them back.",
      }
    );
  }
}
