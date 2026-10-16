/**
 * Split an array into fixed-size chunks. D1 caps a query at 100 bound
 * parameters, so callers that build `INSERT`/`IN` statements must chunk their
 * work; this helper keeps that logic in one place.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error("chunk size must be greater than zero");
  }
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
