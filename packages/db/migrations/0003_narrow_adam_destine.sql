CREATE TYPE "public"."integration_connection_status" AS ENUM('CONNECTING', 'ACTIVE', 'REFRESH_FAILED', 'DISCONNECTED');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('JOBBER');--> statement-breakpoint
CREATE TABLE "integration_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"external_account_id" text NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"access_expires_at" timestamp with time zone,
	"scopes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"last_refresh_at" timestamp with time zone,
	"status" "integration_connection_status" DEFAULT 'CONNECTING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_accounts_organization_provider_unique" UNIQUE("organization_id","provider"),
	CONSTRAINT "integration_accounts_provider_external_unique" UNIQUE("provider","external_account_id")
);
--> statement-breakpoint
CREATE TABLE "integration_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"code_verifier_encrypted" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_accounts_status_idx" ON "integration_accounts" USING btree ("provider","status");--> statement-breakpoint
CREATE INDEX "integration_oauth_states_expiry_idx" ON "integration_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "integration_oauth_states_organization_idx" ON "integration_oauth_states" USING btree ("organization_id");