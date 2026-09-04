import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const organizationStatus = pgEnum("organization_status", [
  "ONBOARDING",
  "ACTIVE",
  "SUSPENDED",
]);

export const voiceProvider = pgEnum("voice_provider", ["VAPI"]);
export const voiceAgentStatus = pgEnum("voice_agent_status", [
  "DRAFT",
  "ACTIVE",
  "DISABLED",
]);
export const serviceAreaType = pgEnum("service_area_type", ["ZIP"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull(),
  status: organizationStatus("status").notNull().default("ONBOARDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const voiceAgents = pgTable(
  "voice_agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: voiceProvider("provider").notNull().default("VAPI"),
    providerAssistantId: text("provider_assistant_id").notNull(),
    configVersion: integer("config_version").notNull().default(1),
    configHash: text("config_hash"),
    promptVersion: text("prompt_version").notNull(),
    status: voiceAgentStatus("status").notNull().default("DRAFT"),
    deployedAt: timestamp("deployed_at", { withTimezone: true }),
  },
  (table) => [
    unique("voice_agents_provider_assistant_unique").on(
      table.provider,
      table.providerAssistantId,
    ),
    index("voice_agents_organization_idx").on(table.organizationId),
  ],
);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    vapiCallId: text("vapi_call_id").notNull().unique(),
    callerPhoneE164: text("caller_phone_e164"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    assistantConfigVersion: integer("assistant_config_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("calls_organization_started_idx").on(table.organizationId, table.startedAt)],
);

export const serviceAreas = pgTable(
  "service_areas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: serviceAreaType("type").notNull().default("ZIP"),
    value: text("value").notNull(),
    serviceZone: text("service_zone"),
    notesForAgent: text("notes_for_agent"),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    unique("service_areas_organization_type_value_unique").on(
      table.organizationId,
      table.type,
      table.value,
    ),
    index("service_areas_lookup_idx").on(
      table.organizationId,
      table.type,
      table.value,
      table.active,
    ),
    check(
      "service_areas_zip_format_check",
      sql`${table.type} <> 'ZIP' OR ${table.value} ~ '^[0-9]{5}$'`,
    ),
  ],
);
