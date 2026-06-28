export const TAIWAN_TIME_ZONE = "Asia/Taipei";

export function formatTaipeiDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIWAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatEspnDate(date) {
  return formatTaipeiDate(date).replace(/-/g, "");
}

export function getTaipeiDateWindow() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return {
    yesterday: formatTaipeiDate(yesterday),
    today: formatTaipeiDate(now),
    tomorrow: formatTaipeiDate(tomorrow),
    espnDates: [yesterday, now, tomorrow].map(formatEspnDate),
  };
}

export function getMatchDayTag(dateValue) {
  const matchDate = formatTaipeiDate(new Date(dateValue));
  const { yesterday, today, tomorrow } = getTaipeiDateWindow();
  if (matchDate === today) return "today";
  if (matchDate === tomorrow) return "tomorrow";
  if (matchDate === yesterday) return "finished";
  return "other";
}

export function toTaipeiIsoFromDateAndTime(dateValue, timeValue = "00:00:00") {
  return `${dateValue}T${String(timeValue).padEnd(8, ":00")}+08:00`;
}
