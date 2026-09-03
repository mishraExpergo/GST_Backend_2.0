export type GeographicRiskLabel =
  | 'VERY_LOW'
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'VERY_HIGH';

export interface GeographicRiskBand {
  maxExclusive: number | null;
  label: GeographicRiskLabel;
  score: number;
}

export const FACTOR_SCORE_BY_LABEL: Record<GeographicRiskLabel, number> = {
  VERY_LOW: 10,
  LOW: 30,
  MEDIUM: 50,
  HIGH: 75,
  VERY_HIGH: 100,
};

/** Purchase, revenue, GSTIN cancelled/suspended share bands. */
export const CONCENTRATION_BANDS: GeographicRiskBand[] = [
  { maxExclusive: 10, label: 'VERY_LOW', score: 10 },
  { maxExclusive: 20, label: 'LOW', score: 30 },
  { maxExclusive: 30, label: 'MEDIUM', score: 50 },
  { maxExclusive: 40, label: 'HIGH', score: 75 },
  { maxExclusive: null, label: 'VERY_HIGH', score: 100 },
];

/** Tax stress, delayed filing, active notices share bands. */
export const STRESS_BANDS: GeographicRiskBand[] = [
  { maxExclusive: 5, label: 'VERY_LOW', score: 10 },
  { maxExclusive: 10, label: 'LOW', score: 30 },
  { maxExclusive: 20, label: 'MEDIUM', score: 50 },
  { maxExclusive: 30, label: 'HIGH', score: 75 },
  { maxExclusive: null, label: 'VERY_HIGH', score: 100 },
];

export const COMPOSITE_LEVEL_BANDS: GeographicRiskBand[] = [
  { maxExclusive: 19, label: 'VERY_LOW', score: 10 },
  { maxExclusive: 39, label: 'LOW', score: 30 },
  { maxExclusive: 59, label: 'MEDIUM', score: 50 },
  { maxExclusive: 74, label: 'HIGH', score: 75 },
  { maxExclusive: null, label: 'VERY_HIGH', score: 100 },
];

export const GEOGRAPHIC_FACTOR_WEIGHTS = {
  taxStress: 0.3,
  revenue: 0.3,
  delayedFiling: 0.15,
  legalNotices: 0.15,
  purchase: 0.05,
  gstin: 0.05,
} as const;

export const GSTIN_STATE_NAMES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};
