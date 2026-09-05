import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { count, eq, inArray } from "drizzle-orm";
import { createDatabase } from "../client.js";
import {
  auditLog,
  bookings,
  calls,
  leads,
  organizationMembers,
  organizationSettings,
  organizations,
} from "../schema/index.js";
import { PostgresDashboardRepository } from "./dashboard.js";
import { PostgresTenantOnboardingRepository } from "./tenant-onboarding.js";

const databaseUrl = process.env.DATABASE_URL;

test(
  "onboarding is idempotent and dashboard data cannot cross tenant boundaries",
  { skip: databaseUrl ? false : "DATABASE_URL is not configured" },
  async () => {
    assert.ok(databaseUrl);
    const { db, pool } = createDatabase(databaseUrl);
    const ownerId = `auth-owner-${randomUUID()}`;
    const otherOwnerId = `auth-owner-${randomUUID()}`;
    const organizationIds: string[] = [];

    try {
      const onboarding = new PostgresTenantOnboardingRepository(db);
      const own = await onboarding.createForUser({
        authUserId: ownerId,
        businessName: "Isolation Heating and Air",
        timezone: "America/Phoenix",
        address: { address1: "10 Main St", city: "Phoenix", state: "AZ", postalCode: "85001" },
      });
      const retried = await onboarding.createForUser({
        authUserId: ownerId,
        businessName: "This retry must not create another tenant",
        timezone: "America/Denver",
        address: { address1: "20 Other St", city: "Denver", state: "CO", postalCode: "80202" },
      });
      const other = await onboarding.createForUser({
        authUserId: otherOwnerId,
        businessName: "Other Tenant HVAC",
        timezone: "America/Denver",
        address: { address1: "30 Other St", city: "Denver", state: "CO", postalCode: "80203" },
      });
      organizationIds.push(own.organizationId, other.organizationId);

      assert.equal(own.created, true);
      assert.equal(retried.created, false);
      assert.equal(retried.organizationId, own.organizationId);
      assert.notEqual(other.organizationId, own.organizationId);

      const [ownCall] = await db.insert(calls).values({
        organizationId: own.organizationId,
        vapiCallId: `dashboard-${randomUUID()}`,
        sourceType: "AFTER_HOURS",
        callerPhoneE164: "+16025551234",
        assistantConfigVersion: 1,
        promptVersion: "v1",
        startedAt: new Date(),
        endedAt: new Date(),
        summary: "No cooling",
      }).returning({ id: calls.id });
      assert.ok(ownCall);
      const [ownLead] = await db.insert(leads).values({
        organizationId: own.organizationId,
        callId: ownCall.id,
        source: "VOICE",
        recoverySource: "AFTER_HOURS",
        intent: "AC repair",
        qualificationStatus: "QUALIFIED",
      }).returning({ id: leads.id });
      assert.ok(ownLead);
      await db.insert(bookings).values({
        organizationId: own.organizationId,
        leadId: ownLead.id,
        crmProvider: "JOBBER",
        crmBookingId: `jobber-${randomUUID()}`,
        startsAt: new Date(Date.now() + 3_600_000),
        endsAt: new Date(Date.now() + 7_200_000),
        status: "CONFIRMED",
        idempotencyKey: `dashboard-${randomUUID()}`,
        estimatedValue: "425.00",
      });

      await db.insert(calls).values({
        organizationId: other.organizationId,
        vapiCallId: `dashboard-${randomUUID()}`,
        sourceType: "AFTER_HOURS",
        callerPhoneE164: "+14805559999",
        assistantConfigVersion: 1,
        promptVersion: "v1",
      });

      const dashboard = await new PostgresDashboardRepository(db).loadForUser(ownerId);
      assert.ok(dashboard);
      assert.equal(dashboard.organization.id, own.organizationId);
      assert.equal(dashboard.metrics.callsCaught, 1);
      assert.equal(dashboard.metrics.qualifiedLeads, 1);
      assert.equal(dashboard.metrics.confirmedBookings, 1);
      assert.equal(dashboard.metrics.estimatedBookedValue, 425);
      assert.equal(dashboard.metrics.realizedRecoveredRevenue, null);
      assert.equal(dashboard.recentCalls.length, 1);
      assert.equal(dashboard.recentCalls[0]?.caller, "••• ••• 1234");

      const [memberCount] = await db.select({ value: count() }).from(organizationMembers).where(eq(organizationMembers.authUserId, ownerId));
      const [settingsCount] = await db.select({ value: count() }).from(organizationSettings).where(eq(organizationSettings.organizationId, own.organizationId));
      const [auditCount] = await db.select({ value: count() }).from(auditLog).where(eq(auditLog.organizationId, own.organizationId));
      assert.equal(memberCount?.value, 1);
      assert.equal(settingsCount?.value, 1);
      assert.equal(auditCount?.value, 1);
    } finally {
      if (organizationIds.length) await db.delete(organizations).where(inArray(organizations.id, organizationIds));
      await pool.end();
    }
  },
);
