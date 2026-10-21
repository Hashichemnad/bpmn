import type { PublicSettingsDto } from '@processhub/shared';

/** Organisation logo (if uploaded) or the default ProcessHub mark. */
export function BrandMark({ settings, size = 32 }: { settings?: PublicSettingsDto; size?: number }) {
  if (settings?.hasLogo) {
    return (
      <img
        src={`/api/v1/settings/logo?v=${settings.logoVersion ?? ''}`}
        alt=""
        width={size}
        height={size}
        style={{ objectFit: 'contain', borderRadius: 6, background: '#fff' }}
      />
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#1d4ed8" />
      <path
        d="M8 10h7v5H8zM17 17h7v5h-7zM11.5 15v4.5H17"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
