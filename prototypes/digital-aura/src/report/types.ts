/**
 * Report model for the mockup. The backend result contract (agent-runtime
 * `PersonalityCardData`) currently exposes only `career_groups`, `strengths` and `tendencies`;
 * majors, fit scores, reasons and admission blocks below are what the report design needs, so
 * they are the proposal for extending that contract. Everything is sample data for now.
 */

export interface TopMajor {
  /** Career group, e.g. "Truyền thông – Sáng tạo". Maps to today's `career_groups`. */
  group: string;
  name: string;
  /** 0–100 fit score. Shown as a tier by default; the raw number is optional. */
  score: number;
  /** Indices into the card's strengths: why this major fits. */
  because: readonly number[];
  description: string;
  /** Vietnamese university admission subject blocks, e.g. "D01". */
  blocks: readonly string[];
  careers: readonly string[];
}

export interface OtherMajor {
  name: string;
  score: number;
}

export interface ReportData {
  /** ISO date the result was produced. */
  createdAt: string;
  isDemo: boolean;
  majors: readonly [TopMajor, TopMajor, TopMajor];
  others: readonly OtherMajor[];
}

export type FitTier = 'very-high' | 'high' | 'consider';

export const fitTier = (score: number): FitTier =>
  score >= 85 ? 'very-high' : score >= 75 ? 'high' : 'consider';

export const tierLabel: Record<FitTier, string> = {
  'very-high': 'Rất phù hợp',
  high: 'Phù hợp',
  consider: 'Đáng cân nhắc',
};

/** Subject blocks shown in the expanded major (sample of the common national blocks). */
export const blockSubjects: Record<string, string> = {
  A00: 'Toán, Lý, Hoá',
  A01: 'Toán, Lý, Anh',
  B00: 'Toán, Hoá, Sinh',
  C00: 'Văn, Sử, Địa',
  D01: 'Văn, Toán, Anh',
  D07: 'Toán, Hoá, Anh',
  D14: 'Văn, Sử, Anh',
  D15: 'Văn, Địa, Anh',
  H00: 'Văn, Năng khiếu vẽ',
  N00: 'Văn, Năng khiếu âm nhạc',
  V00: 'Toán, Lý, Vẽ',
};
