import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('SprintX root element is missing.');

const root = createRoot(rootElement);
root.render(<main className="shell centered">Opening SprintX...</main>);

import('./App')
  .then(({ App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    console.error('SprintX startup failed', error);
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    root.render(
      <main className="shell centered">
        <section className="card startup-error" role="alert">
          <h1>SprintX could not start</h1>
          <p className="muted">{message}</p>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>Retry</button>
        </section>
      </main>,
    );
  });
