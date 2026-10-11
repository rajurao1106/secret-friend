import assert from 'node:assert/strict';
import test from 'node:test';
import { containsPersonalInfo } from './anonymity-warning.js';

test('flags phone numbers, emails and social handles', () => {
  assert.equal(containsPersonalInfo('Call me at +91 98765 43210'), true);
  assert.equal(containsPersonalInfo('mail me at friend@example.com'), true);
  assert.equal(containsPersonalInfo('Instagram: secret.friend'), true);
  assert.equal(containsPersonalInfo('I like long walks and music'), false);
});
