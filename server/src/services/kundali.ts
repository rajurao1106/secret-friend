export type Gana = 'deva' | 'manushya' | 'rakshasa';
export type Vashya = 'chatushpada' | 'dwipada' | 'jalachara' | 'vanachara' | 'keeta';

export interface KundaliChart {
  readonly nakshatra: number;
  readonly rashi: number;
  readonly gana: Gana;
  readonly yoni: number;
}

export interface BirthDetails {
  readonly dob: string;
  readonly birthTime: string;
  readonly lat: number;
  readonly lng: number;
  readonly timezone: string;
}

export interface KundaliService {
  readonly configured: boolean;
  getChart(details: BirthDetails): Promise<KundaliChart>;
}

export interface GunaBreakdown {
  readonly varna: number;
  readonly vashya: number;
  readonly tara: number;
  readonly yoni: number;
  readonly grahaMaitri: number;
  readonly gana: number;
  readonly bhakoot: number;
  readonly nadi: number;
}

const nakshatraGanas: readonly Gana[] = [
  'deva',
  'manushya',
  'rakshasa',
  'deva',
  'rakshasa',
  'manushya',
  'deva',
  'deva',
  'rakshasa',
  'rakshasa',
  'manushya',
  'deva',
  'rakshasa',
  'deva',
  'rakshasa',
  'rakshasa',
  'deva',
  'rakshasa',
  'manushya',
  'manushya',
  'manushya',
  'rakshasa',
  'rakshasa',
  'manushya',
  'manushya',
  'manushya',
  'deva',
];

export function chartForCoordinates(
  chart: Omit<KundaliChart, 'gana'> & { readonly gana?: Gana },
): KundaliChart {
  if (
    !Number.isInteger(chart.nakshatra) ||
    chart.nakshatra < 0 ||
    chart.nakshatra > 26 ||
    !Number.isInteger(chart.rashi) ||
    chart.rashi < 0 ||
    chart.rashi > 11 ||
    !Number.isInteger(chart.yoni) ||
    chart.yoni < 0 ||
    chart.yoni > 13
  ) {
    throw new RangeError('Kundali chart attributes are out of range');
  }

  return {
    ...chart,
    gana: chart.gana ?? nakshatraGanas[chart.nakshatra] ?? 'manushya',
  };
}

export class UnconfiguredKundaliService implements KundaliService {
  readonly configured = false;

  async getChart(_details: BirthDetails): Promise<KundaliChart> {
    throw new Error(
      'No Kundali chart provider is configured; scoring is available for supplied chart data',
    );
  }
}

const yoniEnemies = new Set([
  '0:8',
  '1:13',
  '2:11',
  '3:12',
  '4:10',
  '5:6',
  '7:9',
]);
const friendlyPlanets: Readonly<Record<string, readonly string[]>> = {
  sun: ['moon', 'mars', 'jupiter'],
  moon: ['sun', 'mercury'],
  mars: ['sun', 'moon', 'jupiter'],
  mercury: ['sun', 'venus'],
  jupiter: ['sun', 'moon', 'mars'],
  venus: ['mercury', 'saturn'],
  saturn: ['mercury', 'venus'],
};
const enemyPlanets: Readonly<Record<string, readonly string[]>> = {
  sun: ['venus', 'saturn'],
  moon: [],
  mars: ['mercury'],
  mercury: ['moon'],
  jupiter: ['mercury', 'venus'],
  venus: ['sun', 'moon'],
  saturn: ['sun', 'moon', 'mars'],
};
const signLords = [
  'mars',
  'venus',
  'mercury',
  'moon',
  'sun',
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
  'saturn',
  'jupiter',
] as const;
const signVarnas = [1, 2, 3, 0, 1, 3, 2, 1, 0, 2, 3, 0] as const;
const signVashyas: readonly Vashya[] = [
  'chatushpada',
  'chatushpada',
  'dwipada',
  'dwipada',
  'chatushpada',
  'dwipada',
  'dwipada',
  'keeta',
  'chatushpada',
  'chatushpada',
  'dwipada',
  'jalachara',
];

function taraPoints(from: number, to: number): number {
  const count = ((to - from + 27) % 27) + 1;
  const tara = (count - 1) % 9;
  return [1, 3, 5, 7, 8].includes(tara) ? 1.5 : 0;
}

function varnaPoints(chartA: KundaliChart, chartB: KundaliChart): number {
  const difference = Math.abs(
    (signVarnas[chartA.rashi] ?? 0) - (signVarnas[chartB.rashi] ?? 0),
  );
  return difference === 0 ? 1 : difference === 1 ? 0.5 : 0;
}

function vashyaPoints(chartA: KundaliChart, chartB: KundaliChart): number {
  const first = signVashyas[chartA.rashi];
  const second = signVashyas[chartB.rashi];
  if (first === second) return 2;
  if (
    (first === 'chatushpada' && second === 'dwipada') ||
    (first === 'dwipada' && second === 'chatushpada') ||
    (first === 'dwipada' && second === 'jalachara') ||
    (first === 'jalachara' && second === 'dwipada')
  ) {
    return 1;
  }
  if (first === 'keeta' || second === 'keeta') {
    return first === 'jalachara' || second === 'jalachara' ? 1 : 0;
  }
  return 0.5;
}

function yoniPoints(chartA: KundaliChart, chartB: KundaliChart): number {
  if (chartA.yoni === chartB.yoni) return 4;
  const first = Math.min(chartA.yoni, chartB.yoni);
  const second = Math.max(chartA.yoni, chartB.yoni);
  return yoniEnemies.has(`${first}:${second}`) ? 0 : 2;
}

function planetRelationship(first: string, second: string): 'friend' | 'enemy' | 'neutral' {
  if (first === second) return 'friend';
  if (friendlyPlanets[first]?.includes(second)) return 'friend';
  if (enemyPlanets[first]?.includes(second)) return 'enemy';
  return 'neutral';
}

function grahaMaitriPoints(chartA: KundaliChart, chartB: KundaliChart): number {
  const first = signLords[chartA.rashi];
  const second = signLords[chartB.rashi];
  if (first === undefined || second === undefined) return 0;
  const relationA = planetRelationship(first, second);
  const relationB = planetRelationship(second, first);
  if (relationA === 'friend' && relationB === 'friend') return 5;
  if (
    (relationA === 'friend' && relationB === 'neutral') ||
    (relationA === 'neutral' && relationB === 'friend')
  ) {
    return 4;
  }
  if (relationA === 'neutral' && relationB === 'neutral') return 3;
  if (
    (relationA === 'friend' && relationB === 'enemy') ||
    (relationA === 'enemy' && relationB === 'friend')
  ) {
    return 1;
  }
  if (relationA === 'enemy' && relationB === 'enemy') return 0;
  return 0.5;
}

function ganaPoints(chartA: KundaliChart, chartB: KundaliChart): number {
  if (chartA.gana === chartB.gana) return 6;
  const pair = [chartA.gana, chartB.gana].sort().join(':');
  if (pair === 'deva:manushya') return 5;
  if (pair === 'deva:rakshasa') return 1;
  return 0;
}

function bhakootPoints(chartA: KundaliChart, chartB: KundaliChart): number {
  const distance = Math.abs(chartA.rashi - chartB.rashi);
  const normalized = Math.min(distance, 12 - distance);
  return [1, 4, 5].includes(normalized) ? 0 : 7;
}

function nadiPoints(chartA: KundaliChart, chartB: KundaliChart): number {
  return chartA.nakshatra % 3 === chartB.nakshatra % 3 ? 0 : 8;
}

export function scoreGunaMilan(
  chartA: KundaliChart,
  chartB: KundaliChart,
): { readonly total: number; readonly breakdown: GunaBreakdown } {
  chartA = chartForCoordinates(chartA);
  chartB = chartForCoordinates(chartB);
  const breakdown: GunaBreakdown = {
    varna: varnaPoints(chartA, chartB),
    vashya: vashyaPoints(chartA, chartB),
    tara: taraPoints(chartA.nakshatra, chartB.nakshatra) +
      taraPoints(chartB.nakshatra, chartA.nakshatra),
    yoni: yoniPoints(chartA, chartB),
    grahaMaitri: grahaMaitriPoints(chartA, chartB),
    gana: ganaPoints(chartA, chartB),
    bhakoot: bhakootPoints(chartA, chartB),
    nadi: nadiPoints(chartA, chartB),
  };

  const total = Math.round(
    Object.values(breakdown).reduce((sum, points) => sum + points, 0),
  );
  return { total: Math.min(total, 36), breakdown };
}

export class GunaMilanService {
  score(
    chartA: KundaliChart,
    chartB: KundaliChart,
  ): { readonly total: number; readonly breakdown: GunaBreakdown } {
    return scoreGunaMilan(chartA, chartB);
  }
}
