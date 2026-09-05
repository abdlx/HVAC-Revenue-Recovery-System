"use server";

import { PostgresTenantOnboardingRepository } from "@hvac/db";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/lib/auth/server";
import { getDatabase } from "@/lib/database";

const organizationSchema = z.object({
  businessName: z.string().trim().min(2, "Enter the business name").max(120),
  timezone: z.enum(["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles"]),
  address1: z.string().trim().min(3, "Enter the street address").max(160),
  city: z.string().trim().min(2, "Enter the city").max(80),
  state: z.string().trim().length(2, "Use the two-letter state code").toUpperCase(),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a valid ZIP code"),
});

export interface OnboardingState { error: string | null }

export async function createOrganizationAction(
  _previousState: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const { data: session } = await getAuth().getSession();
  if (!session?.user) redirect("/sign-in");
  const parsed = organizationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  await new PostgresTenantOnboardingRepository(getDatabase().db).createForUser({
    authUserId: session.user.id,
    businessName: parsed.data.businessName,
    timezone: parsed.data.timezone,
    address: {
      address1: parsed.data.address1,
      city: parsed.data.city,
      state: parsed.data.state,
      postalCode: parsed.data.postalCode,
    },
  });
  redirect("/dashboard");
}
