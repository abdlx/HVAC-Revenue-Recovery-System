ALTER TABLE "organization_settings" ADD COLUMN "assistant_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "prompt_version" text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "tool_contract_version" text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_agents" ADD COLUMN "tool_contract_version" text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_agents" ADD CONSTRAINT "voice_agents_organization_unique" UNIQUE("organization_id");