'use client'

import type { CFSComplianceVerdict } from '@pascal-app/cfs'
import {
  COMPLIANCE_BADGE_COMPLIANT,
  COMPLIANCE_BADGE_NON_COMPLIANT,
  COMPLIANCE_BADGE_UNCHECKED,
} from '../../lib/strings'

/**
 * §7.7.4 — per-hole compliance signal. Carries both color and a non-color
 * character so the §7.9.3 "color is never the only signal" rule holds even
 * for color-blind users or grayscale printouts.
 *
 *   compliant     ✓ green
 *   non-compliant ✗ red
 *   unchecked     ? gray (one-frame transient)
 */

const STATUS_TO_CHAR: Record<CFSComplianceVerdict['status'], string> = {
  compliant: '✓',
  'non-compliant': '✗',
  unchecked: '?',
}

const STATUS_TO_LABEL: Record<CFSComplianceVerdict['status'], string> = {
  compliant: COMPLIANCE_BADGE_COMPLIANT,
  'non-compliant': COMPLIANCE_BADGE_NON_COMPLIANT,
  unchecked: COMPLIANCE_BADGE_UNCHECKED,
}

const STATUS_TO_CLASSES: Record<CFSComplianceVerdict['status'], string> = {
  compliant: 'text-green-400 border-green-500/40 bg-green-500/10',
  'non-compliant': 'text-red-400 border-red-500/40 bg-red-500/10',
  unchecked: 'text-muted-foreground border-border bg-background/40',
}

export interface ComplianceBadgeProps {
  verdict: CFSComplianceVerdict
  /** Compact form: only the character (used in MemberBody hole list, §7.7.4). */
  compact?: boolean
}

export function ComplianceBadge({
  verdict,
  compact,
}: ComplianceBadgeProps): React.JSX.Element {
  const char = STATUS_TO_CHAR[verdict.status]
  const label = STATUS_TO_LABEL[verdict.status]
  const classes = STATUS_TO_CLASSES[verdict.status]

  if (compact) {
    return (
      <span
        aria-label={label}
        className={`inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold ${classes}`}
      >
        {char}
      </span>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 rounded border px-2 py-1 ${classes}`}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 items-center justify-center font-bold"
      >
        {char}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
    </div>
  )
}
