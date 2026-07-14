import { describe, expect, it } from 'vitest';
import { csvCell } from '../src/services/reports.js';

describe('Security-sensitive export primitives', () => {
  it('neutralizes spreadsheet formula prefixes in CSV cells', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('=HYPERLINK("https://attacker.test")')).toContain("'=HYPERLINK");
  });

  it('keeps standard CSV quoting for separators and quotes', () => {
    expect(csvCell('site, Bruxelles')).toBe('"site, Bruxelles"');
    expect(csvCell('a "quoted" value')).toBe('"a ""quoted"" value"');
  });
});
