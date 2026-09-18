import { useEffect, useState } from 'react';
import { publishPresentationAppearance, resolveAppearance, subscribePageAppearance } from '../appearance';
import type { AppearanceSettings as Preferences, PageAppearance } from '../appearance';

const storageKey = 'sprintx.appearance';
function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (value && ['auto', 'light', 'dark'].includes(value.theme) && typeof value.adaptiveAccent === 'boolean') return { theme: value.theme, adaptiveAccent: value.adaptiveAccent };
  } catch { /* Storage may be restricted in an embedded presentation. */ }
  return { theme: 'light', adaptiveAccent: false };
}
export function useAppearance() {
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [page, setPage] = useState<PageAppearance | null>(null);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const [notice, setNotice] = useState('');
  useEffect(() => subscribePageAppearance(setPage), []);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media?.matches ?? false);
    media?.addEventListener('change', change);
    return () => media?.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const appearance = resolveAppearance(preferences, page, systemDark);
    document.documentElement.dataset.theme = appearance.theme;
    document.documentElement.style.setProperty('--adaptive-accent', appearance.accent ?? 'var(--accent)');
    let active = true;
    publishPresentationAppearance(appearance).catch(() => { if (active) setNotice('Theme applied here; floating frame theme is unavailable.'); });
    return () => { active = false; };
  }, [preferences, page, systemDark]);
  function update(value: Preferences) {
    setPreferences(value); setNotice('');
    try { localStorage.setItem(storageKey, JSON.stringify(value)); }
    catch { setNotice('Appearance applies for this session; preferences could not be saved.'); }
  }
  return { preferences, update, notice };
}
export function AppearanceSettings({ appearance }: { appearance: ReturnType<typeof useAppearance> }) {
  return <div className="appearance-settings">
    <h2>Appearance</h2>
    <label htmlFor="theme">Theme</label>
    <select id="theme" value={appearance.preferences.theme} onChange={(event) => appearance.update({ ...appearance.preferences, theme: event.target.value as Preferences['theme'] })}>
      <option value="light">Light (default)</option><option value="dark">Dark</option><option value="auto">System / Auto</option>
    </select>
    <p className="muted">SprintX uses Light by default. Dark and System / Auto are available when you prefer them.</p>\n    <label className="check-label"><input type="checkbox" checked={appearance.preferences.adaptiveAccent} onChange={(event) => appearance.update({ ...appearance.preferences, adaptiveAccent: event.target.checked })} />Adapt to page appearance</label>
    <p className="muted">Page colors affect decorative accents only. Auto can follow the page when adaptation is enabled.</p>
    {appearance.notice && <p role="status" className="muted">{appearance.notice}</p>}
  </div>;
}
