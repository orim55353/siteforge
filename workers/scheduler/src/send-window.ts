import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { getDay, setHours, setMinutes, setSeconds, setMilliseconds, addDays } from "date-fns";

/** Tue=2, Wed=3, Thu=4 */
const SEND_DAYS = new Set([2, 3, 4]);

/** 9:00 AM */
const WINDOW_START_HOUR = 9;
const WINDOW_START_MIN = 0;

/** 10:30 AM */
const WINDOW_END_HOUR = 10;
const WINDOW_END_MIN = 30;

/**
 * Calculate the next Tue/Wed/Thu 9:00–10:30 AM window in the given timezone.
 *
 * Returns a Date (UTC) representing a random moment within the next valid
 * send window. The randomness spreads emails across the 90-minute window
 * to avoid all going out at exactly 9:00 AM.
 */
export function getNextSendWindow(timezone: string, fromDate?: Date): Date {
  const now = fromDate ?? new Date();

  // Convert current UTC time to the business's local time
  let local = toZonedTime(now, timezone);

  // Start searching from tomorrow to guarantee a future send time
  local = addDays(local, 1);

  // Find the next Tue/Wed/Thu (at most 7 days away)
  for (let i = 0; i < 7; i++) {
    if (SEND_DAYS.has(getDay(local))) break;
    local = addDays(local, 1);
  }

  // Set to the start of the send window in the business timezone
  local = setMilliseconds(
    setSeconds(
      setMinutes(
        setHours(local, WINDOW_START_HOUR),
        WINDOW_START_MIN,
      ),
      0,
    ),
    0,
  );

  // Add a random offset within the 90-minute window (0–90 min)
  const windowMs =
    (WINDOW_END_HOUR - WINDOW_START_HOUR) * 60 * 60 * 1000 +
    (WINDOW_END_MIN - WINDOW_START_MIN) * 60 * 1000;
  const randomOffset = Math.floor(Math.random() * windowMs);
  local = new Date(local.getTime() + randomOffset);

  // Convert the local time back to UTC
  return fromZonedTime(local, timezone);
}
