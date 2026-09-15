import { FormEvent, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ApiError, askAssistant, crawlWebsites, createConversation, createUser, draftMessage, getConversationMessages, getProfile, listConversations, listUsers, removeGeminiKey, setGeminiKey, syncGoogleDrive } from './api';
import { signInWithGoogle, supabase } from './supabase';
import type { AskResponse, Conversation, ConversationMessage, DraftInput, DraftResponse, ProvisionedUser } from './types';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AskResponse | null>(null);
  const [draftResult, setDraftResult] = useState<DraftResponse | null>(null);
  const [mode, setMode] = useState<'ask' | 'draft'>('ask');
  const [draft, setDraft] = useState<DraftInput>({
    type: 'cold-email',
    audience: '',
    objective: '',
    tone: 'professional',
    length: 'medium',
    context: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const [conversationTitle, setConversationTitle] = useState('New conversation');
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [geminiKey, setGeminiKeyValue] = useState('');
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [role, setRole] = useState<'admin' | 'intern'>();
  const [adminOpen, setAdminOpen] = useState(false);
  const [users, setUsers] = useState<ProvisionedUser[]>([]);
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'intern' as 'admin' | 'intern' });
  const [adminBusy, setAdminBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

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
        if (active) {
          setConversationId(latest.id);
          setConversationTitle(latest.title);
          if (!conversations.length) setConversations([latest]);
        }
      })
      .catch((conversationError) => {
        if (active) setError(conversationError instanceof Error ? conversationError.message : 'Conversation history is unavailable.');
      });
    return () => {
      active = false;
    };
  }, [session?.access_token]);

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
      setResult(null);
      setDraftResult(null);
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
      const lastAssistant = [...messages].reverse().find((message: ConversationMessage) => message.role === 'assistant');
      setResult(lastAssistant ? {
        ok: true,
        question: [...messages].reverse().find((message) => message.role === 'user')?.content ?? '',
        answer: lastAssistant.content,
        sources: lastAssistant.citations,
        usedGemini: true,
        userId: null,
        conversationId: conversation.id,
      } : null);
      setDraftResult(null);
      setHistoryOpen(false);
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : 'Could not load conversation history.');
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
  }, [session?.access_token]);

  async function handleSignIn() {
    setError('');
    setAuthenticating(true);
    try {
      await signInWithGoogle();
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Google sign-in failed.');
    } finally {
      setAuthenticating(false);
    }
  }

  async function handleSignOut() {
    setError('');
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
    setResult(null);
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
    setAdminOpen(!adminOpen);
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
    setAdminBusy(true);
    setSyncMessage('');
    setError('');
    try {
      const response = await syncGoogleDrive(session.access_token);
      setSyncMessage(`Google Drive sync complete: ${JSON.stringify(response.result)}`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Google Drive sync failed.');
    } finally {
      setAdminBusy(false);
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

  async function handleAsk(event: FormEvent) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !session?.access_token) return;
    setError('');
    setAsking(true);
    try {
      const response = await askAssistant(trimmedQuestion, session.access_token, conversationId);
      setResult(response);
      setConversationMessages((current) => [...current,
        { id: `local-user-${Date.now()}`, conversationId: conversationId ?? response.conversationId ?? '', role: 'user', content: trimmedQuestion, citations: [], createdAt: new Date().toISOString() },
        { id: `local-assistant-${Date.now()}`, conversationId: conversationId ?? response.conversationId ?? '', role: 'assistant', content: response.answer, citations: response.sources, createdAt: new Date().toISOString() },
      ]);
    } catch (askError) {
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
    if (!session?.access_token || !draft.audience.trim() || !draft.objective.trim()) return;
    setError('');
    setDrafting(true);
    try {
      const response = await draftMessage({
        ...draft,
        audience: draft.audience.trim(),
        objective: draft.objective.trim(),
        context: draft.context?.trim() || undefined,
      }, session.access_token, conversationId);
      setDraftResult(response);
      setConversationMessages((current) => [...current,
        { id: `local-draft-${Date.now()}`, conversationId: conversationId ?? response.conversationId ?? '', role: 'assistant', content: response.draft, citations: response.sources, createdAt: new Date().toISOString() },
      ]);
    } catch (draftError) {
      if (draftError instanceof ApiError && draftError.status === 401) await supabase.auth.signOut();
      setError(draftError instanceof Error ? draftError.message : 'The draft request failed.');
    } finally {
      setDrafting(false);
    }
  }

  async function copyAnswer() {
    if (result) await navigator.clipboard.writeText(result.answer);
  }

  if (loading) return <main className="shell centered"><p>Loading SprintX Assistant...</p></main>;

  return (
    <main className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">SPRINTX</p>
          <h1>BD Assistant</h1>
        </div>
        {session && <div className="header-actions">{role === 'admin' && <button className="text-button" onClick={openAdmin}>Admin</button>}<button className="text-button" onClick={() => setSettingsOpen(!settingsOpen)}>Settings</button><button className="text-button" onClick={handleSignOut}>Sign out</button></div>}
      </header>

      {!session ? (
        <section className="card centered auth-card">
          <div className="brand-mark">S</div>
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
              <button className="secondary-button" type="button" onClick={handleWebsiteCrawl} disabled={adminBusy}>{adminBusy ? 'Working...' : 'Crawl websites'}</button>
            </div>
            {syncMessage && <p className="key-status">{syncMessage}</p>}
            <div className="user-list">{users.map((user) => <div className="user-row" key={user.id}><span>{user.name}<small>{user.email}</small></span><strong>{user.role}</strong></div>)}</div>
          </section>}
          {settingsOpen && <section className="card settings-card">
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
          <div className="tabs" role="tablist" aria-label="Assistant mode">
            <button className={mode === 'ask' ? 'tab active' : 'tab'} onClick={() => setMode('ask')} type="button">Ask</button>
            <button className={mode === 'draft' ? 'tab active' : 'tab'} onClick={() => setMode('draft')} type="button">Draft</button>
          </div>
          <div className="conversation-bar">
            <button className="text-button" type="button" onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen}>
              Conversation: {conversationTitle}
            </button>
            <button className="text-button" type="button" onClick={handleNewConversation} disabled={historyBusy}>New</button>
          </div>
          {historyOpen && <section className="card history-card">
            <div className="answer-heading"><h2>Conversation history</h2><button className="text-button" type="button" onClick={() => setHistoryOpen(false)}>Close</button></div>
            {conversations.length === 0 ? <p className="empty-state">No saved conversations yet.</p> : <div className="conversation-list">
              {conversations.map((conversation) => <button className={conversation.id === conversationId ? 'conversation-item active' : 'conversation-item'} type="button" key={conversation.id} onClick={() => handleSelectConversation(conversation)} disabled={historyBusy}>
                <strong>{conversation.title}</strong><small>{new Date(conversation.updatedAt).toLocaleString()}</small>
              </button>)}
            </div>}
          </section>}
          {conversationMessages.length > 0 && <section className="card transcript-card">
            <div className="answer-heading"><h2>Transcript</h2><span className="muted">{conversationMessages.length} messages</span></div>
            <div className="transcript">
              {conversationMessages.map((message) => <article className={message.role === 'user' ? 'transcript-message user-message' : 'transcript-message'} key={message.id}>
                <strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
                <p>{message.content}</p>
              </article>)}
            </div>
          </section>}
          <section className="intro">
            <p>{mode === 'ask' ? 'Ask about SprintX services, positioning, case studies, or outreach strategy.' : 'Create a grounded outreach message using SprintX knowledge.'}</p>
          </section>
          {mode === 'ask' ? <form className="ask-form" onSubmit={handleAsk}>
            <label htmlFor="question">Your question</label>
            <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What services does SprintX offer?" rows={5} disabled={asking} />
            <button className="primary-button full" type="submit" disabled={asking || !question.trim()}>{asking ? 'Researching...' : 'Ask SprintX'}</button>
          </form> : <form className="ask-form" onSubmit={handleDraft}>
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
            <button className="primary-button full" type="submit" disabled={drafting || !draft.audience.trim() || !draft.objective.trim()}>{drafting ? 'Writing...' : 'Create draft'}</button>
          </form>}
          {mode === 'ask' && result ? (
            <section className="card answer-card">
              <div className="answer-heading">
                <h2>Answer</h2>
                <button className="text-button" onClick={copyAnswer} type="button">Copy</button>
              </div>
              <p className="answer">{result.answer}</p>
              {result.sources.length > 0 && (
                <div className="sources">
                  <h3>Sources</h3>
                  {result.sources.map((source, index) => (
                    <article className="source" key={`${source.path}-${index}`}>
                      <strong>{source.title}</strong>
                      <p>{source.snippet}</p>
                      {source.url && <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : mode === 'draft' && draftResult ? (
            <section className="card answer-card">
              <div className="answer-heading"><h2>Draft</h2><button className="text-button" onClick={() => navigator.clipboard.writeText(draftResult.draft)} type="button">Copy</button></div>
              <p className="answer draft-text">{draftResult.draft}</p>
              {draftResult.sources.length > 0 && <div className="sources"><h3>Grounded in</h3>{draftResult.sources.map((source, index) => <article className="source" key={`${source.path}-${index}`}><strong>{source.title}</strong><p>{source.snippet}</p></article>)}</div>}
            </section>
          ) : (
            <section className="empty-state">
              <p>{mode === 'ask' ? 'Your grounded answer and sources will appear here.' : 'Your ready-to-send draft and supporting sources will appear here.'}</p>
            </section>
          )}
        </>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </main>
  );
}
