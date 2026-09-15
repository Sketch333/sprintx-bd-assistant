import { FormEvent, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ApiError, askAssistant } from './api';
import { signInWithGoogle, supabase } from './supabase';
import type { AskResponse } from './types';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);

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
  }

  async function handleAsk(event: FormEvent) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !session?.access_token) return;
    setError('');
    setAsking(true);
    try {
      setResult(await askAssistant(trimmedQuestion, session.access_token));
    } catch (askError) {
      if (askError instanceof ApiError && askError.status === 401) {
        await supabase.auth.signOut();
      }
      setError(askError instanceof Error ? askError.message : 'The request failed.');
    } finally {
      setAsking(false);
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
        {session && <button className="text-button" onClick={handleSignOut}>Sign out</button>}
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
          <section className="intro">
            <p>Ask about SprintX services, positioning, case studies, or outreach strategy.</p>
          </section>
          <form className="ask-form" onSubmit={handleAsk}>
            <label htmlFor="question">Your question</label>
            <textarea
              id="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What services does SprintX offer?"
              rows={5}
              disabled={asking}
            />
            <button className="primary-button full" type="submit" disabled={asking || !question.trim()}>
              {asking ? 'Researching...' : 'Ask SprintX'}
            </button>
          </form>
          {result ? (
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
          ) : (
            <section className="empty-state">
              <p>Your grounded answer and sources will appear here.</p>
            </section>
          )}
        </>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </main>
  );
}
