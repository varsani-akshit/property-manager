import { Lock } from "lucide-react";

export default function NoAccessPage() {
  return (
    <div className="mx-auto mt-24 flex max-w-md flex-col items-center text-center">
      <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-fg">
        <Lock size={18} />
      </span>
      <h1 className="text-[15px] font-semibold text-fg">No pages available</h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-fg">
        Your account hasn&apos;t been granted access to any pages yet. Ask an admin to grant you permissions.
      </p>
    </div>
  );
}
