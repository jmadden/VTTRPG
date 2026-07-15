import type { CSSProperties } from 'react';

export const panel: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0a0a0f',
  color: '#e5e7eb',
  fontFamily: 'system-ui, sans-serif',
};

export const card: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: 320,
  padding: 24,
  background: '#14141f',
  border: '1px solid #2a2a3a',
  borderRadius: 12,
};

export const field: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid #3a3a4a',
  background: '#0f0f16',
  color: '#e5e7eb',
  fontSize: 14,
};

export const primaryBtn: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: 'none',
  background: '#4ade80',
  color: '#08130a',
  fontWeight: 600,
  cursor: 'pointer',
};

export const ghostBtn: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #3a3a4a',
  background: '#1a1a24',
  color: '#e5e7eb',
  cursor: 'pointer',
  fontSize: 13,
};

export const linkBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#93c5fd',
  cursor: 'pointer',
  fontSize: 13,
};

export const chip = (active: boolean): CSSProperties => ({
  marginRight: 6,
  padding: '2px 8px',
  borderRadius: 4,
  cursor: 'pointer',
  border: '1px solid #3a3a4a',
  background: active ? '#4ade80' : '#1a1a24',
  color: active ? '#08130a' : '#e5e7eb',
});

// ── GM in-game HUD tokens ────────────────────────────────────────────────
// `primaryBtn`'s green stays reserved for submit/confirm actions (Upload,
// Create, Sign in). `accentGm` is a separate warm amber used ONLY for
// GM-authority state — the active live-map tab and the active fog tool — so
// "do this action" and "this GM control is on" read as two different things
// instead of the same green meaning three unrelated states.
export const accentGm = '#f5b942';

export const space = { xs: 4, sm: 8, md: 12, lg: 16 } as const;

// Shared floating-panel look, reused by the toolbar, the library drawer, and
// the players panel so they read as one system instead of four ad hoc boxes.
export const surface: CSSProperties = {
  background: '#14141f',
  border: '1px solid #2a2a3a',
  borderRadius: 10,
};

// Uppercase micro-label for section headings ("fog tool", "Players").
export const eyebrow: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#9ca3af',
};

// A GM-authority segmented toggle (the fog tool REVEAL/CONCEAL switch).
export const gmToggle = (active: boolean): CSSProperties => ({
  padding: '5px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  border: active ? `1px solid ${accentGm}` : '1px solid #3a3a4a',
  background: active ? 'rgba(245,185,66,0.16)' : '#1a1a24',
  color: active ? accentGm : '#e5e7eb',
  fontSize: 12,
  fontWeight: active ? 600 : 400,
  whiteSpace: 'nowrap',
});

// A live-map tab: underline indicator rather than a filled pill, so tabs read
// as "identity/selection" distinct from the toggle-shaped gmToggle above.
export const tabChip = (active: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 4px 8px',
  cursor: 'pointer',
  border: 'none',
  borderBottom: active ? `2px solid ${accentGm}` : '2px solid transparent',
  background: 'transparent',
  color: active ? accentGm : '#9ca3af',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  whiteSpace: 'nowrap',
});
