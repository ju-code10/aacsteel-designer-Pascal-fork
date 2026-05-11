import { describe, expect, it } from 'bun:test'
import {
  kgToLb,
  lengthForUnits,
  mmToFeetInchSixteenths,
  mmToInches4dp,
  mmToIntegerMm,
  round2,
  round4,
  unitsSuffix,
} from '../length-format'

describe('length-format', () => {
  it('rounds mm to integer', () => {
    expect(mmToIntegerMm(2743.49)).toBe(2743)
    expect(mmToIntegerMm(2743.5)).toBe(2744)
    expect(mmToIntegerMm(0)).toBe(0)
  })

  it('converts mm to 4-dp inches', () => {
    expect(mmToInches4dp(2743.2)).toBe(108.0)
    expect(mmToInches4dp(25.4)).toBe(1.0)
    expect(mmToInches4dp(38.1)).toBe(1.5)
  })

  it('formats feet-inches-sixteenths', () => {
    // 9'-0 = 2743.2 mm; 9'-0 1/16" = 2743.2 + 1.5875 ≈ 2744.79 mm
    expect(mmToFeetInchSixteenths(2743.2)).toBe(`9'-0"`)
    expect(mmToFeetInchSixteenths(2744.79)).toBe(`9'-0 1/16"`)
    expect(mmToFeetInchSixteenths(2746.375)).toBe(`9'-0 1/8"`) // 2 sixteenths → 1/8
    expect(mmToFeetInchSixteenths(2749.55)).toBe(`9'-0 1/4"`) // 4 sixteenths → 1/4
    expect(mmToFeetInchSixteenths(0)).toBe(`0'-0"`)
  })

  it('rolls 16/16 into the next inch', () => {
    // Just below 9'-1": 2768.6 mm = 9'-1" exactly
    expect(mmToFeetInchSixteenths(2768.6)).toBe(`9'-1"`)
  })

  it('round helpers respect their decimal places', () => {
    expect(round2(1.234567)).toBe(1.23)
    expect(round2(1.235)).toBe(1.24)
    expect(round4(1.23456789)).toBe(1.2346)
  })

  it('converts kg to lb', () => {
    expect(round2(kgToLb(1))).toBe(2.2)
    expect(round2(kgToLb(45.359237))).toBe(100)
  })

  it('dispatches lengthForUnits and unitsSuffix on units', () => {
    expect(lengthForUnits(2743.2, 'metric')).toBe(2743)
    expect(lengthForUnits(2743.2, 'imperial')).toBe(108.0)
    expect(unitsSuffix('metric')).toBe('mm')
    expect(unitsSuffix('imperial')).toBe('in')
  })
})
