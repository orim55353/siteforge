/**
 * Normalize a US phone number to E.164 format: +1XXXXXXXXXX
 * Returns null if the input can't be parsed as a 10-digit US number.
 */
export function normalizePhone(raw: string): string | null {
  // Strip everything except digits and leading +
  const digits = raw.replace(/[^\d]/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  // Already has country code or is international — return as-is with +
  if (digits.length > 10) {
    return `+${digits}`;
  }

  // Too short — can't normalize
  return null;
}
