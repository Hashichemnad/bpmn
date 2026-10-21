import { htmlToText, sanitizeRichText } from './rich-text';
import { htmlToMarkdown } from './markdown';

const att = '/api/v1/attachments/0b6f3c1e-9a2d-4c1b-8f3e-2d4a5b6c7d8e/content';

describe('sanitizeRichText', () => {
  it('removes scripts, handlers and dangerous URLs', () => {
    const out = sanitizeRichText(
      '<p onclick="x()">Hi<script>alert(1)</script><a href="javascript:alert(1)">x</a></p><iframe src="//e"></iframe><svg><script>1</script></svg>',
    );
    expect(out).toBe('<p>Hi<a>x</a></p>');
  });

  it('keeps the editor structure', () => {
    const html =
      '<h2 dir="rtl">عنوان</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"></label><div><p>Done</p></div></li></ul>' +
      '<div data-type="callout" data-callout="warning"><p>Careful</p></div><pre><code class="language-ts">x</code></pre>' +
      '<table><tbody><tr><th colspan="2">H</th></tr></tbody></table>';
    const out = sanitizeRichText(html);
    expect(out).toContain('<h2 dir="rtl">');
    expect(out).toContain('data-type="taskItem" data-checked="true"');
    expect(out).toContain('<input type="checkbox" checked="checked" disabled="disabled">');
    expect(out).toContain('data-callout="warning"');
    expect(out).toContain('class="language-ts"');
    expect(out).toContain('colspan="2"');
  });

  it('only keeps images from our attachments and fixes link attributes', () => {
    const out = sanitizeRichText(
      `<p><img src="https://evil/p.gif"><img src="${att}" alt="a"><a href="https://x.org" target="_self">x</a><a href="/docs" target="_blank">y</a></p>`,
    );
    expect(out).not.toContain('evil');
    expect(out).toContain(`<img src="${att}" alt="a">`);
    expect(out).toContain(
      '<a href="https://x.org" target="_blank" rel="noopener noreferrer nofollow">',
    );
    expect(out).toContain('<a href="/docs">y</a>');
  });

  it('drops unknown data attributes, classes and directions', () => {
    const out = sanitizeRichText(
      '<p class="evil" data-x="1" dir="sideways" style="color:red">t</p><div data-type="bpmn-diagram" data-process-id="abc" data-callout="nope"></div><input type="text">',
    );
    expect(out).toBe(
      '<p>t</p><div data-type="bpmn-diagram" data-process-id="abc" data-callout="info"></div>',
    );
  });
});

describe('htmlToText', () => {
  it('extracts one line per block and decodes entities', () => {
    expect(htmlToText('<h1>Title</h1><p>A &amp; B</p><ul><li>one</li><li>two</li></ul>')).toBe(
      'Title\nA & B\none\ntwo',
    );
  });
});

describe('htmlToMarkdown', () => {
  it('converts headings, lists, tables, task lists, callouts and diagrams', () => {
    const md = htmlToMarkdown(
      '<h2>Scope</h2><p><strong>Bold</strong> and <u>under</u></p><ul><li><p>a</p></li></ul>' +
        '<table><tbody><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></tbody></table>' +
        '<div data-type="callout" data-callout="warning"><p>Careful</p></div>' +
        '<div data-type="bpmn-diagram" data-process-id="p1"></div>',
      { diagram: (id) => (id === 'p1' ? { label: 'C.01 Sales', href: '../C.01.bpmn' } : null) },
    );
    expect(md).toContain('## Scope');
    expect(md).toContain('**Bold** and <u>under</u>');
    expect(md).toContain('| H1  | H2  |');
    expect(md).toContain('> [!WARNING]\n> Careful');
    expect(md).toContain('[BPMN: C.01 Sales](../C.01.bpmn)');
  });
});
