import { startFormErrorAnnouncer } from './formErrorAnnouncer';

describe('startFormErrorAnnouncer', () => {
  it('reads newly shown form errors into one live region', async () => {
    vi.useFakeTimers();
    const stop = startFormErrorAnnouncer();
    const region = document.querySelector('[data-testid="form-error-announcer"]')!;
    expect(region.getAttribute('aria-live')).toBe('assertive');
    const form = document.createElement('div');
    form.innerHTML =
      '<div class="ant-form-item-explain-error">Name is required</div>' +
      '<div class="ant-form-item-explain-error">Owner is required</div>';
    document.body.appendChild(form);
    await vi.advanceTimersByTimeAsync(300);
    expect(region.textContent).toBe('Name is required. Owner is required');
    stop();
    expect(document.querySelector('[data-testid="form-error-announcer"]')).toBeNull();
    vi.useRealTimers();
  });
});
