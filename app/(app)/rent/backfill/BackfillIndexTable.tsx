"use client";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { SortableTable, type Column } from "@/components/SortableTable";

export type IndexRow = {
  id: string;
  property_name: string;
  compound_name: string;
  active_lessee: string | null;
  rent_row_count: number;
};

export function BackfillIndexTable({ rows }: { rows: IndexRow[] }) {
  const router = useRouter();

  const columns: Column<IndexRow>[] = [
    { key: "compound_name", label: "Compound", cell: (r) => <span className="text-muted-fg">{r.compound_name}</span> },
    {
      key: "property_name",
      label: "Property",
      cell: (r) => <span className="font-medium">{r.property_name}</span>,
      sortValue: (r) => `${r.compound_name} ${r.property_name}`,
    },
    { key: "active_lessee", label: "Lessee", cell: (r) => r.active_lessee ?? <span className="text-muted-fg">Vacant</span> },
    { key: "rent_row_count", label: "Rows", align: "right", cell: (r) => <span className="tabular-nums">{r.rent_row_count}</span> },
    { key: "_open", label: "", sortable: false, align: "right", width: "w-8", cell: () => <ChevronRight size={14} className="text-muted-fg inline" /> },
  ];

  return (
    <div className="card p-0">
      <SortableTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        initialSort={{ key: "property_name", dir: "asc" }}
        onRowClick={(r) => router.push(`/rent/backfill/${r.id}`)}
        emptyMessage="No properties match."
      />
    </div>
  );
}
