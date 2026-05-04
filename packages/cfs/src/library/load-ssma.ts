import { z } from 'zod'
import { CFSMemberLibrary } from '../schema/cfs-member-library'
import ssmaJson from '../data/ssma.json' with { type: 'json' }

export type SSMAJson = unknown

export function parseLibrary(json: unknown): CFSMemberLibrary {
  return CFSMemberLibrary.parse(json)
}

export function tryParseLibrary(json: unknown):
  | { ok: true; library: CFSMemberLibrary }
  | { ok: false; error: string } {
  const result = CFSMemberLibrary.safeParse(json)
  if (result.success) return { ok: true, library: result.data }
  return { ok: false, error: formatZodError(result.error) }
}

export function formatZodError(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
  }
  if (err instanceof Error) return err.message
  return String(err)
}

export const ssmaLibraryJson: SSMAJson = ssmaJson
