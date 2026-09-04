CREATE TYPE "public"."organization_status" AS ENUM('ONBOARDING', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."service_area_type" AS ENUM('ZIP');--> statement-breakpoint
CREATE TYPE "public"."voice_agent_status" AS ENUM('DRAFT', 'ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."voice_provider" AS ENUM('VAPI');--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"vapi_call_id" text NOT NULL,
	"caller_phone_e164" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assistant_config_version" integer NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_vapi_call_id_unique" UNIQUE("vapi_call_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text NOT NULL,
	"status" "organization_status" DEFAULT 'ONBOARDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "service_area_type" DEFAULT 'ZIP' NOT NULL,
	"value" text NOT NULL,
	"service_zone" text,
	"notes_for_agent" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "service_areas_organization_type_value_unique" UNIQUE("organization_id","type","value"),
	CONSTRAINT "service_areas_zip_format_check" CHECK ("service_areas"."type" <> 'ZIP' OR "service_areas"."value" ~ '^[0-9]{5}$')
);
--> statement-breakpoint
CREATE TABLE "voice_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "voice_provider" DEFAULT 'VAPI' NOT NULL,
	"provider_assistant_id" text NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"config_hash" text,
	"prompt_version" text NOT NULL,
	"status" "voice_agent_status" DEFAULT 'DRAFT' NOT NULL,
	"deployed_at" timestamp with time zone,
	CONSTRAINT "voice_agents_provider_assistant_unique" UNIQUE("provider","provider_assistant_id")
);
--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_agents" ADD CONSTRAINT "voice_agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_organization_started_idx" ON "calls" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "service_areas_lookup_idx" ON "service_areas" USING btree ("organization_id","type","value","active");--> statement-breakpoint
CREATE INDEX "voice_agents_organization_idx" ON "voice_agents" USING btree ("organization_id");