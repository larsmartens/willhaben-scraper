import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedOrigin, authenticate, sha256 } from '../src/auth.js';

test('personal capabilities fail closed and authenticate only the exact token', async () => {
  const token = 'a'.repeat(43), expected = await sha256(token);
  assert.equal(await authenticate(new Request(`https://example.test/personal/${token}/mcp`), expected), 'personal-owner');
  assert.equal(await authenticate(new Request('https://example.test/mcp', { headers: { Authorization: `Bearer ${token}` } }), expected), 'personal-owner');
  assert.equal(await authenticate(new Request(`https://example.test/personal/${'b'.repeat(43)}/mcp`), expected), null);
  assert.equal(await authenticate(new Request(`https://example.test/personal/${token}/mcp`), undefined), null);
  assert.equal(await authenticate(new Request('https://example.test/mcp'), expected), null);
});

test('origin validation rejects suffix attacks and unrelated browser origins', () => {
  for (const origin of ['https://chatgpt.com', 'https://chat.openai.com', 'https://example.test']) {
    assert.equal(allowedOrigin(new Request('https://example.test/mcp', { headers: { Origin: origin } })), true);
  }
  for (const origin of ['https://chatgpt.com.evil.test', 'http://chatgpt.com', 'https://evil.test', 'null']) {
    assert.equal(allowedOrigin(new Request('https://example.test/mcp', { headers: { Origin: origin } })), false);
  }
});
