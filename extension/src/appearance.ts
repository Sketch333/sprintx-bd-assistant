export type AppearancePreference = 'auto' | 'light' | 'dark';
export interface AppearanceSettings { theme: AppearancePreference; adaptiveAccent: boolean }
export interface PageAppearance { theme: 'light' | 'dark'; accent: string | null }
export function validatePageAppearance(value: unknown): PageAppearance | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !('theme' in record) || !('accent' in record)) return null;
  if (record.theme !== 'light' && record.theme !== 'dark') return null;
  if (record.accent !== null && (typeof record.accent !== 'string' || !/^#[\da-f]{6}$/i.test(record.accent))) return null;
  return { theme: record.theme, accent: record.accent as string | null };
}
export function resolveAppearance(settings: AppearanceSettings, page?: PageAppearance | null, systemDark = false): PageAppearance {
  const valid = validatePageAppearance(page);
  return { theme: settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : settings.adaptiveAccent && valid ? valid.theme : systemDark ? 'dark' : 'light', accent: settings.adaptiveAccent ? valid?.accent ?? null : null };
}
let pageAppearance: PageAppearance | null = null;
const subscribers = new Set<(appearance: PageAppearance | null) => void>();
export function subscribePageAppearance(listener: (appearance: PageAppearance | null) => void): () => void {
  subscribers.add(listener); listener(pageAppearance); return () => { subscribers.delete(listener); };
}
export function isFramedPresentation(): boolean { return window.top !== window; }
/** Relay resolved colors to the isolated outer shell; preference persistence belongs to UI. */
export async function publishPresentationAppearance(appearance: PageAppearance): Promise<void> {
  const valid = validatePageAppearance(appearance);
  if (!valid) throw new Error('Invalid presentation appearance.');
  if (!isFramedPresentation()) return;
  const response = await chrome.runtime.sendMessage({ type: 'sprintx:apply-appearance', ...valid });
  if (response?.ok !== true) throw new Error('Floating appearance is unavailable.');
}
export async function requestTrustedWindow(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'sprintx:trusted-window' });
  if (response?.ok !== true) throw new Error('Open SprintX using the extension toolbar or its sidebar menu.');
}
export async function authorizePresentation(context = { framed: isFramedPresentation(), href: window.location.href, send: (value: unknown): Promise<unknown> => chrome.runtime.sendMessage(value) }): Promise<boolean> {
  // Top-level extension sidebar/window and local development previews remain trusted.
  if (!context.framed) return true;
  try {
    const nonce = new URL(context.href).searchParams.get('overlay');
    if (!nonce || nonce.length > 100) return false;
    const response = await context.send({ type: 'sprintx:authorize', nonce }) as { authorized?: boolean; appearance?: unknown } | null;
    if (response?.authorized !== true) return false;
    pageAppearance = validatePageAppearance(response.appearance);
    for (const listener of subscribers) listener(pageAppearance);
    return true;
  } catch { return false; }
}
