export interface VoiceAssistantConfiguration {
  name: string;
  firstMessage: string;
  server: {
    url: string;
    credentialId: string;
  };
  serverMessages: string[];
  model: Record<string, unknown>;
  voice: Record<string, unknown>;
  transcriber: Record<string, unknown>;
  artifactPlan: {
    recordingEnabled: boolean;
    transcriptPlan: { enabled: true };
  };
}

export interface VoiceAssistant {
  id: string;
}

export interface VoiceAssistantProvider {
  createAssistant(
    configuration: VoiceAssistantConfiguration,
  ): Promise<VoiceAssistant>;
  updateAssistant(
    assistantId: string,
    configuration: VoiceAssistantConfiguration,
  ): Promise<VoiceAssistant>;
}
