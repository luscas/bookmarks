const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const relativeFormatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/** Format an ISO timestamp as an absolute pt-BR date, tolerating bad input. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter.format(date);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/** Human relative time such as "há 3 dias", used on list rows. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = date.getTime() - Date.now();
  const absolute = Math.abs(diff);
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (absolute >= ms || unit === "minute") {
      return relativeFormatter.format(Math.round(diff / ms), unit);
    }
  }
  return relativeFormatter.format(0, "minute");
}
