import { describe, expect, it } from 'vitest';
import { exportFileName } from './export';

describe('exportFileName', () => {
  it('builds a safe file name', () => {
    expect(exportFileName('S.01.01', 'Purchase Requisition', 'bpmn')).toBe('S.01.01_Purchase_Requisition.bpmn');
    expect(exportFileName('C.01', 'a/b:c*?', 'svg')).toBe('C.01_abc.svg');
    expect(exportFileName('', '', 'png')).toBe('process.png');
  });
});
