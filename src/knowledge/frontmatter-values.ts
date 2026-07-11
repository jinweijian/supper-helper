export function requiredString(value: unknown, field: string, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path}: frontmatter field ${field} must be a non-empty string`);
  return value.trim();
}

export function requiredStringArray(value: unknown, field: string, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path}: frontmatter field ${field} must be an array`);
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export function enumValue<T extends string>(value: unknown, allowed: Set<T>, field: string, path: string): T {
  const candidate = requiredString(value, field, path) as T;
  if (!allowed.has(candidate)) throw new Error(`${path}: frontmatter field ${field} has unsupported value ${candidate}`);
  return candidate;
}

export const optionalString = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;

export function optionalStringArray(value: unknown, field: string, path: string): string[] | undefined {
  return value === undefined ? undefined : requiredStringArray(value, field, path);
}

export function optionalNumberArray(value: unknown, field: string, path: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${path}: frontmatter field ${field} must be an array`);
  return value.map((item) => {
    const number = Number(item);
    if (!Number.isFinite(number)) throw new Error(`${path}: frontmatter field ${field} must contain numbers`);
    return number;
  });
}

export function optionalNumber(value: unknown, field: string, path: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${path}: frontmatter field ${field} must be a number`);
  return number;
}

export function optionalEnum<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
  if (value === undefined) return undefined;
  const candidate = String(value).trim() as T;
  return allowed.has(candidate) ? candidate : undefined;
}
