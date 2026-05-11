import { describe, expect, it } from 'bun:test'
import { writeCSV, writeCSVWithBOM } from '../csv'

describe('writeCSV', () => {
  it('emits CRLF line endings including a trailing terminator', () => {
    const out = writeCSV([['a', 'b'], ['c', 'd']])
    expect(out).toBe('a,b\r\nc,d\r\n')
  })

  it('renders numbers without quotes', () => {
    expect(writeCSV([[1, 2.5, 3]])).toBe('1,2.5,3\r\n')
  })

  it('quotes fields with commas', () => {
    expect(writeCSV([['hello, world']])).toBe('"hello, world"\r\n')
  })

  it('quotes fields with embedded double quotes and doubles them', () => {
    expect(writeCSV([['say "hi"']])).toBe('"say ""hi"""\r\n')
  })

  it('quotes fields with line breaks', () => {
    expect(writeCSV([['line1\nline2']])).toBe('"line1\nline2"\r\n')
    expect(writeCSV([['line1\r\nline2']])).toBe('"line1\r\nline2"\r\n')
  })

  it('handles empty rows and empty cells', () => {
    expect(writeCSV([['', '']])).toBe(',\r\n')
    expect(writeCSV([[]])).toBe('\r\n')
  })

  it('prepends a UTF-8 BOM in writeCSVWithBOM', () => {
    const out = writeCSVWithBOM([['é']])
    expect(out.charCodeAt(0)).toBe(0xfeff)
    expect(out.slice(1)).toBe('é\r\n')
  })
})
