const indiaDateTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function getMeetupTime(now = new Date()) {
  const parts = Object.fromEntries(
    indiaDateTime.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return {
    eventDate: `${parts.year}-${parts.month}-${parts.day}`,
    started: Number(parts.hour) >= 20,
  };
}
