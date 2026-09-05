import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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
export const organizationMemberRole = pgEnum("organization_member_role", [
  "OWNER",
  "ADMIN",
  "DISPATCHER",
  "VIEWER",
]);
export const phoneRouteType = pgEnum("phone_route_type", [
  "CONDITIONAL_FORWARDING",
  "TELNYX_SIP",
  "TEST",
]);
export const phoneRouteStatus = pgEnum("phone_route_status", [
  "DRAFT",
  "ACTIVE",
  "DISABLED",
]);
export const callDirection = pgEnum("call_direction", ["INBOUND", "OUTBOUND"]);
export const callSourceType = pgEnum("call_source_type", [
  "MISSED_CALL_OVERFLOW",
  "AFTER_HOURS",
  "ABANDONED_UNBOOKED_CALL",
  "WEB_LEAD_SPEED_TO_LEAD",
  "DIRECT",
  "TEST",
]);
export const escalationPriority = pgEnum("escalation_priority", [
  "NORMAL",
  "HIGH",
  "EMERGENCY",
]);
export const escalationDestinationType = pgEnum(
  "escalation_destination_type",
  ["NUMBER", "SIP"],
);
export const integrationProvider = pgEnum("integration_provider", ["JOBBER"]);
export const integrationConnectionStatus = pgEnum(
  "integration_connection_status",
  ["CONNECTING", "ACTIVE", "REFRESH_FAILED", "DISCONNECTED"],
);
export const crmRecordProvider = pgEnum("crm_record_provider", ["JOBBER"]);
export const appointmentSlotStatus = pgEnum("appointment_slot_status", [
  "OFFERED",
  "HELD",
  "CONSUMED",
  "EXPIRED",
  "INVALIDATED",
]);
export const bookingStatus = pgEnum("booking_status", [
  "PROCESSING",
  "CONFIRMED",
  "FAILED",
  "CANCELLED",
]);
export const idempotencyStatus = pgEnum("idempotency_status", [
  "PROCESSING",
  "COMPLETED",
  "FAILED",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull(),
  address1: text("address_1"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  status: organizationStatus("status").notNull().default("ONBOARDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    authUserId: text("auth_user_id").notNull(),
    role: organizationMemberRole("role").notNull().default("VIEWER"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.authUserId] }),
    index("organization_members_auth_user_idx").on(table.authUserId),
  ],
);

export const organizationSettings = pgTable("organization_settings", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  businessHoursJson: jsonb("business_hours_json")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  defaultCallFallback: text("default_call_fallback"),
  recordingPolicy: jsonb("recording_policy")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{"enabled":false}'::jsonb`),
  smsPolicy: jsonb("sms_policy")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{"enabled":false}'::jsonb`),
  estimatedValuePolicy: jsonb("estimated_value_policy")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  assistantConfigJson: jsonb("assistant_config_json")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  configVersion: integer("config_version").notNull().default(1),
  promptVersion: text("prompt_version").notNull().default("v1"),
  toolContractVersion: text("tool_contract_version").notNull().default("v1"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("audit_log_actor_idx").on(table.actorType, table.actorId),
  ],
);

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
    toolContractVersion: text("tool_contract_version").notNull().default("v1"),
    status: voiceAgentStatus("status").notNull().default("DRAFT"),
    deployedAt: timestamp("deployed_at", { withTimezone: true }),
  },
  (table) => [
    unique("voice_agents_provider_assistant_unique").on(
      table.provider,
      table.providerAssistantId,
    ),
    unique("voice_agents_organization_unique").on(table.organizationId),
    index("voice_agents_organization_idx").on(table.organizationId),
  ],
);

export const integrationAccounts = pgTable(
  "integration_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: integrationProvider("provider").notNull(),
    externalAccountId: text("external_account_id").notNull(),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    scopesJson: jsonb("scopes_json").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    tokenVersion: integer("token_version").notNull().default(1),
    lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
    status: integrationConnectionStatus("status").notNull().default("CONNECTING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("integration_accounts_organization_provider_unique").on(
      table.organizationId,
      table.provider,
    ),
    unique("integration_accounts_provider_external_unique").on(
      table.provider,
      table.externalAccountId,
    ),
    index("integration_accounts_status_idx").on(table.provider, table.status),
  ],
);

export const integrationOauthStates = pgTable(
  "integration_oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: integrationProvider("provider").notNull(),
    codeVerifierEncrypted: text("code_verifier_encrypted").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("integration_oauth_states_expiry_idx").on(table.expiresAt),
    index("integration_oauth_states_organization_idx").on(table.organizationId),
  ],
);

export const phoneRoutes = pgTable(
  "phone_routes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    publicBusinessNumber: text("public_business_number").notNull(),
    telnyxNumber: text("telnyx_number"),
    vapiPhoneNumberId: text("vapi_phone_number_id"),
    sipUri: text("sip_uri"),
    routeType: phoneRouteType("route_type").notNull(),
    fallbackNumber: text("fallback_number"),
    status: phoneRouteStatus("status").notNull().default("DRAFT"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("phone_routes_public_business_number_unique").on(
      table.publicBusinessNumber,
    ),
    unique("phone_routes_vapi_phone_number_unique").on(table.vapiPhoneNumberId),
    index("phone_routes_organization_idx").on(table.organizationId),
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
    telnyxCallId: text("telnyx_call_id"),
    direction: callDirection("direction").notNull().default("INBOUND"),
    sourceType: callSourceType("source_type"),
    callerPhoneE164: text("caller_phone_e164"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    assistantConfigVersion: integer("assistant_config_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    transcript: text("transcript"),
    summary: text("summary"),
    recordingObjectKey: text("recording_object_key"),
    recordingRetentionUntil: timestamp("recording_retention_until", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("calls_organization_started_idx").on(table.organizationId, table.startedAt),
    index("calls_telnyx_call_idx").on(table.telnyxCallId),
  ],
);

export const callEvents = pgTable(
  "call_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("call_events_provider_event_unique").on(
      table.provider,
      table.providerEventId,
    ),
    index("call_events_call_received_idx").on(table.callId, table.receivedAt),
    index("call_events_organization_received_idx").on(
      table.organizationId,
      table.receivedAt,
    ),
  ],
);

export const escalationRules = pgTable(
  "escalation_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reasonCode: text("reason_code").notNull(),
    priority: escalationPriority("priority").notNull().default("NORMAL"),
    destinationType: escalationDestinationType("destination_type").notNull(),
    destinationValue: text("destination_value").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("escalation_rules_organization_reason_priority_unique").on(
      table.organizationId,
      table.reasonCode,
      table.priority,
    ),
    index("escalation_rules_lookup_idx").on(
      table.organizationId,
      table.reasonCode,
      table.priority,
      table.active,
    ),
  ],
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

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    crmProvider: crmRecordProvider("crm_provider").notNull(),
    crmCustomerId: text("crm_customer_id").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phoneE164: text("phone_e164").notNull(),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("customers_organization_provider_crm_unique").on(
      table.organizationId,
      table.crmProvider,
      table.crmCustomerId,
    ),
    index("customers_organization_phone_idx").on(
      table.organizationId,
      table.phoneE164,
    ),
  ],
);

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    crmPropertyId: text("crm_property_id").notNull(),
    address1: text("address_1").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCode: text("postal_code").notNull(),
    latitude: numeric("lat", { precision: 9, scale: 6 }),
    longitude: numeric("lng", { precision: 9, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("properties_organization_crm_unique").on(
      table.organizationId,
      table.crmPropertyId,
    ),
    index("properties_customer_idx").on(table.customerId),
  ],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    defaultDurationMinutes: integer("default_duration_minutes").notNull(),
    estimatedTicketValue: numeric("estimated_ticket_value", {
      precision: 12,
      scale: 2,
    }),
    requiresHuman: boolean("requires_human").notNull().default(false),
    bookingEnabled: boolean("booking_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("services_organization_code_unique").on(table.organizationId, table.code),
    index("services_organization_active_idx").on(table.organizationId, table.active),
    check(
      "services_duration_positive_check",
      sql`${table.defaultDurationMinutes} > 0`,
    ),
  ],
);

export const bookingRules = pgTable(
  "booking_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    minLeadMinutes: integer("min_lead_minutes").notNull().default(60),
    maxHorizonDays: integer("max_horizon_days").notNull().default(30),
    arrivalWindowMinutes: integer("arrival_window_minutes").notNull().default(120),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    capacity: integer("capacity").notNull().default(1),
    rulesJson: jsonb("rules_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("booking_rules_organization_service_unique").on(
      table.organizationId,
      table.serviceId,
    ),
    check("booking_rules_min_lead_check", sql`${table.minLeadMinutes} >= 0`),
    check("booking_rules_horizon_check", sql`${table.maxHorizonDays} > 0`),
    check("booking_rules_window_check", sql`${table.arrivalWindowMinutes} > 0`),
    check("booking_rules_capacity_check", sql`${table.capacity} > 0`),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    propertyId: uuid("property_id").references(() => properties.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull(),
    recoverySource: text("recovery_source"),
    intent: text("intent"),
    serviceCode: text("service_code"),
    urgency: text("urgency"),
    qualificationStatus: text("qualification_status").notNull().default("NEW"),
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("leads_organization_created_idx").on(table.organizationId, table.createdAt),
    index("leads_call_idx").on(table.callId),
  ],
);

export const appointmentSlots = pgTable(
  "appointment_slots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").references(() => properties.id, {
      onDelete: "set null",
    }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    slotTokenHash: text("slot_token_hash").notNull().unique(),
    status: appointmentSlotStatus("status").notNull().default("OFFERED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("appointment_slots_call_status_idx").on(table.callId, table.status),
    index("appointment_slots_expiry_idx").on(table.expiresAt),
    check("appointment_slots_time_check", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    appointmentSlotId: uuid("appointment_slot_id").references(
      () => appointmentSlots.id,
      { onDelete: "set null" },
    ),
    crmProvider: crmRecordProvider("crm_provider").notNull(),
    crmBookingId: text("crm_booking_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: bookingStatus("status").notNull().default("PROCESSING"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    estimatedValue: numeric("estimated_value", { precision: 12, scale: 2 }),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("bookings_crm_provider_id_unique").on(
      table.crmProvider,
      table.crmBookingId,
    ),
    unique("bookings_appointment_slot_unique").on(table.appointmentSlotId),
    index("bookings_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    check("bookings_time_check", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    requestHash: text("request_hash").notNull(),
    status: idempotencyStatus("status").notNull().default("PROCESSING"),
    responseJson: jsonb("response_json").$type<Record<string, unknown>>(),
    failureCode: text("failure_code"),
    lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idempotency_keys_expiry_idx").on(table.expiresAt),
    index("idempotency_keys_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
);
