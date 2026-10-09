// The compact fact set the analytics dashboard works from. Everything refers to
// other records by array index (not uuid) to keep the payload small; ids are
// kept on compounds / properties / leases for links.

export type Compound = { id: string; name: string };
export type Property = { id: string; name: string; c: number; sqft: number; value: number; sc: number; archived: boolean };
export type Lease = {
  id: string; p: number; lessee: string; start: string; end: string; rent: number;
  active: boolean; depCharged: number; depHeld: number; cancelled: string | null;
};
/** [leaseIdx, dueDate, net, collected] */
export type RentRow = [number, string, number, number];
/** [kind r|c|d, leaseIdx (-1 if none), paidOn, amount, method, personIdx (-1), dueDate|null] */
export type PaymentRow = [string, number, string, number, string, number, string | null];
/** [propertyIdx, incurredOn, category, amount] */
export type CostRow = [number, string, string, number];
/** [leaseIdx, dueDate, category, amount, collected] */
export type ChargeRow = [number, string, string, number, number];
/** [propertyIdx, dueMonth, amount, status] */
export type ScRow = [number, string, number, string];

export type Facts = {
  generatedAt: string;
  today: string;
  compounds: Compound[];
  properties: Property[];
  leases: Lease[];
  lessees: string[];                 // distinct lessee names, sorted
  people: { id: string; name: string }[];
  rent: RentRow[];
  payments: PaymentRow[];
  costs: CostRow[];
  charges: ChargeRow[];
  sc: ScRow[];
};
