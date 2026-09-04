CREATE TYPE "public"."call_direction" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TYPE "public"."call_source_type" AS ENUM('MISSED_CALL_OVERFLOW', 'AFTER_HOURS', 'ABANDONED_UNBOOKED_CALL', 'WEB_LEAD_SPEED_TO_LEAD', 'DIRECT', 'TEST');--> statement-breakpoint
CREATE TYPE "public"."escalation_destination_type" AS ENUM('NUMBER', 'SIP');--> statement-breakpoint
CREATE TYPE "public"."escalation_priority" AS ENUM('NORMAL', 'HIGH', 'EMERGENCY');--> statement-breakpoint
CREATE TYPE "public"."organization_member_role" AS ENUM('OWNER', 'ADMIN', 'DISPATCHER', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."phone_route_status" AS ENUM('DRAFT', 'ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."phone_route_type" AS ENUM('CONDITIONAL_FORWARDING', 'TELNYX_SIP', 'TEST');--> statement-breakpoint
CREATE TABLE "call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_events_provider_event_unique" UNIQUE("provider","provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "escalation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"priority" "escalation_priority" DEFAULT 'NORMAL' NOT NULL,
	"destination_type" "escalation_destination_type" NOT NULL,
	"destination_value" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escalation_rules_organization_reason_priority_unique" UNIQUE("organization_id","reason_code","priority")
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"organization_id" uuid NOT NULL,
	"auth_user_id" text NOT NULL,
	"role" "organization_member_role" DEFAULT 'VIEWER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_auth_user_id_pk" PRIMARY KEY("organization_id","auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"business_hours_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_call_fallback" text,
	"recording_policy" jsonb DEFAULT '{"enabled":false}'::jsonb NOT NULL,
	"sms_policy" jsonb DEFAULT '{"enabled":false}'::jsonb NOT NULL,
	"estimated_value_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"public_business_number" text NOT NULL,
	"telnyx_number" text,
	"vapi_phone_number_id" text,
	"sip_uri" text,
	"route_type" "phone_route_type" NOT NULL,
	"fallback_number" text,
	"status" "phone_route_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_routes_public_business_number_unique" UNIQUE("public_business_number"),
	CONSTRAINT "phone_routes_vapi_phone_number_unique" UNIQUE("vapi_phone_number_id")
);
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "telnyx_call_id" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "direction" "call_direction" DEFAULT 'INBOUND' NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "source_type" "call_source_type";--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "ended_reason" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "recording_object_key" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "recording_retention_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_routes" ADD CONSTRAINT "phone_routes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_events_call_received_idx" ON "call_events" USING btree ("call_id","received_at");--> statement-breakpoint
CREATE INDEX "call_events_organization_received_idx" ON "call_events" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE INDEX "escalation_rules_lookup_idx" ON "escalation_rules" USING btree ("organization_id","reason_code","priority","active");--> statement-breakpoint
CREATE INDEX "organization_members_auth_user_idx" ON "organization_members" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "phone_routes_organization_idx" ON "phone_routes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "calls_telnyx_call_idx" ON "calls" USING btree ("telnyx_call_id");