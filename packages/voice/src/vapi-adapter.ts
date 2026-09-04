import type {
  VoiceAssistant,
  VoiceAssistantConfiguration,
  VoiceAssistantProvider,
} from "./provider.js";

type Fetch = typeof fetch;

export class VapiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VapiApiError";
  }
}

export interface VapiAdapterOptions {
  privateKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: Fetch;
}

export class VapiAdapter implements VoiceAssistantProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetch: Fetch;

  constructor(private readonly options: VapiAdapterOptions) {
    if (options.privateKey.length < 20) {
      throw new Error("Vapi private key is missing or invalid");
    }
    this.baseUrl = (options.baseUrl ?? "https://api.vapi.ai").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  createAssistant(
    configuration: VoiceAssistantConfiguration,
  ): Promise<VoiceAssistant> {
    return this.request("/assistant", "POST", configuration);
  }

  updateAssistant(
    assistantId: string,
    configuration: VoiceAssistantConfiguration,
  ): Promise<VoiceAssistant> {
    if (!assistantId.trim()) {
      throw new Error("assistantId is required");
    }
    return this.request(
      `/assistant/${encodeURIComponent(assistantId)}`,
      "PATCH",
      configuration,
    );
  }

  private async request(
    path: string,
    method: "POST" | "PATCH",
    body: VoiceAssistantConfiguration,
  ): Promise<VoiceAssistant> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.options.privateKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new VapiApiError(
        `Vapi assistant request failed with status ${response.status}`,
        response.status,
      );
    }

    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      !("id" in payload) ||
      typeof payload.id !== "string" ||
      !payload.id
    ) {
      throw new VapiApiError("Vapi returned an invalid assistant response", 502);
    }

    return { id: payload.id };
  }
}
