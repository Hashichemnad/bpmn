import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Highlight } from './Highlight';

describe('Highlight', () => {
  it('marks highlighted words and escapes the rest', () => {
    const { container } = render(<Highlight text={'a hit <b>x</b> two'} />);
    expect(container.querySelectorAll('mark')).toHaveLength(2);
    expect(container.querySelector('mark')?.textContent).toBe('hit');
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toBe('a hit <b>x</b> two');
  });
});
