import type { ServiceAreaRepository } from "@hvac/domain";
import { and, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { calls, organizations, serviceAreas } from "../schema/index.js";

export class PostgresServiceAreaRepository implements ServiceAreaRepository {
  constructor(private readonly db: Database) {}

  async findActiveZipForCall(vapiCallId: string, zipCode: string) {
    const [match] = await this.db
      .select({
        serviceZone: serviceAreas.serviceZone,
        notesForAgent: serviceAreas.notesForAgent,
      })
      .from(calls)
      .innerJoin(
        serviceAreas,
        and(
          eq(serviceAreas.organizationId, calls.organizationId),
          eq(serviceAreas.type, "ZIP"),
          eq(serviceAreas.value, zipCode),
          eq(serviceAreas.active, true),
        ),
      )
      .where(eq(calls.vapiCallId, vapiCallId))
      .limit(1);

    return match ?? null;
  }

  async ping(): Promise<boolean> {
    await this.db.select({ id: organizations.id }).from(organizations).limit(1);
    return true;
  }
}
