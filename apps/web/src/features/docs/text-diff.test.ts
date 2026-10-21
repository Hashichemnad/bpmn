import { describe, expect, it } from 'vitest';
import { diffBlocks, diffStats, diffWords, htmlToBlocks } from './text-diff';

describe('htmlToBlocks', () => {
  it('flattens headings, lists, tasks, tables and embeds', () => {
    const blocks = htmlToBlocks(
      '<h2>Scope</h2><p>Text  here</p><ul><li><p>one</p></li></ul>' +
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox"></label><div><p>done</p></div></li></ul>' +
        '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr></tbody></table>' +
        '<div data-type="callout"><p>Note</p></div><div data-type="bpmn-diagram" data-process-id="p1"></div><p></p>',
    );
    expect(blocks).toEqual([
      { kind: 'h2', text: 'Scope' },
      { kind: 'p', text: 'Text here' },
      { kind: 'li', text: 'one' },
      { kind: 'task', text: 'done', checked: true },
      { kind: 'row', text: 'A | B' },
      { kind: 'quote', text: 'Note' },
      { kind: 'special', text: '[BPMN: p1]' },
    ]);
  });
});

describe('diffBlocks', () => {
  it('pairs changed blocks and keeps additions/removals', () => {
    const a = htmlToBlocks('<h2>Scope</h2><p>The manager reviews the request.</p><p>Old step</p>');
    const b = htmlToBlocks(
      '<h2>Scope</h2><p>The manager approves the request.</p><p>New one</p><p>Extra</p>',
    );
    const rows = diffBlocks(a, b);
    expect(rows.map((r) => r.type)).toEqual(['equal', 'changed', 'changed', 'added']);
    expect(rows[1].leftParts?.filter((p) => p.removed).map((p) => p.value)).toEqual(['reviews']);
    expect(rows[1].rightParts?.filter((p) => p.added).map((p) => p.value)).toEqual(['approves']);
    expect(diffStats(rows)).toEqual({ added: 1, removed: 0, changed: 2 });
  });

  it('diffs Arabic by words, not characters', () => {
    const { left, right } = diffWords('يراجع المدير الطلب', 'يعتمد المدير الطلب');
    expect(left.filter((p) => p.removed).map((p) => p.value)).toEqual(['يراجع']);
    expect(right.filter((p) => p.added).map((p) => p.value)).toEqual(['يعتمد']);
  });

  it('reports a removed block', () => {
    const rows = diffBlocks(htmlToBlocks('<p>a</p><p>b</p>'), htmlToBlocks('<p>a</p>'));
    expect(rows.map((r) => r.type)).toEqual(['equal', 'removed']);
  });
});
