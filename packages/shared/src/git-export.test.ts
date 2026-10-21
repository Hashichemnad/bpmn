import { describe, expect, it } from 'vitest';
import {
  frontMatter,
  joinRepoPath,
  pageCommitMessage,
  pageFilePath,
  processCommitMessage,
  processFilePaths,
  slugify,
} from './git-export';

describe('git export helpers', () => {
  it('slugifies titles', () => {
    expect(slugify('Order Handling & Billing')).toBe('order-handling-billing');
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu');
    expect(slugify('معالجة الطلبات')).toBe('');
  });

  it('joins paths safely', () => {
    expect(joinRepoPath('/bpm/', '', 'processes//core', '../x')).toBe('bpm/processes/core/x');
  });

  it('mirrors the process house', () => {
    const paths = processFilePaths('exports', 'CORE', [
      { code: 'C.02', nameEn: 'Order to Cash', nameAr: '' },
      { code: 'C.02.03', nameEn: 'Order Handling', nameAr: '' },
    ]);
    expect(paths.bpmn).toBe(
      'exports/processes/core/C.02-order-to-cash/C.02.03-order-handling/C.02.03.bpmn',
    );
    expect(paths.json).toMatch(/C\.02\.03\.json$/);
    expect(processFilePaths('', 'SUPPORT', [{ code: 'S.1', nameEn: '', nameAr: 'دعم' }]).bpmn).toBe(
      'processes/support/S.1/S.1.bpmn',
    );
  });

  it('mirrors the space and page tree', () => {
    expect(
      pageFilePath(
        '',
        'QM',
        [
          { id: 'aaaaaaaa-1', titleEn: 'Quality Manual', titleAr: '' },
          { id: 'bbbbbbbb-2', titleEn: '', titleAr: 'ضبط الوثائق' },
        ],
        'ar',
      ),
    ).toBe('docs/QM/quality-manual-aaaaaaaa/page-bbbbbbbb/index.ar.md');
  });

  it('writes front-matter and commit messages', () => {
    expect(frontMatter({ id: 'x', version: 3, title: 'A "quoted"\ntitle' })).toBe(
      '---\nid: "x"\nversion: 3\ntitle: "A \\"quoted\\"\\ntitle"\n---\n\n',
    );
    expect(
      processCommitMessage({
        code: 'C.02.03',
        name: 'Order Handling',
        version: 5,
        changeNote: 'Added\napproval',
      }),
    ).toBe('Update C.02.03 Order Handling — v5: Added approval');
    expect(
      pageCommitMessage({ spaceKey: 'QM', title: 'Doc', version: 2, changeNote: 'x'.repeat(300) })
        .length,
    ).toBe(200);
  });
});
