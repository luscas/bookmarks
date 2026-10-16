/**
 * Database error helpers. D1/SQLite surface constraint failures as generic
 * `Error`s whose message names the constraint, so callers match on the text.
 */

/** True when an error is a UNIQUE constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("unique constraint") || message.includes("sqlite_constraint");
}
