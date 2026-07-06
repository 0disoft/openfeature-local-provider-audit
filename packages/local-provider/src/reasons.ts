export const EVALUATION_REASONS = {
  STATIC: "STATIC",
  DEFAULT: "DEFAULT",
  ENV_OVERRIDE: "ENV_OVERRIDE",
  SPLIT: "SPLIT",
  ERROR: "ERROR"
} as const;

export type EvaluationReason = (typeof EVALUATION_REASONS)[keyof typeof EVALUATION_REASONS];

export const EVALUATION_SOURCES = {
  FILE: "file",
  ENV: "env",
  DEFAULT: "default",
  ERROR: "error"
} as const;

export type EvaluationSource = (typeof EVALUATION_SOURCES)[keyof typeof EVALUATION_SOURCES];
