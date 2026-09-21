import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../extension/src/App';
import '../../extension/src/styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('SprintX root element is missing.');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
