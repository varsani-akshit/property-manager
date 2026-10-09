// Payment methods — shared by forms, tables, exports and the MCP tools.

export const PAYMENT_METHODS = [
  { value: "mpesa", label: "M-Pesa" },
  { value: "bank", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];
export type PaymentKind = "rent" | "cost" | "deposit";

const LABELS: Record<string, string> = {
  ...Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label])),
  adjustment: "Adjustment",
  opening: "Before log",
};

export function methodLabel(v: string | null | undefined): string {
  return (v && LABELS[v]) || "—";
}

export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === "string" && PAYMENT_METHODS.some((m) => m.value === v);
}
