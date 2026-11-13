import { csvCell, toCsv } from './csv';

describe('csv', () => {
  it('quotes cells with commas, quotes and new lines', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('neutralises spreadsheet formulas', () => {
    for (const value of ['=1+1', '+1', '-1', '@SUM(A1)'])
      expect(csvCell(value).startsWith("'")).toBe(true);
  });

  it('formats dates, objects and empty values', () => {
    expect(csvCell(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['x', 'y'], [[1, null]])).toBe('x,y\r\n1,\r\n');
  });
});
