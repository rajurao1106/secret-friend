import assert from 'node:assert/strict';
import test from 'node:test';
import { isAdult } from './profile-validation.js';

test('accepts a birth date on the eighteenth birthday', () => {
  assert.equal(isAdult('2008-10-11', new Date('2026-10-11T10:00:00.000Z')), true);
});

test('rejects a birth date one day short of eighteen', () => {
  assert.equal(isAdult('2008-10-12', new Date('2026-10-11T10:00:00.000Z')), false);
});

test('rejects impossible calendar dates', () => {
  assert.equal(isAdult('2000-02-30'), false);
});
