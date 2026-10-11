import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreGunaMilan, type KundaliChart } from './kundali.js';

const chart = (
  nakshatra: number,
  rashi: number,
  yoni: number,
): KundaliChart => ({ nakshatra, rashi, yoni, gana: 'deva' });

test('scores an identical chart pair consistently', () => {
  const result = scoreGunaMilan(chart(0, 0, 0), chart(0, 0, 0));

  assert.equal(result.total, 25);
  assert.deepEqual(result.breakdown, {
    varna: 1,
    vashya: 2,
    tara: 0,
    yoni: 4,
    grahaMaitri: 5,
    gana: 6,
    bhakoot: 7,
    nadi: 0,
  });
});

test('returns all 36 points for a fully compatible sample pair', () => {
  const result = scoreGunaMilan(chart(0, 0, 0), chart(26, 0, 0));

  assert.equal(result.total, 36);
  assert.deepEqual(result.breakdown, {
    varna: 1,
    vashya: 2,
    tara: 3,
    yoni: 4,
    grahaMaitri: 5,
    gana: 6,
    bhakoot: 7,
    nadi: 8,
  });
});

test('scores a mixed compatibility sample and is symmetric', () => {
  const first = chart(0, 0, 0);
  const second = { ...chart(1, 1, 1), gana: 'manushya' as const };
  const forward = scoreGunaMilan(first, second);
  const reverse = scoreGunaMilan(second, first);

  assert.equal(forward.total, 24);
  assert.deepEqual(forward, reverse);
});
