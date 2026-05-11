import { describe, expect, it } from 'bun:test'
import { slugify } from '../slugify'

describe('slugify', () => {
  it('lowercases and collapses non-alphanumeric runs to a single dash', () => {
    expect(slugify('Riverside Warehouse')).toBe('riverside-warehouse')
    expect(slugify('Job #42 — Final')).toBe('job-42-final')
  })

  it('strips leading and trailing dashes', () => {
    expect(slugify('—— hi ——')).toBe('hi')
  })

  it('caps the output at 60 characters', () => {
    const long = 'a'.repeat(100)
    expect(slugify(long)).toHaveLength(60)
  })

  it('falls back to "project" for empty or all-special input', () => {
    expect(slugify('')).toBe('project')
    expect(slugify('   ')).toBe('project')
    expect(slugify('!!!@@@###')).toBe('project')
  })

  it('preserves digits', () => {
    expect(slugify('Project 2026 v1.0')).toBe('project-2026-v1-0')
  })
})
