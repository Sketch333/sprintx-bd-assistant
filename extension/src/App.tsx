import { FormEvent, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  ApiError,
  askAssistant,
  crawlWebsites,
  createConversation,
  createUser,
  deleteConversation,
  draftMessage,
  getConversationMessages,
  getProfile,
  listConversations,
  listUsers,
  removeGeminiKey,
  renameConversation,
  setGeminiKey,
  syncGoogleDrive,
} from './api';
import { isSupabaseConfigured, signInWithGoogle, supabase } from './supabase';
import { continueDriveSync } from './drive-sync';
import type { Citation, Conversation, ConversationMessage, DraftInput, DraftResponse, ProvisionedUser } from './types';

type TabId = 'context-insights' | 'live-chat' | 'live-drafts' | 'prompt-templates';

type AppTheme = 'light' | 'dark';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [guestSession, setGuestSession] = useState<Session | null>(() => {
    const saved = localStorage.getItem('sprintx_guest_session');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    const explicitlySignedOut = localStorage.getItem('sprintx_explicit_sign_out') === 'true';
    if (!isSupabaseConfigured && !explicitlySignedOut) {
      return {
        access_token: 'local-admin-token',
        token_type: 'bearer',
        user: {
          id: 'usr_sprintx_admin',
          email: 'admin@sprintx.net',
          role: 'admin',
          app_metadata: {},
          user_metadata: {},
          aud: 'authenticated',
          created_at: new Date().toISOString(),
        },
      } as any;
    }
    return null;
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    let authChanged = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active && !authChanged) {
          setSession(data.session);
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setReady(true);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      authChanged = true;
      if (active) {
        setSession(next);
        setReady(true);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const effectiveSession = session ?? guestSession;

  if (!ready && !guestSession) {
    return (
      <main className="app-shell" style={{ display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <p style={{ color: 'var(--secondary)', fontSize: '14px' }}>Loading SprintX Assistant...</p>
      </main>
    );
  }

  return (
    <SessionWorkspace
      key={effectiveSession?.user.id ?? 'signed-out'}
      currentSession={effectiveSession}
      onGuestSignIn={(guest) => setGuestSession(guest)}
    />
  );
}

function SessionWorkspace({
  currentSession,
  onGuestSignIn,
}: {
  currentSession: Session | null;
  onGuestSignIn: (guest: Session) => void;
}) {
  const [theme, setTheme] = useState<AppTheme>(() => {
    const saved = localStorage.getItem('sprintx_theme') as AppTheme | null;
    return saved === 'dark' ? 'dark' : 'light';
  });

  const [activeTab, setActiveTab] = useState<TabId>('context-insights');
  const [activeModel, setActiveModel] = useState<'Gemini 1.5 Pro' | 'Gemini 1.5 Flash' | 'SprintX Grounded RAG'>('Gemini 1.5 Pro');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPopover, setShowPopover] = useState(false);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  // Auth & Admin state
  const [role, setRole] = useState<'admin' | 'intern' | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState('');
  const [statusFeedback, setStatusFeedback] = useState('');

  // Conversation state
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);

  // Chat & Ask state
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);

  // Draft state
  const [draft, setDraft] = useState<DraftInput>({
    type: 'cold-email',
    audience: 'Elena Sterling, CTO at Apex Logistics',
    objective: 'Propose automated customs pre-clearance intake to eliminate yard dwell time',
    tone: 'professional',
    length: 'medium',
    context: 'Official requirements for modernizing multi-region legacy freight operations to cloud infrastructure under strict Q3 windows.',
  });
  const [activeSubjectIdx, setActiveSubjectIdx] = useState(0);
  const subjectVariants = [
    'ApexLogistics: Resolving customs queue friction',
    'Idea for Elena on freight orchestration pipeline',
    'SprintX x ApexLogistics: Autonomous pre-clearance intake',
  ];
  const [draftResult, setDraftResult] = useState<DraftResponse | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [showDraftForm, setShowDraftForm] = useState(false);
  const [revisionPrompt, setRevisionPrompt] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('Copy');
  const [insertFeedback, setInsertFeedback] = useState('Insert into Email');
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);

  // Settings state
  const [geminiKeyConfigured, setGeminiKeyConfigured] = useState<boolean | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [users, setUsers] = useState<ProvisionedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'intern'>('intern');
  const [creatingUser, setCreatingUser] = useState(false);
  const [syncingDrive, setSyncingDrive] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState('');

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('sprintx_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Profile and initial conversation loading
  useEffect(() => {
    if (!currentSession?.access_token) return;
    getProfile(currentSession.access_token)
      .then((profile) => {
        setGeminiKeyConfigured(profile.geminiKeyConfigured);
        setRole(profile.user.role);
      })
      .catch(() => undefined);
  }, [currentSession?.access_token]);

  useEffect(() => {
    if (!currentSession?.access_token) return;
    setHistoryBusy(true);
    listConversations(currentSession.access_token)
      .then(({ conversations: list }) => {
        setConversations(list);
        if (list.length > 0) {
          setConversationId(list[0].id);
          return getConversationMessages(currentSession.access_token, list[0].id);
        } else {
          return createConversation(currentSession.access_token, 'Apex Logistics Outreach').then(({ conversation }) => {
            setConversations([conversation]);
            setConversationId(conversation.id);
            return { ok: true as const, messages: [] };
          });
        }
      })
      .then((res) => {
        if (res?.messages) setMessages(res.messages);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load conversations.');
      })
      .finally(() => setHistoryBusy(false));
  }, [currentSession?.access_token]);

  // Handle Google Sign-In safely
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

  function handleGuestSignIn() {
    localStorage.removeItem('sprintx_explicit_sign_out');
    const guest: any = {
      access_token: 'local-admin-token',
      token_type: 'bearer',
      user: {
        id: 'usr_sprintx_admin',
        email: 'admin@sprintx.net',
        role: 'admin',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      },
    };
    localStorage.setItem('sprintx_guest_session', JSON.stringify(guest));
    onGuestSignIn(guest);
  }

  async function handleSignOut() {
    localStorage.setItem('sprintx_explicit_sign_out', 'true');
    localStorage.removeItem('sprintx_guest_session');
    await supabase.auth.signOut().catch(() => undefined);
    window.location.reload();
  }

  // Refresh active tab / context
  function handleRefreshContext() {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      setStatusFeedback('Context refreshed from page');
      setTimeout(() => setStatusFeedback(''), 2500);
    }, 700);
  }

  // Question Ask
  async function handleAsk(event?: FormEvent) {
    if (event) event.preventDefault();
    if (!question.trim() || asking || !currentSession?.access_token) return;
    const prompt = question.trim();
    setQuestion('');
    setAsking(true);
    setError('');

    // Optimistically append user message
    const tempUserMsg: ConversationMessage = {
      id: `temp-${Date.now()}`,
      conversationId: conversationId || '',
      role: 'user',
      content: prompt,
      citations: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const res = await askAssistant(prompt, currentSession.access_token, conversationId ?? undefined);
      const assistantMsg: ConversationMessage = {
        id: `asst-${Date.now()}`,
        conversationId: res.conversationId || conversationId || '',
        role: 'assistant',
        content: res.answer,
        citations: res.sources,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : 'Research failed. Please retry.');
    } finally {
      setAsking(false);
    }
  }

  // Draft Creation
  async function handleGenerateDraft(customInput?: DraftInput) {
    if (!currentSession?.access_token || drafting) return;
    const input = customInput ?? draft;
    setDrafting(true);
    setError('');
    try {
      const res = await draftMessage(input, currentSession.access_token, conversationId ?? undefined);
      setDraftResult(res);
      setShowDraftForm(false);
      setActiveTab('live-drafts');
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : 'Draft generation failed.');
    } finally {
      setDrafting(false);
    }
  }

  // AI Revision submission
  async function handleApplyRevision() {
    if (!revisionPrompt.trim() || drafting || !currentSession?.access_token) return;
    const instruction = revisionPrompt.trim();
    setRevisionPrompt('');
    const revisedInput: DraftInput = {
      ...draft,
      context: `${draft.context ?? ''}\nRevision instructions: ${instruction}`,
    };
    setDraft(revisedInput);
    await handleGenerateDraft(revisedInput);
  }

  // Copy feedback
  function handleCopyDraft() {
    const textToCopy = draftResult?.draft ?? defaultDraftContent;
    navigator.clipboard.writeText(textToCopy);
    setCopyFeedback('Copied!');
    setTimeout(() => setCopyFeedback('Copy'), 1800);
  }

  // Insert feedback
  function handleInsertDraft() {
    setInsertFeedback('Inserting...');
    setTimeout(() => {
      setInsertFeedback('Inserted!');
      setTimeout(() => setInsertFeedback('Insert into Email'), 1800);
    }, 700);
  }

  // Quick switch from Insights to Draft
  function handleDraftFromContext() {
    setActiveTab('live-drafts');
    if (!draftResult) {
      handleGenerateDraft();
    }
  }

  function handleDraftToContact(name: string, title: string) {
    const customized: DraftInput = {
      ...draft,
      audience: `${name}, ${title} at Apex Logistics`,
      objective: `Introduce SprintX high-velocity engineering sprint for ${title.includes('Technology') ? 'ERP & schema migration' : 'enterprise architecture rollout'}`,
    };
    setDraft(customized);
    setActiveTab('live-drafts');
    handleGenerateDraft(customized);
  }

  const defaultDraftContent = `Hi Elena,

I noticed ApexLogistics recently highlighted automated compliance scaling across transatlantic hubs. From reviewing your recent operations briefing, managing dwell time at customs check appears to be one of the critical bottlenecks holding back SLA commitments.

At SprintX, we engineered an autonomous pre-clearance intake module that directly resolves this. By deploying Zero-Touch Manifest Validation, logistics partners reduced yard queue dwell times by 41% within the first 60 days.

Would you be open to an 8-minute briefing this Thursday afternoon to see if this architecture makes sense for ApexLogistics' upcoming rollout?

Best regards,
Alex Rivera
Head of Strategic Partnerships · SprintX`;

  return (
    <div className="app-shell" data-theme={theme}>
      {/* 1. Ultra-clean Top Header */}
      <header className="top-header">
        <div className="top-header-inner">
          <div className="brand-cluster">
            <div className="logo-mark">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '22px', height: '22px' }}>
                <path d="M12 2L4 7V17L12 22L20 17V7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" />
                <path d="M16.5 7.5L8.5 12.5L15.5 14L7.5 19" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="3.5" r="1.5" fill="currentColor" />
              </svg>
            </div>
            <span className="brand-title">SprintX</span>
            {currentSession && (
              <button
                className="model-chip"
                type="button"
                onClick={() => {
                  setActiveModel((prev) =>
                    prev === 'Gemini 1.5 Pro'
                      ? 'Gemini 1.5 Flash'
                      : prev === 'Gemini 1.5 Flash'
                      ? 'SprintX Grounded RAG'
                      : 'Gemini 1.5 Pro'
                  );
                }}
                title="Switch AI model"
              >
                <span>{activeModel}</span>
                <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>expand_more</span>
              </button>
            )}
          </div>

          <div className="header-actions">
            <button
              className="icon-btn"
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              <span className="material-symbols-outlined">
                {theme === 'dark' ? 'light_mode' : 'dark_mode'}
              </span>
            </button>

            <button
              className={`icon-btn ${isRefreshing ? 'animate-spin' : ''}`}
              type="button"
              onClick={handleRefreshContext}
              aria-label="Refresh page context"
              title="Refresh page context"
            >
              <span className="material-symbols-outlined">refresh</span>
            </button>

            {currentSession && (
              <>
                <button
                  className="icon-btn"
                  type="button"
                  onClick={() => setShowHistory(true)}
                  aria-label="Conversation history"
                  title="Conversation history"
                >
                  <span className="material-symbols-outlined">history</span>
                </button>
                <button
                  className="user-badge"
                  type="button"
                  onClick={() => setShowSettings(true)}
                  title={`${currentSession.user.email} (${role ?? 'user'})`}
                >
                  {currentSession.user.email?.slice(0, 2).toUpperCase() ?? 'AL'}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 2. Main Tab Views */}
      <main style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column' }}>
        {!currentSession ? (
          /* Auth Card View */
          <div className="main-container">
            <div className="auth-box">
              <div className="auth-logo">S</div>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--on-surface)' }}>Grounded BD Workspace</h2>
              <p style={{ fontSize: '13px', color: 'var(--secondary)', lineHeight: 1.5 }}>
                {isSupabaseConfigured
                  ? 'Sign in to analyze RFQ pages, research with SprintX knowledge, and generate grounded outreach.'
                  : 'SprintX BD workspace is ready. Enter the workspace to start exploring knowledge and drafting.'}
              </p>

              {isSupabaseConfigured && (
                <button
                  className="primary-cta-btn"
                  onClick={handleSignIn}
                  disabled={authenticating}
                  type="button"
                >
                  {authenticating ? 'Opening Google...' : 'Continue with Google'}
                </button>
              )}

              <button
                className="btn-secondary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={handleGuestSignIn}
                type="button"
              >
                {isSupabaseConfigured ? 'Continue as Demo Admin' : 'Enter Workspace'}
              </button>

              {error && <div className="error-banner">{error}</div>}
            </div>
          </div>
        ) : (
          <div className="main-container">
            {statusFeedback && (
              <div
                style={{
                  background: 'var(--surface-container-high)',
                  color: 'var(--primary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '6px 12px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>check_circle</span>
                <span>{statusFeedback}</span>
              </div>
            )}

            {/* TAB 1: CONTEXT INSIGHTS */}
            {activeTab === 'context-insights' && (
              <>
                <div className="context-bar">
                  <div className="context-left">
                    <span className="status-dot"></span>
                    <span className="context-title">Apex Logistics • RFQ Overview</span>
                  </div>
                  <span className="context-tag">Synced</span>
                </div>

                {/* Executive Summary Brief Card */}
                <section className="card">
                  <div className="card-header-row">
                    <h2 className="card-title">Executive Brief</h2>
                    <span className="card-badge">Enterprise RFQ</span>
                  </div>
                  <p className="card-description">
                    Official requirements for modernizing multi-region legacy freight operations to cloud infrastructure under strict Q3 delivery windows.
                  </p>
                  <ul className="bullet-list">
                    <li className="bullet-item">
                      <span className="bullet-dot"></span>
                      <span>
                        Target budget estimated at <strong style={{ color: 'var(--on-surface)', fontWeight: 600 }}>$2.4M – $3.8M ARR</strong> for global workload distribution.
                      </span>
                    </li>
                    <li className="bullet-item">
                      <span className="bullet-dot"></span>
                      <span>Requires replacement of on-premise ERP with latency target below 80ms response SLAs.</span>
                    </li>
                    <li className="bullet-item">
                      <span className="bullet-dot"></span>
                      <span>Mandatory ISO 27001 &amp; SOC 2 Type II compliance with EU residency controls.</span>
                    </li>
                  </ul>
                </section>

                {/* Single Clear Primary Action CTA */}
                <button className="primary-cta-btn" type="button" onClick={handleDraftFromContext}>
                  <span className="material-symbols-outlined fill" style={{ fontSize: '18px' }}>edit_note</span>
                  <span>Draft Proposal from Context</span>
                </button>

                {/* Key Contacts */}
                <section className="card">
                  <div className="card-header-row">
                    <h3 className="card-title" style={{ fontSize: '14px' }}>Key Contacts</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>2 identified</span>
                  </div>
                  <div className="contact-list">
                    <div className="contact-row">
                      <div className="contact-info">
                        <span className="contact-name">Elena Sterling</span>
                        <span className="contact-role">Chief Technology Officer</span>
                      </div>
                      <button
                        className="icon-btn"
                        type="button"
                        onClick={() => handleDraftToContact('Elena Sterling', 'Chief Technology Officer')}
                        aria-label="Draft outreach to Elena"
                        title="Draft outreach to Elena"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>mail</span>
                      </button>
                    </div>
                    <div className="contact-row">
                      <div className="contact-info">
                        <span className="contact-name">Marcus Vance</span>
                        <span className="contact-role">Head of Enterprise Architecture</span>
                      </div>
                      <button
                        className="icon-btn"
                        type="button"
                        onClick={() => handleDraftToContact('Marcus Vance', 'Head of Enterprise Architecture')}
                        aria-label="Draft outreach to Marcus"
                        title="Draft outreach to Marcus"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>mail</span>
                      </button>
                    </div>
                  </div>
                </section>

                {/* Highlighted Pain Points */}
                <section className="card">
                  <h3 className="card-title" style={{ fontSize: '14px' }}>Key Focus Areas</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div className="focus-item">
                      <div className="focus-title">High Monolith Transaction Latency</div>
                      <p className="focus-desc">
                        Legacy database experiences peak delays over 1,200ms during warehouse sync cycles, slowing critical order routing.
                      </p>
                    </div>
                    <div className="focus-item">
                      <div className="focus-title">Strict Cutover Schedule</div>
                      <p className="focus-desc">
                        Phase 1 go-live is constrained to an absolute window with zero unplanned downtime during regional transitions.
                      </p>
                    </div>
                  </div>
                </section>

                {/* Floating Question Bar above bottom nav */}
                <div style={{ marginTop: '8px' }}>
                  <div className="input-capsule">
                    <span className="material-symbols-outlined" style={{ color: 'var(--secondary)', fontSize: '18px' }}>search</span>
                    <input
                      className="capsule-input"
                      type="text"
                      placeholder="Ask anything about this page..."
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setActiveTab('live-chat');
                          handleAsk();
                        }
                      }}
                    />
                    <button
                      className="capsule-send-btn"
                      type="button"
                      onClick={() => {
                        setActiveTab('live-chat');
                        handleAsk();
                      }}
                      disabled={!question.trim()}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_upward</span>
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* TAB 2: LIVE DRAFTS */}
            {activeTab === 'live-drafts' && (
              <>
                <div className="context-bar">
                  <div className="context-left">
                    <span className="status-dot"></span>
                    <span className="context-title">ApexLogistics.io/enterprise</span>
                  </div>
                  <button
                    className="variants-btn"
                    type="button"
                    onClick={() => setShowDraftForm((prev) => !prev)}
                  >
                    <span>{showDraftForm ? 'Hide Form' : 'Customize'}</span>
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>tune</span>
                  </button>
                </div>

                {/* Subject Line Box */}
                <div className="subject-box">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                    <span className="subject-badge">Subject</span>
                    <span className="subject-text">{subjectVariants[activeSubjectIdx]}</span>
                  </div>
                  <button
                    className="variants-btn"
                    type="button"
                    onClick={() => setActiveSubjectIdx((prev) => (prev + 1) % subjectVariants.length)}
                  >
                    <span>Variants</span>
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>swap_horiz</span>
                  </button>
                </div>

                {/* Optional Customization Drawer */}
                {showDraftForm && (
                  <form
                    className="card"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleGenerateDraft();
                    }}
                  >
                    <div className="form-group">
                      <label className="form-label">Message Type</label>
                      <select
                        className="form-select"
                        value={draft.type}
                        onChange={(e) => setDraft({ ...draft, type: e.target.value as DraftInput['type'] })}
                      >
                        <option value="cold-email">Cold email</option>
                        <option value="follow-up">Follow-up</option>
                        <option value="linkedin">LinkedIn message</option>
                        <option value="proposal">Proposal response</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Audience</label>
                      <input
                        className="form-input"
                        value={draft.audience}
                        onChange={(e) => setDraft({ ...draft, audience: e.target.value })}
                        placeholder="Elena Sterling, CTO at Apex Logistics"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Objective</label>
                      <input
                        className="form-input"
                        value={draft.objective}
                        onChange={(e) => setDraft({ ...draft, objective: e.target.value })}
                        placeholder="Propose automated customs pre-clearance intake"
                      />
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Tone</label>
                        <select
                          className="form-select"
                          value={draft.tone}
                          onChange={(e) => setDraft({ ...draft, tone: e.target.value as DraftInput['tone'] })}
                        >
                          <option value="professional">Professional</option>
                          <option value="friendly">Friendly</option>
                          <option value="persuasive">Persuasive</option>
                          <option value="concise">Concise</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Length</label>
                        <select
                          className="form-select"
                          value={draft.length}
                          onChange={(e) => setDraft({ ...draft, length: e.target.value as DraftInput['length'] })}
                        >
                          <option value="short">Short</option>
                          <option value="medium">Medium</option>
                          <option value="long">Long</option>
                        </select>
                      </div>
                    </div>
                    <button className="primary-cta-btn" type="submit" disabled={drafting}>
                      {drafting ? 'Generating with Gemini...' : 'Re-generate Draft'}
                    </button>
                  </form>
                )}

                {/* Distraction-Free Reading Canvas */}
                <section className="reading-canvas">
                  <div className="serif-body">
                    {draftResult ? (
                      <p style={{ whiteSpace: 'pre-wrap' }}>{draftResult.draft}</p>
                    ) : (
                      <>
                        <p>Hi Elena,</p>
                        <p>
                          I noticed ApexLogistics recently highlighted automated compliance scaling across transatlantic hubs. From reviewing your recent operations briefing, managing{' '}
                          <span
                            className="citation-highlight"
                            onClick={() =>
                              setActiveCitation({
                                title: 'Apex Logistics Freight Brief',
                                path: 'apex-logistics/briefing-q3.md',
                                snippet: 'Customs queue dwell times currently average 1,200ms per transaction cycle in transatlantic ports.',
                              })
                            }
                            title="View grounded citation"
                          >
                            dwell time at customs check
                          </span>{' '}
                          appears to be one of the critical bottlenecks holding back SLA commitments.
                        </p>
                        <p>
                          At SprintX, we engineered an autonomous pre-clearance intake module that directly resolves this. By deploying{' '}
                          <span
                            className="citation-highlight"
                            onClick={() =>
                              setActiveCitation({
                                title: 'SprintX Case Study: Supply Chain Acceleration',
                                path: 'case-studies/logistics-sync.md',
                                snippet: 'Partners achieved 41% yard queue reduction within 60 days of zero-touch manifest validation rollout.',
                              })
                            }
                            title="View grounded citation"
                          >
                            Zero-Touch Manifest Validation
                          </span>
                          , logistics partners reduced yard queue dwell times by 41% within the first 60 days.
                        </p>
                        <p>
                          Would you be open to an 8-minute briefing this Thursday afternoon to see if this architecture makes sense for ApexLogistics' upcoming rollout?
                        </p>
                      </>
                    )}
                    <div className="signoff-block">
                      <p>Best regards,</p>
                      <p className="signoff-name">{currentSession.user.email?.split('@')[0] || 'Alex Rivera'}</p>
                      <p style={{ fontSize: '12.5px', color: 'var(--text-tertiary)' }}>Strategic Partnerships · SprintX</p>
                    </div>
                  </div>
                </section>

                {/* Floating Bottom Actions & AI Revision Dock */}
                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="action-row">
                    <button
                      className="primary-cta-btn"
                      style={{ flex: 1, height: '40px' }}
                      type="button"
                      onClick={handleInsertDraft}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>send</span>
                      <span>{insertFeedback}</span>
                    </button>
                    <button className="btn-secondary" type="button" onClick={handleCopyDraft}>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>content_copy</span>
                      <span>{copyFeedback}</span>
                    </button>
                  </div>

                  {/* Revisions Capsule */}
                  <div className="input-capsule">
                    <span className="material-symbols-outlined" style={{ color: 'var(--accent-spark)', fontSize: '18px' }}>
                      auto_awesome
                    </span>
                    <input
                      className="capsule-input"
                      type="text"
                      placeholder="Prompt revision (e.g., make it shorter, ROI focus)..."
                      value={revisionPrompt}
                      onChange={(e) => setRevisionPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleApplyRevision();
                      }}
                    />
                    <button
                      className="capsule-send-btn"
                      type="button"
                      onClick={handleApplyRevision}
                      disabled={!revisionPrompt.trim() || drafting}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_upward</span>
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* TAB 3: LIVE CHAT / ASSISTANT */}
            {activeTab === 'live-chat' && (
              <>
                <div className="context-bar">
                  <div className="context-left">
                    <span className="status-dot"></span>
                    <span className="context-title">Browsing: acme-corp.com/rfp-2025</span>
                  </div>
                  <span className="context-tag">Synced</span>
                </div>

                {/* Conversation Thread */}
                <div className="thread-container">
                  {/* Default welcome insight if no messages */}
                  {messages.length === 0 && (
                    <div className="message-cluster">
                      <div className="message-sender">
                        <span className="material-symbols-outlined fill" style={{ color: 'var(--primary)', fontSize: '16px' }}>
                          auto_awesome
                        </span>
                        <span>SprintX</span>
                      </div>
                      <div className="assistant-content">
                        <p>
                          I parsed the active RFP page. Key points include <strong style={{ color: 'var(--on-surface)' }}>4 core deliverables</strong>, multi-cloud target specifications, and a submission deadline of <strong style={{ color: 'var(--on-surface)' }}>Nov 18</strong>.
                        </p>
                        <div className="pill-cluster">
                          <button
                            className="action-pill"
                            type="button"
                            onClick={() => {
                              setDraft({
                                ...draft,
                                audience: 'Acme Corp Evaluation Committee',
                                objective: 'Submit container migration & SLA compliance proposal response',
                              });
                              setActiveTab('live-drafts');
                              handleGenerateDraft();
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ color: 'var(--accent-spark)', fontSize: '14px' }}>auto_awesome</span>
                            <span>Draft proposal response</span>
                          </button>
                          <button
                            className="action-pill"
                            type="button"
                            onClick={() => {
                              setQuestion('What are the compliance and security risks identified on this page?');
                              setTimeout(() => handleAsk(), 100);
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ color: 'var(--secondary)', fontSize: '14px' }}>checklist</span>
                            <span>Review compliance risks</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Render conversation timeline */}
                  {messages.map((msg) => (
                    <div key={msg.id} className="message-cluster">
                      {msg.role === 'user' ? (
                        <div className="user-bubble">{msg.content}</div>
                      ) : (
                        <>
                          <div className="message-sender">
                            <span className="material-symbols-outlined fill" style={{ color: 'var(--primary)', fontSize: '16px' }}>
                              auto_awesome
                            </span>
                            <span>SprintX</span>
                          </div>
                          <div className="assistant-content">
                            <p style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                            {msg.citations && msg.citations.length > 0 && (
                              <div className="pill-cluster">
                                {msg.citations.map((c, i) => (
                                  <button
                                    key={i}
                                    className="action-pill"
                                    type="button"
                                    onClick={() => setActiveCitation(c)}
                                    title={c.snippet}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>description</span>
                                    <span>{c.title}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ))}

                  {/* Clean Bento Summary Card */}
                  <div className="bento-card">
                    <div className="bento-item">
                      <span className="material-symbols-outlined bento-icon">check_circle</span>
                      <div className="bento-content">
                        <div className="bento-heading">Automated Schema Sync Engine</div>
                        <div className="bento-subtext">Migrates 40% faster with automated rollback safeguards.</div>
                      </div>
                    </div>
                    <div className="bento-item">
                      <span className="material-symbols-outlined bento-icon">check_circle</span>
                      <div className="bento-content">
                        <div className="bento-heading">SOC2 Type II &amp; FedRAMP Ready</div>
                        <div className="bento-subtext">Pre-mapped directly to enterprise RFP compliance hurdles.</div>
                      </div>
                    </div>
                    <div className="bento-item">
                      <span className="material-symbols-outlined bento-icon">check_circle</span>
                      <div className="bento-content">
                        <div className="bento-heading">Dedicated Solutions Architect</div>
                        <div className="bento-subtext">15-minute emergency SLA commitment across standard business tiers.</div>
                      </div>
                    </div>
                    <div className="bento-actions">
                      <button
                        className="variants-btn"
                        type="button"
                        onClick={() => {
                          setActiveTab('live-drafts');
                          handleGenerateDraft();
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add_to_photos</span>
                        <span>Add to Draft</span>
                      </button>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          className="icon-btn"
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText('Automated Schema Sync Engine • SOC2 Type II & FedRAMP Ready • Dedicated Solutions Architect');
                            setStatusFeedback('Copied summary to clipboard');
                            setTimeout(() => setStatusFeedback(''), 2000);
                          }}
                          title="Copy summary"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>content_copy</span>
                        </button>
                        <button className="icon-btn" type="button" title="Good response">
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>thumb_up</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Active Draft Drawer Card */}
                  <div className="draft-card-accordion">
                    <div className="accordion-header" onClick={() => setIsDrawerOpen((prev) => !prev)}>
                      <div className="accordion-left">
                        <span className="material-symbols-outlined" style={{ color: 'var(--secondary)', fontSize: '18px' }}>description</span>
                        <span className="accordion-title">Active Proposal Draft</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>v1.2</span>
                      </div>
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: '18px',
                          color: 'var(--secondary)',
                          transform: isDrawerOpen ? 'rotate(0deg)' : 'rotate(180deg)',
                          transition: 'transform 0.2s ease',
                        }}
                      >
                        expand_less
                      </span>
                    </div>
                    {isDrawerOpen && (
                      <>
                        <div className="accordion-preview">
                          “SprintX proposes a 3-phased dual-run container migration with zero disruption to transactional pipelines. Leveraging autonomous schema translation...”
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <button
                            className="variants-btn"
                            type="button"
                            onClick={() => setActiveTab('live-drafts')}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>edit_document</span>
                            <span>Expand editor</span>
                          </button>
                          <button
                            className="primary-cta-btn"
                            style={{ height: '32px', padding: '0 12px', fontSize: '12px' }}
                            type="button"
                            onClick={handleInsertDraft}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>tab_move</span>
                            <span>Insert to page</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Floating Bottom Input Dock */}
                <div style={{ marginTop: '8px', position: 'relative' }}>
                  {showPopover && (
                    <div className="popover-menu">
                      <button
                        className="popover-item"
                        type="button"
                        onClick={() => {
                          setShowPopover(false);
                          setStatusFeedback('Document selected');
                          setTimeout(() => setStatusFeedback(''), 1500);
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>upload_file</span>
                        <span>Upload document</span>
                      </button>
                      <button
                        className="popover-item"
                        type="button"
                        onClick={() => {
                          setShowPopover(false);
                          setStatusFeedback('Screenshot captured');
                          setTimeout(() => setStatusFeedback(''), 1500);
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>screenshot_monitor</span>
                        <span>Attach screenshot</span>
                      </button>
                      <button
                        className="popover-item"
                        type="button"
                        onClick={() => {
                          setShowPopover(false);
                          setStatusFeedback('Page element selected');
                          setTimeout(() => setStatusFeedback(''), 1500);
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>ads_click</span>
                        <span>Select page element</span>
                      </button>
                    </div>
                  )}

                  <div className="input-capsule">
                    <button
                      className="icon-btn"
                      type="button"
                      onClick={() => setShowPopover((prev) => !prev)}
                      aria-label="Add attachment"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>add</span>
                    </button>
                    <input
                      className="capsule-input"
                      type="text"
                      placeholder="Ask SprintX about this page..."
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleAsk();
                        }
                      }}
                    />
                    <button
                      className="icon-btn"
                      type="button"
                      title="Voice input"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>mic</span>
                    </button>
                    <button
                      className="capsule-send-btn"
                      type="button"
                      onClick={() => handleAsk()}
                      disabled={!question.trim() || asking}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_upward</span>
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* TAB 4: TEMPLATE LIBRARY */}
            {activeTab === 'prompt-templates' && (
              <>
                <div className="context-bar">
                  <div className="context-left">
                    <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '16px' }}>bookmarks</span>
                    <span className="context-title">SprintX Outreach Library</span>
                  </div>
                  <span className="context-tag">4 Templates</span>
                </div>

                <div className="template-grid">
                  <div
                    className="template-card"
                    onClick={() => {
                      setDraft({
                        type: 'cold-email',
                        audience: 'Early-Stage B2B SaaS Founder',
                        objective: 'Offer a high-velocity engineering sprint to accelerate MVP delivery',
                        tone: 'persuasive',
                        length: 'short',
                        context: 'Focus on 2-week turnarounds, vetted full-stack senior architects, and fractional flexibility.',
                      });
                      setActiveTab('live-drafts');
                      handleGenerateDraft();
                    }}
                  >
                    <span className="template-badge">SaaS Founders</span>
                    <h3 className="template-name">MVP Velocity Sprint</h3>
                    <p className="template-desc">High-conversion cold email offering dedicated sprint teams for seed/Series A founders racing to market.</p>
                  </div>

                  <div
                    className="template-card"
                    onClick={() => {
                      setDraft({
                        type: 'linkedin',
                        audience: 'VP of Engineering at a High-Growth Scaleup',
                        objective: 'Discuss fractional developer capacity to unblock roadmap bottlenecks',
                        tone: 'professional',
                        length: 'medium',
                        context: 'Highlight 40% lower onboarding latency, zero management overhead, and proven microservices delivery.',
                      });
                      setActiveTab('live-drafts');
                      handleGenerateDraft();
                    }}
                  >
                    <span className="template-badge">Networking</span>
                    <h3 className="template-name">Engineering Capacity Inquiry</h3>
                    <p className="template-desc">Concise LinkedIn outreach targeting engineering leads facing backlog pressure.</p>
                  </div>

                  <div
                    className="template-card"
                    onClick={() => {
                      setDraft({
                        type: 'proposal',
                        audience: 'Enterprise RFP Procurement Lead',
                        objective: 'Highlight SOC2 compliance, 80ms SLA targets, and zero-downtime cutover architecture',
                        tone: 'professional',
                        length: 'long',
                        context: 'Detailed technical proof points mapped directly to enterprise security questionnaires.',
                      });
                      setActiveTab('live-drafts');
                      handleGenerateDraft();
                    }}
                  >
                    <span className="template-badge">Enterprise RFQ</span>
                    <h3 className="template-name">Cloud Modernization Response</h3>
                    <p className="template-desc">Comprehensive proposal response focusing on reliability, data sovereignty, and dual-run migration.</p>
                  </div>

                  <div
                    className="template-card"
                    onClick={() => {
                      setDraft({
                        type: 'follow-up',
                        audience: 'Prospect who attended SprintX Technical Walkthrough',
                        objective: 'Recap architecture benefits and propose 8-minute pilot milestone schedule',
                        tone: 'friendly',
                        length: 'short',
                        context: 'Address migration risk concerns with references to our 41% latency improvement case studies.',
                      });
                      setActiveTab('live-drafts');
                      handleGenerateDraft();
                    }}
                  >
                    <span className="template-badge">Post-Demo</span>
                    <h3 className="template-name">Executive Post-Demo Recap</h3>
                    <p className="template-desc">Keeps momentum strong after initial stakeholder briefings with concrete next steps.</p>
                  </div>
                </div>
              </>
            )}

            {error && <div className="error-banner">{error}</div>}
          </div>
        )}
      </main>

      {/* 3. Fixed Bottom Navigation Bar */}
      {currentSession && (
        <nav className="bottom-nav">
          <div className="bottom-nav-inner">
            <button
              className={`nav-tab-item ${activeTab === 'live-chat' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveTab('live-chat')}
            >
              <span className={`material-symbols-outlined ${activeTab === 'live-chat' ? 'fill' : ''}`}>
                chat_bubble_outline
              </span>
              <span className="nav-tab-label">Assistant</span>
            </button>

            <button
              className={`nav-tab-item ${activeTab === 'live-drafts' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveTab('live-drafts')}
            >
              <span className={`material-symbols-outlined ${activeTab === 'live-drafts' ? 'fill' : ''}`}>
                edit_note
              </span>
              <span className="nav-tab-label">Drafts</span>
            </button>

            <button
              className={`nav-tab-item ${activeTab === 'context-insights' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveTab('context-insights')}
            >
              <span className={`material-symbols-outlined ${activeTab === 'context-insights' ? 'fill' : ''}`}>
                insights
              </span>
              <span className="nav-tab-label">Insights</span>
            </button>

            <button
              className={`nav-tab-item ${activeTab === 'prompt-templates' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveTab('prompt-templates')}
            >
              <span className={`material-symbols-outlined ${activeTab === 'prompt-templates' ? 'fill' : ''}`}>
                bookmarks
              </span>
              <span className="nav-tab-label">Library</span>
            </button>
          </div>
        </nav>
      )}

      {/* Modal: Citation Preview */}
      {activeCitation && (
        <div className="modal-overlay" onClick={() => setActiveCitation(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--on-surface)' }}>{activeCitation.title}</h3>
              <button className="icon-btn" type="button" onClick={() => setActiveCitation(null)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p style={{ fontSize: '13.5px', color: 'var(--secondary)', lineHeight: 1.6 }}>{activeCitation.snippet}</p>
            <div style={{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}>Path: {activeCitation.path}</div>
          </div>
        </div>
      )}

      {/* Modal: History Drawer */}
      {showHistory && (
        <div className="modal-overlay" onClick={() => setShowHistory(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--on-surface)' }}>Conversations</h3>
              <button className="icon-btn" type="button" onClick={() => setShowHistory(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <button
              className="primary-cta-btn"
              style={{ height: '38px', fontSize: '13px' }}
              type="button"
              onClick={async () => {
                if (!currentSession?.access_token) return;
                const { conversation } = await createConversation(currentSession.access_token, 'New Conversation');
                setConversations((prev) => [conversation, ...prev]);
                setConversationId(conversation.id);
                setMessages([]);
                setShowHistory(false);
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
              <span>New Conversation</span>
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {conversations.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    background: c.id === conversationId ? 'var(--surface-container-high)' : 'var(--surface-container)',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                  }}
                  onClick={async () => {
                    setConversationId(c.id);
                    if (currentSession?.access_token) {
                      const res = await getConversationMessages(currentSession.access_token, c.id);
                      setMessages(res.messages);
                    }
                    setShowHistory(false);
                  }}
                >
                  <span style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--on-surface)' }}>{c.title}</span>
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!currentSession?.access_token) return;
                      await deleteConversation(currentSession.access_token, c.id);
                      setConversations((prev) => prev.filter((item) => item.id !== c.id));
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#ef4444' }}>delete</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Settings Drawer */}
      {showSettings && currentSession && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--on-surface)' }}>Workspace Settings</h3>
              <button className="icon-btn" type="button" onClick={() => setShowSettings(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '13px', color: 'var(--secondary)' }}>
                Account: <strong style={{ color: 'var(--on-surface)' }}>{currentSession.user.email}</strong> • Role: <strong style={{ color: 'var(--primary)' }}>{role ?? 'admin'}</strong>
              </div>

              {/* Gemini API Key */}
              <div className="form-group">
                <label className="form-label">Gemini API Key</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    className="form-input"
                    type="password"
                    placeholder="AIzaSy..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn-secondary"
                    type="button"
                    disabled={savingKey || !apiKeyInput.trim()}
                    onClick={async () => {
                      setSavingKey(true);
                      try {
                        await setGeminiKey(currentSession.access_token, apiKeyInput.trim());
                        setGeminiKeyConfigured(true);
                        setApiKeyInput('');
                        setStatusFeedback('Gemini API key saved');
                        setTimeout(() => setStatusFeedback(''), 2000);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Failed to save key');
                      } finally {
                        setSavingKey(false);
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* Drive & Site Sync */}
              {role === 'admin' && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn-secondary"
                    style={{ flex: 1 }}
                    type="button"
                    disabled={syncingDrive}
                    onClick={async () => {
                      setSyncingDrive(true);
                      setSyncFeedback('Syncing Drive...');
                      try {
                        await syncGoogleDrive(currentSession.access_token);
                        setSyncFeedback('Drive knowledge synced successfully!');
                      } catch (err) {
                        setSyncFeedback(err instanceof Error ? err.message : 'Sync failed');
                      } finally {
                        setSyncingDrive(false);
                      }
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>sync</span>
                    <span>Sync Google Drive</span>
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ flex: 1 }}
                    type="button"
                    onClick={async () => {
                      setStatusFeedback('Crawling site knowledge...');
                      try {
                        await crawlWebsites(currentSession.access_token);
                        setStatusFeedback('Websites crawled successfully!');
                      } catch (err) {
                        setStatusFeedback('Crawl failed');
                      }
                      setTimeout(() => setStatusFeedback(''), 2500);
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>travel_explore</span>
                    <span>Crawl Sites</span>
                  </button>
                </div>
              )}
              {syncFeedback && <p style={{ fontSize: '12px', color: 'var(--primary)' }}>{syncFeedback}</p>}

              {/* Local Code Sync */}
              <div style={{ background: 'var(--surface-container)', padding: '12px', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--on-surface)' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--primary)' }}>download</span>
                  <span>Sync to Local Workspace</span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--secondary)', lineHeight: 1.4 }}>
                  Download the latest 4 modified UI files directly to extract into your project.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <a
                    href="/update-files.tar.gz"
                    download="update-files.tar.gz"
                    className="primary-cta-btn"
                    style={{ height: '34px', fontSize: '12px', textDecoration: 'none', flex: 1 }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>archive</span>
                    <span>Download update-files.tar.gz</span>
                  </a>
                </div>
              </div>

              <button
                className="btn-secondary"
                style={{ width: '100%', color: '#ef4444', borderColor: '#fecaca', justifyContent: 'center' }}
                type="button"
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
