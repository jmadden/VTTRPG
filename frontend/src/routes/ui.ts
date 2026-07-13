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
