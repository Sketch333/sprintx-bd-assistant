import type { AskMode, DraftInput } from './types';

export type PresentationMode = 'web' | 'side-panel' | 'popout' | 'framed';

export interface PresentationWorkspaceState {
  conversationId?: string;
  question: string;
  mode: 'ask' | 'draft';
  composerExpanded: boolean;
  askMode: AskMode;
  draft: DraftInput;
}

const WORKSPACE_STATE_KEY = 'sprintx:presentation-workspace';

function chromeExtensionAvailable(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id) && window.location.protocol === 'chrome-extension:';
}

export function resolvePresentationMode(href = window.location.href, framed = window.top !== window): PresentationMode {
  if (framed) return 'framed';
  const url = new URL(href, window.location.origin);
  if (url.protocol !== 'chrome-extension:') return 'web';
  return url.searchParams.get('popout') === '1' ? 'popout' : 'side-panel';
}

export function getPresentationMode(): PresentationMode {
  return resolvePresentationMode(window.location.href, window.top !== window);
}

function validDraft(value: unknown): value is DraftInput {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.type === 'string'
    && typeof draft.audience === 'string'
    && typeof draft.objective === 'string'
    && typeof draft.tone === 'string'
    && typeof draft.length === 'string'
    && (draft.context === undefined || typeof draft.context === 'string');
}

function validWorkspaceState(value: unknown): value is PresentationWorkspaceState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return (state.conversationId === undefined || typeof state.conversationId === 'string')
    && typeof state.question === 'string'
    && (state.mode === 'ask' || state.mode === 'draft')
    && typeof state.composerExpanded === 'boolean'
    && (state.askMode === 'knowledge' || state.askMode === 'facts' || state.askMode === 'general')
    && validDraft(state.draft);
}

export async function readPresentationWorkspaceState(): Promise<PresentationWorkspaceState | null> {
  if (!chromeExtensionAvailable() || !chrome.storage?.session) return null;
  const stored = await chrome.storage.session.get(WORKSPACE_STATE_KEY);
  return validWorkspaceState(stored[WORKSPACE_STATE_KEY]) ? stored[WORKSPACE_STATE_KEY] : null;
}

export async function savePresentationWorkspaceState(state: PresentationWorkspaceState): Promise<void> {
  if (!chromeExtensionAvailable() || !chrome.storage?.session || !validWorkspaceState(state)) return;
  await chrome.storage.session.set({ [WORKSPACE_STATE_KEY]: state });
}

export async function popOutPresentation(): Promise<{ detached: boolean }> {
  if (!chromeExtensionAvailable() || getPresentationMode() !== 'side-panel') throw new Error('SprintX can only pop out from its Chrome side panel.');
  const current = await chrome.windows.getCurrent();
  if (!Number.isInteger(current.id)) throw new Error('The current browser window is unavailable.');
  const response = await chrome.runtime.sendMessage({ type: 'sprintx:pop-out', sourceWindowId: current.id }) as { ok?: boolean } | undefined;
  if (response?.ok !== true) throw new Error('SprintX could not open a pop-out window.');

  let detached = false;
  const closePanel = (chrome.sidePanel as typeof chrome.sidePanel & { close?: (options: { windowId: number }) => Promise<void> }).close;
  if (typeof closePanel === 'function') {
    try {
      await closePanel.call(chrome.sidePanel, { windowId: current.id! });
      detached = true;
    } catch {}
  }
  return { detached };
}

export async function attachPresentationToBrowser(): Promise<void> {
  if (!chromeExtensionAvailable() || getPresentationMode() !== 'popout') throw new Error('SprintX is not running in a pop-out window.');
  const sourceWindowId = Number(new URL(window.location.href).searchParams.get('sourceWindowId'));
  if (!Number.isInteger(sourceWindowId) || sourceWindowId < 0) throw new Error('The original browser window is unavailable.');

  await chrome.sidePanel.open({ windowId: sourceWindowId });
  const current = await chrome.windows.getCurrent();
  if (Number.isInteger(current.id) && current.id !== sourceWindowId) await chrome.windows.remove(current.id!);
}
