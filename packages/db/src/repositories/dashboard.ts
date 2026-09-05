import { sql } from "drizzle-orm";
import type { Database } from "../client.js";

export type DashboardRole = "OWNER" | "ADMIN" | "DISPATCHER" | "VIEWER";

export interface OwnerDashboard {
  organization: {
    id: string;
    name: string;
    timezone: string;
    status: "ONBOARDING" | "ACTIVE" | "SUSPENDED";
  };
  role: DashboardRole;
  windowDays: 30;
  metrics: {
    callsCaught: number;
    qualifiedLeads: number;
    confirmedBookings: number;
    followUpRecoveredBookings: number;
    estimatedBookedValue: number;
    realizedRecoveredRevenue: number | null;
  };
  reliability: {
    failedBookings: number;
    crmStatus: string | null;
    voiceStatus: string | null;
    phoneStatus: string | null;
  } | null;
  recentCalls: Array<{
    id: string;
    startedAt: Date;
    caller: string;
    source: string | null;
    reason: string | null;
    outcome: string;
    bookingStatus: string | null;
    durationSeconds: number | null;
  }>;
}

export interface UserTenantContext extends Record<string, unknown> {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationTimezone: string;
  organizationStatus: "ONBOARDING" | "ACTIVE" | "SUSPENDED";
  role: DashboardRole;
}

export function maskPhone(phone: string | null): string {
  if (!phone) return "Unknown caller";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `••• ••• ${digits.slice(-4)}`;
}

/** All reads resolve the organization from the trusted auth identity first. */
export class PostgresDashboardRepository {
  constructor(private readonly db: Database) {}

  async findTenantForUser(authUserId: string): Promise<UserTenantContext | null> {
    const result = await this.db.execute<UserTenantContext>(sql`
      select
        o.id as "organizationId",
        o.name as "organizationName",
        o.slug as "organizationSlug",
        o.timezone as "organizationTimezone",
        o.status as "organizationStatus",
        om.role as "role"
      from organization_members om
      inner join organizations o on o.id = om.organization_id
      where om.auth_user_id = ${authUserId}
      order by om.created_at asc
      limit 1
    `);

    return result.rows[0] ?? null;
  }

  async loadForUser(authUserId: string): Promise<OwnerDashboard | null> {
    const tenant = await this.findTenantForUser(authUserId);
    if (!tenant) return null;

    const organizationId = tenant.organizationId;
    const [metricsResult, reliabilityResult, callsResult] = await Promise.all([
      this.db.execute<{
        callsCaught: number;
        qualifiedLeads: number;
        confirmedBookings: number;
        followUpRecoveredBookings: number;
        estimatedBookedValue: string;
      }>(sql`
        select
          (select count(*)::int from calls
            where organization_id = ${organizationId}
              and started_at >= now() - interval '30 days'
              and source_type in ('MISSED_CALL_OVERFLOW', 'AFTER_HOURS')) as "callsCaught",
          (select count(*)::int from leads
            where organization_id = ${organizationId}
              and created_at >= now() - interval '30 days'
              and qualification_status = 'QUALIFIED') as "qualifiedLeads",
          (select count(*)::int from bookings
            where organization_id = ${organizationId}
              and created_at >= now() - interval '30 days'
              and status = 'CONFIRMED') as "confirmedBookings",
          (select count(*)::int
            from bookings b
            inner join leads l on l.id = b.lead_id and l.organization_id = b.organization_id
            where b.organization_id = ${organizationId}
              and b.created_at >= now() - interval '30 days'
              and b.status = 'CONFIRMED'
              and l.recovery_source is not null
              and l.recovery_source <> 'NONE') as "followUpRecoveredBookings",
          (select coalesce(sum(estimated_value), 0)::text from bookings
            where organization_id = ${organizationId}
              and created_at >= now() - interval '30 days'
              and status = 'CONFIRMED') as "estimatedBookedValue"
      `),
      this.db.execute<{
        failedBookings: number;
        crmStatus: string | null;
        voiceStatus: string | null;
        phoneStatus: string | null;
      }>(sql`
        select
          (select count(*)::int from bookings
            where organization_id = ${organizationId}
              and created_at >= now() - interval '30 days'
              and status = 'FAILED') as "failedBookings",
          (select status::text from integration_accounts
            where organization_id = ${organizationId} and provider = 'JOBBER'
            limit 1) as "crmStatus",
          (select status::text from voice_agents
            where organization_id = ${organizationId}
            limit 1) as "voiceStatus",
          (select status::text from phone_routes
            where organization_id = ${organizationId}
            order by created_at desc
            limit 1) as "phoneStatus"
      `),
      this.db.execute<{
        id: string;
        startedAt: Date;
        callerPhone: string | null;
        source: string | null;
        reason: string | null;
        outcome: string;
        bookingStatus: string | null;
        durationSeconds: number | null;
      }>(sql`
        select
          c.id,
          c.started_at as "startedAt",
          c.caller_phone_e164 as "callerPhone",
          c.source_type::text as "source",
          coalesce(l.intent, c.summary) as "reason",
          case
            when b.status = 'CONFIRMED' then 'BOOKED'
            when l.qualification_status = 'QUALIFIED' then 'QUALIFIED'
            when l.qualification_status is not null then l.qualification_status
            when c.ended_reason is not null then c.ended_reason
            else 'COMPLETED'
          end as "outcome",
          b.status::text as "bookingStatus",
          case when c.ended_at is not null
            then greatest(0, extract(epoch from (c.ended_at - c.started_at)))::int
            else null end as "durationSeconds"
        from calls c
        left join lateral (
          select * from leads
          where call_id = c.id and organization_id = c.organization_id
          order by created_at desc limit 1
        ) l on true
        left join lateral (
          select * from bookings
          where lead_id = l.id and organization_id = c.organization_id
          order by created_at desc limit 1
        ) b on true
        where c.organization_id = ${organizationId}
        order by c.started_at desc
        limit 10
      `),
    ]);

    const metrics = metricsResult.rows[0];
    const reliability = reliabilityResult.rows[0];
    if (!metrics || !reliability) {
      throw new Error("Dashboard aggregate query returned no row");
    }

    const canViewReliability = tenant.role === "OWNER" || tenant.role === "ADMIN";

    return {
      organization: {
        id: tenant.organizationId,
        name: tenant.organizationName,
        timezone: tenant.organizationTimezone,
        status: tenant.organizationStatus,
      },
      role: tenant.role,
      windowDays: 30,
      metrics: {
        callsCaught: metrics.callsCaught,
        qualifiedLeads: metrics.qualifiedLeads,
        confirmedBookings: metrics.confirmedBookings,
        followUpRecoveredBookings: metrics.followUpRecoveredBookings,
        estimatedBookedValue: Number(metrics.estimatedBookedValue),
        // Reconciliation/payment events are not implemented yet; never substitute estimates.
        realizedRecoveredRevenue: null,
      },
      reliability: canViewReliability ? reliability : null,
      recentCalls: callsResult.rows.map((call) => ({
        id: call.id,
        startedAt: call.startedAt,
        caller: maskPhone(call.callerPhone),
        source: call.source,
        reason: call.reason,
        outcome: call.outcome,
        bookingStatus: call.bookingStatus,
        durationSeconds: call.durationSeconds,
      })),
    };
  }
}
