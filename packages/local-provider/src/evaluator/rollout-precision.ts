export function hasRolloutPrecision(value: number): boolean {
  const scaled = value * 1_000;
  // Multiplication error grows with magnitude. Keep the existing small-value floor.
  const tolerance = Number.EPSILON * Math.max(1_000, Math.abs(scaled));
  return Math.abs(scaled - Math.round(scaled)) <= tolerance;
}
