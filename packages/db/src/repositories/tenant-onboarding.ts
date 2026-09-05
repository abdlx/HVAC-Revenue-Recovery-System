import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import {
  auditLog,
  organizationMembers,
  organizationSettings,
  organizations,
} from "../schema/index.js";

export interface CreateTenantInput {
  authUserId: string;
  businessName: string;
  timezone: string;
  address: {
    address1: string;
    city: string;
    state: string;
    postalCode: string;
  };
}

export interface TenantMembership {
  organizationId: string;
  organizationSlug: string;
  role: "OWNER" | "ADMIN" | "DISPATCHER" | "VIEWER";
  created: boolean;
}

function slugify(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${base || "hvac-company"}-${randomUUID().slice(0, 8)}`;
}

/** Creates the first tenant for an authenticated user exactly once. */
export class PostgresTenantOnboardingRepository {
  constructor(private readonly db: Database) {}

  async createForUser(input: CreateTenantInput): Promise<TenantMembership> {
    return this.db.transaction(async (tx) => {
      // Serialize retries and double-clicks for this identity without trusting a client key.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.authUserId}, 0))`,
      );

      const [existing] = await tx
        .select({
          organizationId: organizationMembers.organizationId,
          organizationSlug: organizations.slug,
          role: organizationMembers.role,
        })
        .from(organizationMembers)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMembers.organizationId),
        )
        .where(eq(organizationMembers.authUserId, input.authUserId))
        .limit(1);

      if (existing) {
        return { ...existing, created: false };
      }

      const [organization] = await tx
        .insert(organizations)
        .values({
          name: input.businessName,
          slug: slugify(input.businessName),
          timezone: input.timezone,
          address1: input.address.address1,
          city: input.address.city,
          state: input.address.state,
          postalCode: input.address.postalCode,
        })
        .returning({ id: organizations.id, slug: organizations.slug });

      if (!organization) {
        throw new Error("Failed to create organization");
      }

      await tx.insert(organizationMembers).values({
        organizationId: organization.id,
        authUserId: input.authUserId,
        role: "OWNER",
      });
      await tx.insert(organizationSettings).values({
        organizationId: organization.id,
      });
      await tx.insert(auditLog).values({
        organizationId: organization.id,
        actorType: "USER",
        actorId: input.authUserId,
        action: "ORGANIZATION_CREATED",
        resourceType: "ORGANIZATION",
        resourceId: organization.id,
        metadataJson: { onboardingStep: 1 },
      });

      return {
        organizationId: organization.id,
        organizationSlug: organization.slug,
        role: "OWNER",
        created: true,
      };
    });
  }
}
