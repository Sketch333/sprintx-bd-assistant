import test from 'node:test';
import assert from 'node:assert/strict';

import { createUser, getUserApiKey, setUserApiKey } from '../src/lib/user-store';

test('user store encrypts and retrieves a Gemini API key per user', async () => {
  const user = await createUser({ email: 'intern@example.com', name: 'Intern One', role: 'intern' });
  const updatedUser = await setUserApiKey(user.id, 'test-gemini-key');
  const storedKey = await getUserApiKey(user.id);

  assert.ok(updatedUser.apiKeyEncrypted);
  assert.equal(storedKey, 'test-gemini-key');
});
