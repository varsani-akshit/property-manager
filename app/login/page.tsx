import { Suspense } from "react";
import { LoginClient } from "./LoginClient";

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-muted px-4">
        <div className="card max-w-sm w-full text-center">
          <p className="text-sm text-muted-fg">Loading…</p>
        </div>
      </div>
    }>
      <LoginClient />
    </Suspense>
  );
}
