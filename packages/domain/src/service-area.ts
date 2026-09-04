export interface ServiceAreaMatch {
  serviceZone: string | null;
  notesForAgent: string | null;
}

export interface ServiceAreaRepository {
  findActiveZipForCall(
    vapiCallId: string,
    zipCode: string,
  ): Promise<ServiceAreaMatch | null>;

  ping(): Promise<boolean>;
}

export interface ServiceAreaDecision {
  serviced: boolean;
  service_zone: string | null;
  notes_for_agent: string | null;
}

const OUT_OF_AREA_MESSAGE =
  "This address is outside the configured service area. Do not offer an appointment.";

export class CheckServiceArea {
  constructor(private readonly repository: ServiceAreaRepository) {}

  async execute(
    vapiCallId: string,
    zipCode: string,
  ): Promise<ServiceAreaDecision> {
    const match = await this.repository.findActiveZipForCall(vapiCallId, zipCode);

    if (!match) {
      return {
        serviced: false,
        service_zone: null,
        notes_for_agent: OUT_OF_AREA_MESSAGE,
      };
    }

    return {
      serviced: true,
      service_zone: match.serviceZone,
      notes_for_agent: match.notesForAgent,
    };
  }
}
