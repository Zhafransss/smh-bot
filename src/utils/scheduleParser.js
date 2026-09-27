const { OPERATIONAL_DATA, toHour24Candidates } = require('../matchers/operationalMatcher');

/**
 * Parse a customer's free-text home service request ("Senin jam 10", "besok jam 2 siang",
 * "28/09 jam 13.00") into the fields POST /api/home-service requires:
 * tanggal (YYYY-MM-DD), waktuMulai & waktuSelesai (HH:mm).
 *
 * This is only the customer's REQUESTED slot — the admin confirms or reschedules it later,
 * so an ambiguous input is resolved to the nearest reasonable slot instead of being rejected.
 * All dates are calendar days in WIB (Asia/Jakarta), independent of the server timezone.
 */

const TIMEZONE = 'Asia/Jakarta';
const DEFAULT_SLOT_MINUTES = 120;
const MAX_DAYS_AHEAD = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const START_MINUTES = OPERATIONAL_DATA.homeServiceStartHour * 60;
const END_MINUTES = OPERATIONAL_DATA.homeServiceEndHour * 60;

const WEEKDAYS = { minggu: 0, ahad: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6 };

const MONTHS = {
  januari: 1, jan: 1, februari: 2, feb: 2, maret: 3, mar: 3, april: 4, apr: 4, mei: 5,
  juni: 6, jun: 6, juli: 7, jul: 7, agustus: 8, agu: 8, agt: 8, ags: 8,
  september: 9, sept: 9, sep: 9, oktober: 10, okt: 10, november: 11, nov: 11, desember: 12, des: 12,
};

// Period word without a number ("besok pagi") → a default requested hour
const PERIOD_DEFAULT_MINUTES = { pagi: 9 * 60, siang: 13 * 60, sore: 16 * 60, malam: 19 * 60 };

const RELATIVE_DAYS = [
  { pattern: /\blusa\b/, offset: 2 },
  { pattern: /\bbesok\b/, offset: 1 },
  { pattern: /\b(?:hari ini|sekarang|nanti)\b/, offset: 0 },
];

/** Today's calendar day (as UTC-midnight ms) and minutes since midnight, in WIB. */
function nowInWib(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return {
    day: Date.UTC(+parts.year, +parts.month - 1, +parts.day),
    year: +parts.year,
    month: +parts.month,
    minutes: +parts.hour * 60 + +parts.minute,
  };
}

/** Build a calendar day, or null when the date does not exist (e.g. 31/02). */
function makeDay(year, month, date) {
  const day = Date.UTC(year, month - 1, date);
  const d = new Date(day);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === date ? day : null;
}

/** Explicit date without a year: this year, or next year if it already passed. */
function dayWithImplicitYear(today, month, date, explicitYear) {
  if (explicitYear) {
    const year = explicitYear < 100 ? 2000 + explicitYear : explicitYear;
    return makeDay(year, month, date);
  }
  const thisYear = makeDay(today.year, month, date);
  if (thisYear !== null && thisYear >= today.day) return thisYear;
  return makeDay(today.year + 1, month, date);
}

/** Find the requested calendar day. `weekday` results are resolved after the time is known. */
function parseDate(text, today) {
  // dd/mm[/yyyy] or dd-mm[-yyyy] — skip "jam 10-12" (a time range, not 10 December)
  for (const m of text.matchAll(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g)) {
    if (/(?:jam|pukul|pkl)\s*$/.test(text.slice(0, m.index))) continue;
    const day = dayWithImplicitYear(today, +m[2], +m[1], m[3] ? +m[3] : null);
    return day === null ? { invalid: true } : { day };
  }

  const monthNames = Object.keys(MONTHS).join('|');
  const named = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})\\b(?:\\s+(\\d{4}))?`));
  if (named) {
    const day = dayWithImplicitYear(today, MONTHS[named[2]], +named[1], named[3] ? +named[3] : null);
    return day === null ? { invalid: true } : { day };
  }

  const tanggal = text.match(/\b(?:tanggal|tgl)\s+(\d{1,2})\b/);
  if (tanggal) {
    let day = makeDay(today.year, today.month, +tanggal[1]);
    if (day !== null && day < today.day) {
      const nextMonth = today.month === 12 ? { y: today.year + 1, m: 1 } : { y: today.year, m: today.month + 1 };
      day = makeDay(nextMonth.y, nextMonth.m, +tanggal[1]);
    }
    return day === null ? { invalid: true } : { day };
  }

  for (const { pattern, offset } of RELATIVE_DAYS) {
    if (pattern.test(text)) return { day: today.day + offset * DAY_MS };
  }

  // "minggu depan/ini" means "next/this week", not Sunday; "senin depan" is still a Monday
  const weekday = text.match(/\b(minggu|ahad|senin|selasa|rabu|kamis|jumat|sabtu)\b(?!\s*(?:depan|ini|lalu|kemarin)\b)/)
    || text.match(/\b(senin|selasa|rabu|kamis|jumat|sabtu)\b/);
  if (weekday) return { weekday: WEEKDAYS[weekday[1]] };

  return null;
}

/** Requested start time in minutes since midnight, or a failure reason. */
function parseTime(text) {
  const withKeyword = text.match(/\b(?:jam|pukul|pkl)\s*(\d{1,2})(?:[.:](\d{2}))?(?:an)?(?:\s*(pagi|siang|sore|malam))?\b/);
  const bare = text.match(/\b(\d{1,2})[.:](\d{2})\b(?:\s*(pagi|siang|sore|malam))?/);
  const match = withKeyword || bare;

  if (match) {
    const hour = +match[1];
    const minute = match[2] ? +match[2] : 0;
    if (hour > 24 || minute > 59) return { reason: 'no_time' };

    const candidates = toHour24Candidates(hour, match[3]).map((h) => h * 60 + minute);
    const inHours = candidates.find((t) => t >= START_MINUTES && t < END_MINUTES);
    return inHours !== undefined ? { minutes: inHours } : { reason: 'outside_hours' };
  }

  const period = text.match(/\b(pagi|siang|sore|malam)\b/);
  if (period) return { minutes: PERIOD_DEFAULT_MINUTES[period[1]] };

  return { reason: 'no_time' };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatHHmm(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * @param {string} rawText
 * @param {Date} [now]
 * @returns {{ status: 'ok', tanggal: string, waktuMulai: string, waktuSelesai: string, label: string }
 *   | { status: 'invalid', reason: 'no_date'|'no_time'|'invalid_date'|'sunday'|'outside_hours'|'past'|'too_far' }}
 */
function parseSchedule(rawText, now = new Date()) {
  if (!rawText || typeof rawText !== 'string') return { status: 'invalid', reason: 'no_date' };

  const text = rawText
    .toLowerCase()
    .replace(/jum'at/g, 'jumat')
    .replace(/\s+/g, ' ')
    .trim();
  const today = nowInWib(now);

  const date = parseDate(text, today);
  if (!date) return { status: 'invalid', reason: 'no_date' };
  if (date.invalid) return { status: 'invalid', reason: 'invalid_date' };

  const time = parseTime(text);
  if (time.reason) return { status: 'invalid', reason: time.reason };
  const startMinutes = time.minutes;

  let day = date.day;
  if (date.weekday !== undefined) {
    // Nearest upcoming occurrence; today only if the requested time is still ahead
    const todayDow = new Date(today.day).getUTCDay();
    let offset = (date.weekday - todayDow + 7) % 7;
    if (offset === 0 && startMinutes <= today.minutes) offset = 7;
    day = today.day + offset * DAY_MS;
  }

  if (day < today.day || (day === today.day && startMinutes <= today.minutes)) {
    return { status: 'invalid', reason: 'past' };
  }
  if (new Date(day).getUTCDay() === 0) return { status: 'invalid', reason: 'sunday' };
  if (day - today.day > MAX_DAYS_AHEAD * DAY_MS) return { status: 'invalid', reason: 'too_far' };

  const endMinutes = Math.min(startMinutes + DEFAULT_SLOT_MINUTES, END_MINUTES);
  const d = new Date(day);
  const tanggal = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const dateLabel = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);

  return {
    status: 'ok',
    tanggal,
    waktuMulai: formatHHmm(startMinutes),
    waktuSelesai: formatHHmm(endMinutes),
    label: `${dateLabel}, pukul ${formatHHmm(startMinutes).replace(':', '.')}–${formatHHmm(endMinutes).replace(':', '.')} WIB`,
  };
}

module.exports = {
  parseSchedule,
};
