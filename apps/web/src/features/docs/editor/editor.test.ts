import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { wikiExtensions } from './extensions';

const ID = '0b6f3c1e-9a2d-4c1b-8f3e-2d4a5b6c7d8e';
const ATT = `/api/v1/attachments/${ID}/content`;
let editor: Editor | null = null;

// Node views need React; the schema and commands are what these tests cover.
/** HTML without the empty paragraph StarterKit's trailing-node keeps at the end. */
const html = (e: Editor) => e.getHTML().replace(/<p><\/p>$/, '');

const make = (content: string) => {
  editor = new Editor({ extensions: wikiExtensions({ nodeViews: false }), content });
  return editor;
};

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('wiki editor schema', () => {
  it('round-trips callouts, task lists, tables, diagrams and directions', () => {
    const html =
      '<div data-type="callout" data-callout="warning"><p dir="rtl">نص</p></div>' +
      '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done</p></div></li></ul>' +
      `<div data-type="bpmn-diagram" data-process-id="${ID}"></div>` +
      `<img src="${ATT}" alt="chart">`;
    const out = make(html).getHTML();
    expect(out).toContain('data-callout="warning"');
    expect(out).toContain('<p dir="rtl">نص</p>');
    expect(out).toContain('data-type="taskItem"');
    expect(out).toContain(`data-process-id="${ID}"`);
    expect(out).toContain(`src="${ATT}"`);
  });

  it('sets the direction of the paragraph only, not of its container', () => {
    const e = make('<div data-type="callout" data-callout="info"><p>a</p></div>');
    e.commands.setTextSelection(3);
    e.commands.setBlockDirection('rtl');
    expect(html(e)).toBe('<div data-type="callout" data-callout="info"><p dir="rtl">a</p></div>');
    e.commands.setBlockDirection(null);
    expect(html(e)).toBe('<div data-type="callout" data-callout="info"><p>a</p></div>');
  });

  it('keeps an inserted diagram when inserting the next one', () => {
    const e = make('<p>x</p>');
    e.commands.setTextSelection(2);
    e.commands.insertBpmnDiagram(ID);
    e.commands.insertBpmnDiagram('11111111-1111-4111-8111-111111111111');
    const html = e.getHTML();
    expect(html.match(/data-type="bpmn-diagram"/g)).toHaveLength(2);
  });

  it('switches callout types and removes the panel', () => {
    const e = make('<p>a</p>');
    e.commands.setTextSelection(1);
    e.commands.setCallout('danger');
    expect(html(e)).toBe('<div data-type="callout" data-callout="danger"><p>a</p></div>');
    e.commands.setCallout('success');
    expect(html(e)).toContain('data-callout="success"');
    e.commands.unsetCallout();
    expect(html(e)).toBe('<p>a</p>');
  });
});
