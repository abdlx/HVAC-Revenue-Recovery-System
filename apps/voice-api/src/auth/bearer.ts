import { timingSafeEqual } from "node:crypto";

export function hasValidBearerToken(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }

  const actualToken = authorizationHeader.slice("Bearer ".length);
  const actual = Buffer.from(actualToken);
  const expected = Buffer.from(expectedToken);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
