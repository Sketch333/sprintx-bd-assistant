import { FormEvent, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ApiError, askAssistant, crawlWebsites, createConversation, createUser, deleteConversation, draftMessage, getConversationMessages, getProfile, listConversations, listUsers, removeGeminiKey, renameConversation, setGeminiKey, syncCaseStudyFacts, syncGoogleDrive } from './api';
import { authorizePresentation, isFramedPresentation, requestTrustedWindow } from './appearance';
import { continueDriveSync } from './drive-sync';
import { AnswerContent } from './components/AnswerContent';
import { Sources } from './components/Sources';
import { AppearanceSettings, useAppearance } from './components/AppearanceSettings';
import { BrandMark } from './components/BrandMark';
import { Icon } from './components/Icon';
import type { AskMode, Conversation, ConversationMessage, DraftInput, ProvisionedUser } from './types';

const GENERIC_CONVERSATION_TITLES = new Set(['New conversation', 'SprintX workspace']);

function conversationTitleFrom(seed: string): string {
  const normalized = seed.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 56) return normalized || 'New conversation';
  const clipped = normalized.slice(0, 53).trimEnd();
  return `${clipped}…`;
}

export function App() {
  const [auth, setAuth] = useState<typeof import('./supabase') | null>(null);
  const [denied, setDenied] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    authorizePresentation().then(async (authorized) => {
      if (!active) return;
      if (!authorized) { setDenied(true); return; }
      // Never initialize storage/session refresh from an unauthorized external embed.
      try { const module = await import('./supabase'); if (active) setAuth(module); }
      catch { if (active) setUnavailable(true); }
    });
    return () => { active = false; };
  }, []);
  if (denied) return <main className="shell centered">Open SprintX from the extension toolbar.</main>;
  if (unavailable) return <TrustedWindowFallback />;
  if (!auth) return <main className="shell centered">Opening SprintX...</main>;
  return <AccountApp auth={auth} />;
}

function TrustedWindowFallback() {
  const [error, setError] = useState('');
  return <main className="shell centered"><p>This frame cannot access SprintX sign-in or storage.</p><button type="button" className="primary-button" onClick={() => requestTrustedWindow().catch(() => setError('Use the extension toolbar menu to open the SprintX sidebar.'))}>Open trusted SprintX window</button>{error && <p role="alert">{error}</p>}</main>;
}

function AccountApp({ auth }: { auth: typeof import('./supabase') }) {
  const { supabase } = auth;
  const [unavailable, setUnavailable] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    let authChanged = false;
    supabase.auth.getSession().then(({ data, error }) => { if (error) throw error; if (active && !authChanged) { setSession(data.session); setReady(true); } }).catch(() => { if (active) setUnavailable(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { authChanged = true; if (active) { setSession(next); setReady(true); } });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  if (unavailable) return <TrustedWindowFallback />;
  if (!ready) return <main className="shell centered">Loading SprintX Assistant...</main>;
  // Remount every account-scoped state on sign-out or identity change. Old async
  // callbacks can only update the discarded workspace, never the next account.
  return <SessionWorkspace key={session?.user.id ?? 'signed-out'} currentSession={session} auth={auth} />;
}

function SessionWorkspace({ currentSession, auth }: { currentSession: Session | null; auth: typeof import('./supabase') }) {
  const appearance = useAppearance();
  const { supabase, signInWithGoogle } = auth;
  const session = currentSession;
  const mounted = useRef(true);
  const driveSyncAbort = useRef<AbortController | null>(null);
  useEffect(() => () => { driveSyncAbort.current?.abort(); }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<'ask' | 'draft'>('ask');
  const [composerExpanded, setComposerExpanded] = useState(true);
  const [pendingComposerFocus, setPendingComposerFocus] = useState<'question' | 'audience' | 'context' | null>(null);
  const [askMode, setAskMode] = useState<AskMode>('knowledge');
  const [draft, setDraft] = useState<DraftInput>({
    type: 'cold-email',
    audience: '',
    objective: '',
    tone: 'professional',
    length: 'medium',
    context: '',
  });
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const [conversationTitle, setConversationTitle] = useState('New conversation');
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [secondaryView, setSecondaryView] = useState<'history' | 'settings' | 'admin' | null>(null);
  const historyOpen = secondaryView === 'history';
  const settingsOpen = secondaryView === 'settings';
  const adminOpen = secondaryView === 'admin';
  const setHistoryOpen = (open: boolean) => setSecondaryView(open ? 'history' : null);
  const setSettingsOpen = (open: boolean) => setSecondaryView(open ? 'settings' : null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [pendingDeleteConversationId, setPendingDeleteConversationId] = useState<string>();
  const [geminiKey, setGeminiKeyValue] = useState('');
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [role, setRole] = useState<'admin' | 'intern'>();
  const [users, setUsers] = useState<ProvisionedUser[]>([]);
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'intern' as 'admin' | 'intern' });
  const [adminBusy, setAdminBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [feedback, setFeedback] = useState('');
  const latestAssistantId = [...conversationMessages].reverse().find((message) => message.role === 'assistant')?.id;
  const composerBusy = asking || drafting || historyBusy;
  const secondaryBusy = adminBusy || savingKey || historyBusy;
  useEffect(() => {
    if (!composerExpanded || !pendingComposerFocus) return;
    const target = document.getElementById(pendingComposerFocus);
    if (!target) return;
    target.focus();
    setPendingComposerFocus(null);
  }, [composerExpanded, mode, pendingComposerFocus]);
  useEffect(() => { if (!settingsOpen) setGeminiKeyValue(''); }, [settingsOpen]);
  function toggleSecondary(view: 'history' | 'settings' | 'admin') {
    if (secondaryBusy) return;
    setSecondaryView((current) => current === view ? null : view);
  }

  useEffect(() => {
    if (!session?.access_token) {
      setConversationId(undefined);
      return;
    }
    let active = true;
    listConversations(session.access_token)
      .then(async ({ conversations }) => {
        if (!active) return;
        setConversations(conversations);
        const latest = conversations[0] ?? (await createConversation(session.access_token, 'SprintX workspace')).conversation;
        if (!active) return;
        const { messages } = await getConversationMessages(session.access_token, latest.id);
        if (active) {
          setConversationId(latest.id);
          setConversationTitle(latest.title);
          setConversationMessages(messages);
          if (!conversations.length) setConversations([latest]);
        }
      })
      .catch((conversationError) => {
        if (active) setError(conversationError instanceof Error ? conversationError.message : 'Conversation history is unavailable.');
      });
    return () => {
      active = false;
    };
  }, [session?.user.id]);

  function maybeAutoTitleConversation(seed: string) {
    if (!session?.access_token || !conversationId || !GENERIC_CONVERSATION_TITLES.has(conversationTitle)) return;
    const id = conversationId;
    const title = conversationTitleFrom(seed);
    if (!title || GENERIC_CONVERSATION_TITLES.has(title)) return;

    const optimisticUpdatedAt = new Date().toISOString();
    setConversationTitle(title);
    setConversations((current) => current.map((item) => item.id === id ? { ...item, title, updatedAt: optimisticUpdatedAt } : item));

    void renameConversation(session.access_token, id, title)
      .then(({ conversation }) => {
        if (!mounted.current) return;
        setConversations((current) => current.map((item) => item.id === conversation.id ? conversation : item));
        setConversationTitle((current) => current === title ? conversation.title : current);
      })
      .catch(() => {
        if (mounted.current) setFeedback('Message saved, but the conversation title could not be updated.');
      });
  }

  async function handleNewConversation() {
    if (!session?.access_token) return;
    setHistoryBusy(true);
    setError('');
    try {
      const created = await createConversation(session.access_token, 'New conversation');
      setConversationId(created.conversation.id);
      setConversationTitle(created.conversation.title);
      setConversations((current) => [created.conversation, ...current]);
      setConversationMessages([]);
      setHistoryOpen(false);
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : 'Could not create a conversation.');
    } finally {
      setHistoryBusy(false);
    }
  }

  async function handleSelectConversation(conversation: Conversation) {
    if (!session?.access_token) return;
    setHistoryBusy(true);
    setError('');
    try {
      const { messages } = await getConversationMessages(session.access_token, conversation.id);
      setConversationId(conversation.id);
      setConversationTitle(conversation.title);
      setConversationMessages(messages);
      setHistoryOpen(false);
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : 'Could not load conversation history.');
    } finally {
      setHistoryBusy(false);
    }

  }

  async function handleRenameConversation(conversation: Conversation) {
    if (!session?.access_token) return;
    const title = window.prompt('Conversation name', conversation.title)?.trim();
    if (!title || title === conversation.title) return;
    setHistoryBusy(true);
    setError('');
    try {
      const updated = (await renameConversation(session.access_token, conversation.id, title)).conversation;
      setConversations((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (conversation.id === conversationId) setConversationTitle(updated.title);
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : 'Could not rename conversation.');
    } finally {
      setHistoryBusy(false);
    }
  }

  async function handleDeleteConversation(conversation: Conversation) {
    if (!session?.access_token || historyBusy) return;
    const previousConversations = conversations;
    const remaining = conversations.filter((item) => item.id !== conversation.id);

    setPendingDeleteConversationId(undefined);
    setHistoryBusy(true);
    setError('');
    setConversations(remaining);

    try {
      await deleteConversation(session.access_token, conversation.id);

      if (conversation.id === conversationId) {
        const replacement = remaining[0];
        if (replacement) {
          const { messages } = await getConversationMessages(session.access_token, replacement.id);
          setConversationId(replacement.id);
          setConversationTitle(replacement.title);
          setConversationMessages(messages);
        } else {
          const created = await createConversation(session.access_token, 'New conversation');
          setConversationId(created.conversation.id);
          setConversationTitle(created.conversation.title);
          setConversationMessages([]);
          setConversations([created.conversation]);
        }
        setHistoryOpen(false);
      }
    } catch (conversationError) {
      setConversations(previousConversations);
      setError(conversationError instanceof Error ? conversationError.message : 'Could not delete conversation.');
    } finally {
      setHistoryBusy(false);
    }
  }

  useEffect(() => {
    if (!session?.access_token) return;
    getProfile(session.access_token)
      .then((profile) => {
        setKeyConfigured(profile.geminiKeyConfigured);
        setRole(profile.user.role);
      })
      .catch(() => undefined);
  }, [session?.user.id]);

  async function handleSignIn() {
    setError('');
    setAuthenticating(true);
    try {
      // Framed sign-in always moves to an extension-owned window, even when identity
      // APIs happen to exist in the frame. A page never hosts the OAuth action.
      if (isFramedPresentation()) await requestTrustedWindow();
      else await signInWithGoogle();
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Google sign-in failed.');
    } finally {
      setAuthenticating(false);
    }
  }

  async function handleSignOut() {
    driveSyncAbort.current?.abort();
    setError('');
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
    setSettingsOpen(false);
  }

  async function handleSaveKey(event: FormEvent) {
    event.preventDefault();
    if (!session?.access_token || !geminiKey.trim()) return;
    setSavingKey(true);
    setError('');
    try {
      await setGeminiKey(session.access_token, geminiKey.trim());
      setGeminiKeyValue('');
      setKeyConfigured(true);
    } catch (keyError) {
      setError(keyError instanceof Error ? keyError.message : 'Could not save the Gemini key.');
    } finally {
      setSavingKey(false);
    }
  }

  async function handleRemoveKey() {
    if (!session?.access_token) return;
    setSavingKey(true);
    setError('');
    try {
      await removeGeminiKey(session.access_token);
      setKeyConfigured(false);
    } catch (keyError) {
      setError(keyError instanceof Error ? keyError.message : 'Could not remove the Gemini key.');
    } finally {
      setSavingKey(false);
    }

  }

  async function openAdmin() {
    if (!session?.access_token) return;
    if (secondaryBusy) return;
    toggleSecondary('admin');
    if (adminOpen) return;
    setAdminBusy(true);
    setError('');
    try {
      setUsers((await listUsers(session.access_token)).users);
    } catch (adminError) {
      setError(adminError instanceof Error ? adminError.message : 'Admin controls are unavailable.');
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleCreateUser(event: FormEvent) {
    event.preventDefault();
    if (!session?.access_token || !newUser.email.trim() || !newUser.name.trim()) return;
    setAdminBusy(true);
    setError('');
    try {
      const created = await createUser(session.access_token, { ...newUser, email: newUser.email.trim(), name: newUser.name.trim() });
      setUsers((current) => [...current, created.user]);
      setNewUser({ email: '', name: '', role: 'intern' });
    } catch (adminError) {
      setError(adminError instanceof Error ? adminError.message : 'Could not provision user.');
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleDriveSync() {
    if (!session?.access_token) return;
    if (driveSyncAbort.current) return;
    const controller = new AbortController();
    driveSyncAbort.current = controller;
    setAdminBusy(true);
    setSyncMessage('');
    setError('');
    try {
      const response = await continueDriveSync(async () => {
        const { data } = await supabase.auth.getSession();
        if (!data.session || data.session.user.id !== session.user.id) throw new Error('Sign in again to continue Drive sync. Saved progress is preserved.');
        return (await syncGoogleDrive(data.session.access_token, controller.signal)).result;
      }, (batch, batchNumber) => {
        if (mounted.current) setSyncMessage(`Google Drive sync ${batch.complete ? 'finishing' : 'in progress'}: batch ${batchNumber}, ${batch.newEmbeddings} new embeddings, ${batch.skippedFiles} unchanged files reused.`);
      }, controller.signal);
      const { discovered, sources, removed, failedFiles, skippedFiles } = response;
      if (!mounted.current) return;
      setSyncMessage(
        failedFiles.length > 0
          ? `Google Drive scan finished with ${failedFiles.length} failed file(s): ${failedFiles.join(', ')}. Deletion cleanup was not performed. Saved progress is preserved.`
          : `Google Drive sync complete: discovered ${discovered} file(s), ${skippedFiles} unchanged files reused, ${sources} total sources, removed ${removed} stale source(s).`,
      );
    } catch (syncError) {
      if (mounted.current) {
        setSyncMessage('Drive sync interrupted. Saved embeddings are preserved; restart sync to resume.');
        setError(syncError instanceof Error ? syncError.message : 'Google Drive sync failed.');
      }
    } finally {
      driveSyncAbort.current = null;
      if (mounted.current) setAdminBusy(false);
    }
  }

  async function handleWebsiteCrawl() {
    if (!session?.access_token) return;
    setAdminBusy(true);
    setSyncMessage('');
    setError('');
    try {
      const response = await crawlWebsites(session.access_token);
      setSyncMessage(`Website crawl complete: ${JSON.stringify(response.result)}`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Website crawl failed.');
    } finally {
      setAdminBusy(false);
    }

  }

  async function handleFactsSync() {
    if (!session?.access_token || adminBusy) return;
    setAdminBusy(true);
    setSyncMessage('Refreshing structured case-study facts…');
    setError('');
    try {
      const result = await syncCaseStudyFacts(session.access_token);
      setSyncMessage(`Facts refresh complete: ${result.result.refreshed} refreshed, ${result.result.unchanged} unchanged, ${result.result.failed} failed.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Case-study facts refresh failed.');
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleAsk(event: FormEvent) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !session?.access_token || historyBusy || asking || drafting || !conversationId) return;
    setError('');
    setAsking(true);
    try {
      const response = await askAssistant(trimmedQuestion, session.access_token, conversationId, undefined, askMode);
      setQuestion('');
      setConversationMessages((current) => [...current,
        { id: `local-user-${Date.now()}`, conversationId: conversationId ?? response.conversationId ?? '', role: 'user', content: trimmedQuestion, citations: [], createdAt: new Date().toISOString() },
        { id: `local-assistant-${Date.now()}`, conversationId: conversationId ?? response.conversationId ?? '', role: 'assistant', content: response.answer, citations: response.sources, createdAt: new Date().toISOString() },
      ]);
      setComposerExpanded(false);
      maybeAutoTitleConversation(trimmedQuestion);
    } catch (askError) {
      if (!mounted.current) return;
      if (askError instanceof ApiError && askError.status === 401) {
        await supabase.auth.signOut();
      }

      setError(askError instanceof Error ? askError.message : 'The request failed.');
    } finally {
      setAsking(false);
    }

  }

  async function handleDraft(event: FormEvent) {
    event.preventDefault();
    if (!session?.access_token || !draft.audience.trim() || !draft.objective.trim() || historyBusy || asking || drafting || !conversationId) return;
    setError('');
    setDrafting(true);
    try {
      const response = await draftMessage({
        ...draft,
        audience: draft.audience.trim(),
        objective: draft.objective.trim(),
        context: draft.context?.trim() || undefined,
      }, session.access_token, conversationId);
      setConversationMessages((current) => [...current,
        { id: `local-draft-${Date.now()}`, conversationId: conversationId ?? response.conversationId ?? '', role: 'assistant', content: response.draft, citations: response.sources, createdAt: new Date().toISOString() },
      ]);
      setComposerExpanded(false);
      maybeAutoTitleConversation(`${draft.objective.trim()} for ${draft.audience.trim()}`);
    } catch (draftError) {
      if (!mounted.current) return;
      if (draftError instanceof ApiError && draftError.status === 401) await supabase.auth.signOut();
      setError(draftError instanceof Error ? draftError.message : 'The draft request failed.');
    } finally {
      setDrafting(false);
    }
  }

  async function copyAnswer(content: string) {
    try { await navigator.clipboard.writeText(content); if (mounted.current) setFeedback('Copied to clipboard.'); }
    catch { if (mounted.current) setFeedback('Could not copy. Select the answer text and copy manually.'); }
  }
  function openComposer(nextMode: 'ask' | 'draft', target: 'question' | 'audience' | 'context') {
    setSecondaryView(null);
    setComposerExpanded(true);
    setMode(nextMode);
    setPendingComposerFocus(target);
  }
  function stageAnswer(content: string, target: 'ask' | 'draft') {
    if (composerBusy) return;
    const context = content.slice(0, 2000);
    if (target === 'ask') setQuestion(`Refine this response:\n${context}\n\nFocus on: `);
    else setDraft((current) => ({ ...current, context }));
    setFeedback(`Added ${context.length.toLocaleString()} characters${content.length > 2000 ? ' (limited to 2,000 characters)' : ''} to ${target === 'ask' ? 'your question' : 'draft context'}. Review and edit before sending.`);
    openComposer(target, target === 'ask' ? 'question' : 'context');
  }
  function focusComposer(nextMode: 'ask' | 'draft') {
    openComposer(nextMode, nextMode === 'ask' ? 'question' : 'audience');
  }


  return (
    <main className="shell">
      <header className="header">
        <div className="header-brand">
          <BrandMark />
          <span className="header-product">BD Assistant</span>
        </div>
        {session && <nav className="header-actions" aria-label="Workspace">{role === 'admin' && <button className="text-button" aria-expanded={adminOpen} disabled={secondaryBusy} onClick={openAdmin}>Admin</button>}<button className="text-button settings-trigger" aria-expanded={settingsOpen} disabled={secondaryBusy} onClick={() => toggleSecondary('settings')}><Icon name="settings" size={15} />Settings</button><button className="text-button" onClick={handleSignOut}>Sign out</button></nav>}
      </header>

      {!session ? (
        <section className="card centered auth-card">
          <div className="auth-brand"><BrandMark /></div>
          <h2>Grounded BD answers</h2>
          <p className="muted">Sign in to ask questions using SprintX knowledge.</p>
          <button className="primary-button full" onClick={handleSignIn} disabled={authenticating}>
            {authenticating ? 'Opening Google...' : 'Continue with Google'}
          </button>
        </section>
      ) : (
        <>
          {adminOpen && <section className="card settings-card">
            <h2>Admin controls</h2>
            <p className="muted">Provision users and refresh the configured knowledge sources.</p>
            <form className="ask-form" onSubmit={handleCreateUser}>
              <label htmlFor="new-user-name">Name</label>
              <input id="new-user-name" value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} placeholder="Team member name" />
              <label htmlFor="new-user-email">Email</label>
              <input id="new-user-email" type="email" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} placeholder="team.member@example.com" />
              <label htmlFor="new-user-role">Role</label>
              <select id="new-user-role" value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value as 'admin' | 'intern' })}><option value="intern">Intern</option><option value="admin">Admin</option></select>
              <button className="primary-button full" type="submit" disabled={adminBusy || !newUser.name.trim() || !newUser.email.trim()}>Provision user</button>
            </form>
            <div className="admin-actions">
              <button className="primary-button" type="button" onClick={handleDriveSync} disabled={adminBusy}>{adminBusy ? 'Working...' : 'Sync Google Drive'}</button>
              <button className="secondary-button" type="button" onClick={handleFactsSync} disabled={adminBusy}>{adminBusy ? 'Working...' : 'Refresh case-study facts'}</button>
              <button className="secondary-button" type="button" onClick={handleWebsiteCrawl} disabled={adminBusy}>{adminBusy ? 'Working...' : 'Crawl websites'}</button>
            </div>
            {syncMessage && <p className="key-status">{syncMessage}</p>}
            <div className="user-list">{users.map((user) => <div className="user-row" key={user.id}><span>{user.name}<small>{user.email}</small></span><strong>{user.role}</strong></div>)}</div>
          </section>}
          {settingsOpen && <section className="card settings-card">
            <AppearanceSettings appearance={appearance} />
            <h2>Gemini key</h2>
            <p className="muted">Your key is encrypted on the backend and is never stored in this extension.</p>
            <p className="key-status">{keyConfigured ? 'Gemini key configured' : 'No personal Gemini key configured'}</p>
            <form className="ask-form" onSubmit={handleSaveKey}>
              <label htmlFor="gemini-key">Replace key</label>
              <input id="gemini-key" type="password" value={geminiKey} onChange={(event) => setGeminiKeyValue(event.target.value)} placeholder="Paste a Gemini API key" autoComplete="off" />
              <button className="primary-button full" type="submit" disabled={savingKey || !geminiKey.trim()}>{savingKey ? 'Saving...' : 'Save encrypted key'}</button>
            </form>
            {keyConfigured && <button className="danger-button full" type="button" onClick={handleRemoveKey} disabled={savingKey}>Remove key</button>}
          </section>}
          <div className="conversation-bar">
            <button className="text-button" type="button" disabled={secondaryBusy} onClick={() => toggleSecondary('history')} aria-expanded={historyOpen}>
              Conversation: {conversationTitle}
            </button>
            <div className="quick-actions" aria-label="Quick navigation">
              <button className="icon-button" type="button" aria-label="Ask a question" title="Ask a question" onClick={() => focusComposer('ask')} disabled={composerBusy}><Icon name="plus" /></button>
              <button className="icon-button" type="button" aria-label="Open conversation history" title="Conversation history" onClick={() => toggleSecondary('history')} aria-expanded={historyOpen} disabled={secondaryBusy}><Icon name="history" /></button>
              <button className="icon-button" type="button" aria-label="New conversation" title="New conversation" onClick={handleNewConversation} disabled={historyBusy || asking || drafting || !conversationId}><Icon name="new" /><span className="sr-only">New</span></button>
              {latestAssistantId && <a className="icon-button latest-icon" href="#latest-message" aria-label="Jump to latest response" title="Latest response"><Icon name="down" /></a>}
            </div>
          </div>
          {historyOpen && <section className="card history-card">
            <div className="answer-heading"><h2>Conversation history</h2><button className="text-button" type="button" disabled={secondaryBusy} onClick={() => setHistoryOpen(false)}>Close</button></div>
            {conversations.length === 0 ? <p className="empty-state">No saved conversations yet.</p> : <div className="conversation-list">
              {conversations.map((conversation) => <div className={conversation.id === conversationId ? 'conversation-item active' : 'conversation-item'} key={conversation.id}>
                <button className="conversation-select" type="button" onClick={() => handleSelectConversation(conversation)} disabled={historyBusy || asking || drafting}>
                  <strong>{conversation.title}</strong><small>{new Date(conversation.updatedAt).toLocaleString()}</small>
                </button>
                <span className="conversation-actions">
                  {pendingDeleteConversationId === conversation.id ? <>
                    <button className="text-button danger-text" type="button" aria-label={`Confirm delete ${conversation.title}`} onClick={() => handleDeleteConversation(conversation)} disabled={historyBusy || asking || drafting}>Confirm</button>
                    <button className="text-button" type="button" aria-label={`Cancel delete ${conversation.title}`} onClick={() => setPendingDeleteConversationId(undefined)} disabled={historyBusy}>Cancel</button>
                  </> : <>
                    <button className="text-button" type="button" onClick={() => handleRenameConversation(conversation)} disabled={historyBusy || asking || drafting}>Rename</button>
                    <button className="text-button danger-text" type="button" onClick={() => setPendingDeleteConversationId(conversation.id)} disabled={historyBusy || asking || drafting}>Delete</button>
                  </>}
                </span>
              </div>)}
            </div>}
          </section>}
          {!secondaryView && <><section className="timeline" aria-label="Conversation timeline" aria-busy={composerBusy}>
            {conversationMessages.length ? conversationMessages.map((message) => <article id={message.id === latestAssistantId ? 'latest-message' : undefined} className={message.role === 'user' ? 'timeline-message user-message' : 'timeline-message assistant-message'} key={message.id}>
              <div className="message-heading"><strong>{message.role === 'user' ? 'You' : 'SprintX'}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
              <AnswerContent content={message.content} />
              {message.role === 'assistant' && <>
                <Sources sources={message.citations} />
                <div className="message-actions"><button className="message-action" onClick={() => copyAnswer(message.content)} type="button"><Icon name="copy" size={14} />Copy</button><button className="message-action" disabled={composerBusy} onClick={() => stageAnswer(message.content, 'ask')} type="button"><Icon name="refine" size={14} />Refine</button><button className="message-action" disabled={composerBusy} onClick={() => stageAnswer(message.content, 'draft')} type="button"><Icon name="draft" size={14} />Use in Draft</button></div>
              </>}
            </article>) : <div className="welcome">
              <div className="workspace-mark" aria-hidden="true"><BrandMark compact /></div>
              <p className="eyebrow">YOUR KNOWLEDGE, WITH CONTEXT</p>
              <h2>Move the conversation forward.</h2>
              <p className="muted">Research SprintX. Shape the right outreach.</p>
              <div className="suggestions" aria-label="Suggested questions">{['What services does SprintX offer?', 'How should we position SprintX for a SaaS founder?', 'Which case studies support our AI expertise?'].map((prompt) => <button className="suggestion" type="button" key={prompt} disabled={composerBusy} onClick={() => { setQuestion(prompt); openComposer('ask', 'question'); }}>{prompt}<span aria-hidden="true">↗</span></button>)}</div>
            </div>}
            {(asking || drafting) && <p className="working" role="status">{asking ? 'Researching SprintX knowledge…' : 'Shaping your draft…'}</p>}
          </section>
          <section className={`composer${mode === 'draft' ? ' composer-draft' : ''}${composerExpanded ? '' : ' collapsed'}`} aria-label="Message composer">
          <div className="composer-heading"><div className="tabs" role="group" aria-label="Assistant mode">
            <button className={mode === 'ask' ? 'tab active' : 'tab'} aria-pressed={mode === 'ask'} disabled={composerBusy} onClick={() => focusComposer('ask')} type="button">Ask</button>
            <button className={mode === 'draft' ? 'tab active' : 'tab'} aria-pressed={mode === 'draft'} disabled={composerBusy} onClick={() => focusComposer('draft')} type="button">Draft</button>
          </div><div className="composer-heading-actions">
            {latestAssistantId ? <a className="text-button latest-link" href="#latest-message">Latest response</a> : <span className="composer-hint">Grounded in SprintX</span>}
            <button
              className="icon-button composer-toggle"
              type="button"
              aria-expanded={composerExpanded}
              aria-controls="composer-body"
              aria-label={composerExpanded ? 'Collapse composer' : 'Expand composer'}
              title={composerExpanded ? 'Collapse composer' : 'Expand composer'}
              onClick={() => setComposerExpanded((current) => !current)}
            ><Icon name={composerExpanded ? 'chevronDown' : 'chevronUp'} size={16} /></button>
          </div></div>
          {composerExpanded && <div className="composer-body" id="composer-body">
          {feedback && <p className="feedback" role="status">{feedback}</p>}
          {mode === 'ask' ? <form className="ask-form" onSubmit={handleAsk}>
            <label className="sr-only" htmlFor="question">Your question</label>
            <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about services, positioning, or outreach…" rows={2} disabled={composerBusy} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
            <label className="sr-only" htmlFor="ask-mode">Answer mode</label>
            <select className="compact-select" id="ask-mode" value={askMode} onChange={(event) => setAskMode(event.target.value as AskMode)} disabled={composerBusy}>
              <option value="knowledge">Grounded knowledge</option>
              <option value="facts">Structured case-study facts</option>
              <option value="advice">General advice (not SprintX evidence)</option>
            </select>
            <div className="composer-controls">
              <span className="composer-hint">Ctrl / ⌘ Enter</span>
              <button className="primary-button composer-submit" type="submit" disabled={asking || drafting || historyBusy || !conversationId || !question.trim()}><Icon name="send" size={15} />{asking ? 'Working…' : 'Ask SprintX'}</button>
            </div>
          </form> : <form className="ask-form draft-form" onSubmit={handleDraft}><fieldset disabled={composerBusy} className="draft-fields draft-scroll" aria-label="Draft fields">
            <label htmlFor="draft-type">Message type</label>
            <select id="draft-type" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as DraftInput['type'] })}>
              <option value="cold-email">Cold email</option>
              <option value="follow-up">Follow-up</option>
              <option value="linkedin">LinkedIn message</option>
              <option value="proposal">Proposal response</option>
            </select>
            <label htmlFor="audience">Audience</label>
            <input id="audience" value={draft.audience} onChange={(event) => setDraft({ ...draft, audience: event.target.value })} placeholder="A B2B SaaS founder" />
            <label htmlFor="objective">Objective</label>
            <input id="objective" value={draft.objective} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} placeholder="Book an introductory call" />
            <div className="field-row">
              <div><label htmlFor="tone">Tone</label><select id="tone" value={draft.tone} onChange={(event) => setDraft({ ...draft, tone: event.target.value as DraftInput['tone'] })}><option value="professional">Professional</option><option value="friendly">Friendly</option><option value="persuasive">Persuasive</option><option value="concise">Concise</option></select></div>
              <div><label htmlFor="length">Length</label><select id="length" value={draft.length} onChange={(event) => setDraft({ ...draft, length: event.target.value as DraftInput['length'] })}><option value="short">Short</option><option value="medium">Medium</option><option value="long">Long</option></select></div>
            </div>
            <label htmlFor="context">Additional context (optional)</label>
            <textarea id="context" value={draft.context} onChange={(event) => setDraft({ ...draft, context: event.target.value })} placeholder="Mention a relevant challenge or offer..." rows={3} />
            </fieldset>
            <div className="draft-footer" data-testid="draft-footer">
              <button className="primary-button full draft-submit" type="submit" disabled={drafting || asking || historyBusy || !conversationId || !draft.audience.trim() || !draft.objective.trim()}><Icon name="draft" size={16} />{drafting ? 'Writing...' : 'Create draft'}</button>
            </div>
          </form>}
          </div>}
          </section></>}
        </>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </main>
  );
}
