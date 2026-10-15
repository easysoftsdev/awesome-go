const SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  BDT: "৳",
  INR: "₹",
  PKR: "₨",
  NPR: "रू",
  AED: "د.إ",
  SAR: "﷼",
  QAR: "﷼",
  KWD: "د.ك",
  EGP: "E£",
  NGN: "₦",
  GHS: "₵",
  KES: "KSh",
  ZAR: "R",
  TZS: "TSh",
  UGX: "USh",
  PHP: "₱",
  IDR: "Rp",
  MYR: "RM",
  THB: "฿",
  VND: "₫",
  CNY: "¥",
  JPY: "¥",
  KRW: "₩",
  AUD: "A$",
  CAD: "C$",
  NZD: "NZ$",
  SGD: "S$",
  HKD: "HK$",
  TRY: "₺",
  RUB: "₽",
  UAH: "₴",
  PLN: "zł",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  CHF: "CHF",
  MXN: "Mex$",
  BRL: "R$",
  ARS: "$",
  CLP: "$",
  COP: "$",
};

export const CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "BDT",
  "INR",
  "PKR",
  "NPR",
  "AED",
  "SAR",
  "QAR",
  "KWD",
  "EGP",
  "NGN",
  "GHS",
  "KES",
  "ZAR",
  "TZS",
  "UGX",
  "PHP",
  "IDR",
  "MYR",
  "THB",
  "VND",
  "CNY",
  "JPY",
  "KRW",
  "AUD",
  "CAD",
  "NZD",
  "SGD",
  "HKD",
  "TRY",
  "RUB",
  "UAH",
  "PLN",
  "SEK",
  "NOK",
  "DKK",
  "CHF",
  "MXN",
  "BRL",
  "ARS",
];

export function currencySymbol(code: string): string {
  const key = (code || "USD").toUpperCase();
  return SYMBOLS[key] || key + " ";
}

export function formatMoney(cents: number, code = "USD"): string {
  const symbol = currencySymbol(code);
  const value = (cents || 0) / 100;
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return symbol + formatted;
}

export function formatQty(qty: number): string {
  if (Number.isInteger(qty)) return String(qty);
  return qty.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function parseMoneyToCents(input: string, code = "USD"): number {
  const raw = (input || "").replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function weekdayLabel(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

export function errorMessage(err: unknown): string {
  if (err === null || err === undefined) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    if (typeof cause === "string" && cause.trim() && cause !== err.message) {
      return cause;
    }
    if (cause instanceof Error && cause.message) return cause.message;
    return err.message || String(err);
  }
  if (typeof err === "object" && err !== null) {
    const maybe = err as { message?: string; error?: string };
    if (maybe.message) return maybe.message;
    if (maybe.error) return maybe.error;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

export function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
