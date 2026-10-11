import assert from 'node:assert/strict';
import test from 'node:test';
import { getMeetupTime } from './meetup-time.js';

test('starts the meetup at 8 PM India time', () => {
  assert.deepEqual(getMeetupTime(new Date('2026-10-11T14:29:00.000Z')), {
    eventDate: '2026-10-11',
    started: false,
  });
  assert.deepEqual(getMeetupTime(new Date('2026-10-11T14:30:00.000Z')), {
    eventDate: '2026-10-11',
    started: true,
  });
});

test('uses the India calendar date for the daily meetup', () => {
  assert.deepEqual(getMeetupTime(new Date('2026-10-11T18:30:00.000Z')), {
    eventDate: '2026-10-12',
    started: false,
  });
});
