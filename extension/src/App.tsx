import { FormEvent, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ApiError, askAssistant, createConversation, draftMessage, getProfile, listConversations, removeGeminiKey, setGeminiKey } from './api';
import { signInWithGoogle, supabase } from './supabase';
import type { AskResponse, DraftInput, DraftResponse } from './types';

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [geminiKey, setGeminiKeyValue] = useState('');
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

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
        const latest = conversations[0] ?? (await createConversation(session.access_token, 'SprintX workspace')).conversation;
        if (active) {
          setConversationId(latest.id);
          setConversationTitle(latest.title);
        }
      })
      .catch((conversationError) => {
        if (active) setError(conversationError instanceof Error ? conversationError.message : 'Conversation history is unavailable.');
      });
    return () => {
      active = false;
    };
  }, [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token) return;
    getProfile(session.access_token)
      .then((profile) => setKeyConfigured(profile.geminiKeyConfigured))
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

  async function handleAsk(event: FormEvent) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !session?.access_token) return;
    setError('');
    setAsking(true);
    try {
      setResult(await askAssistant(trimmedQuestion, session.access_token, conversationId));
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
      setDraftResult(await draftMessage({
        ...draft,
        audience: draft.audience.trim(),
        objective: draft.objective.trim(),
        context: draft.context?.trim() || undefined,
      }, session.access_token, conversationId));
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
        {session && <div className="header-actions"><button className="text-button" onClick={() => setSettingsOpen(!settingsOpen)}>Settings</button><button className="text-button" onClick={handleSignOut}>Sign out</button></div>}
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
          <p className="conversation-label">Conversation: {conversationTitle}</p>
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
