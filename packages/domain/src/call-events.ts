export interface NormalizedVapiCallEvent {
  providerEventId: string;
  vapiCallId: string;
  providerAssistantId: string | null;
  providerPhoneNumberId: string | null;
  eventType: string;
  status: string | null;
  callerPhoneE164: string | null;
  startedAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  endedReason: string | null;
  transcript: string | null;
  summary: string | null;
  rawPayload: Record<string, unknown>;
}

export type VapiEventIngestionResult =
  | { status: "accepted"; callId: string }
  | { status: "duplicate"; callId: string }
  | { status: "unknown_call_context" };

export interface VapiCallEventRepository {
  ingestVapiEvent(
    event: NormalizedVapiCallEvent,
  ): Promise<VapiEventIngestionResult>;
}

export class IngestVapiCallEvent {
  constructor(private readonly repository: VapiCallEventRepository) {}

  execute(event: NormalizedVapiCallEvent): Promise<VapiEventIngestionResult> {
    return this.repository.ingestVapiEvent(event);
  }
}
