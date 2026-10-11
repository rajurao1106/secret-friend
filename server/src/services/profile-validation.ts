export function isAdult(dob: string, now = new Date()): boolean {
  const parsed = new Date(`${dob}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dob) {
    return false;
  }

  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()),
  );
  return parsed.getTime() <= cutoff.getTime();
}
