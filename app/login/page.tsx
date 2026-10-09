import { Suspense } from "react";
import { LoginClient } from "./LoginClient";
import { Loader } from "@/components/Loader";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center bg-sunken"><Loader size="md" /></div>}>
      <LoginClient />
    </Suspense>
  );
}
