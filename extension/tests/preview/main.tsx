import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../src/App';
import '../../src/styles.css';
createRoot(document.getElementById('root')!).render(<><aside style={{ padding: '8px 14px', fontSize: 12, textAlign: 'center', background: 'var(--accent-soft)', color: 'var(--ink)', borderBottom: '1px solid var(--line)' }}>Synthetic data preview · mocked sign-in and API · no provider requests</aside><App /></>);
