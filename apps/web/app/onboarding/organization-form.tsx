"use client";

import { useActionState } from "react";
import { createOrganizationAction } from "./actions";

export function OrganizationForm() {
  const [state, action, pending] = useActionState(createOrganizationAction, { error: null });
  return (
    <form className="onboarding-form" action={action}>
      <label className="full-field">Business name<input name="businessName" placeholder="North Star Heating & Air" required /></label>
      <div className="field-grid">
        <label>Timezone<select name="timezone" defaultValue="America/Chicago" required>
          <option value="America/New_York">Eastern</option><option value="America/Chicago">Central</option>
          <option value="America/Denver">Mountain</option><option value="America/Phoenix">Arizona</option>
          <option value="America/Los_Angeles">Pacific</option>
        </select></label>
        <label>Street address<input name="address1" placeholder="1200 Market Street" required /></label>
        <label>City<input name="city" placeholder="Dallas" required /></label>
        <div className="short-fields">
          <label>State<input name="state" placeholder="TX" maxLength={2} required /></label>
          <label>ZIP code<input name="postalCode" inputMode="numeric" placeholder="75201" required /></label>
        </div>
      </div>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>{pending ? "Creating workspace…" : "Create workspace"}</button>
    </form>
  );
}
