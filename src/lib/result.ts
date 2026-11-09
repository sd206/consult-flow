export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail(error: string): Result<never> {
  return { ok: false, error }
}
