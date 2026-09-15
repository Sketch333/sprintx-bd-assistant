import test from 'node:test';
import assert from 'node:assert/strict';

import { extractReadableTextFromHtml } from '../src/lib/ingest';

test('extractReadableTextFromHtml ignores JSON payload noise and keeps visible text', () => {
  const html = `
    <html>
      <body>
        <script>window.__DATA__ = {"shipping_services":"Delivery & Shipping Services"}</script>
        <main>
          <h1>SprintX</h1>
          <p>We build high-converting websites, SaaS products, and mobile apps for startups and enterprises.</p>
        </main>
      </body>
    </html>
  `;

  const text = extractReadableTextFromHtml(html);
  assert.match(text, /SprintX/i);
  assert.doesNotMatch(text, /shipping_services/i);
  assert.match(text, /high-converting websites/i);
});
