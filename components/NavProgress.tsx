"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Thin top progress bar. Fires on any internal <Link> or <a> click, drains
 * to full when the URL changes (both pathname AND searchParams so filter/
 * search changes also complete). Gives users instant "click received" feedback
 * without needing per-component loading state.
 */
export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    function isInternalNav(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const a = target.closest("a");
      if (!a) return false;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return false;
      if (a.target === "_blank") return false;
      if (href.startsWith("http") && !href.startsWith(window.location.origin)) return false;
      // Skip mailto/tel/etc.
      if (/^(mailto|tel|javascript):/i.test(href)) return false;
      return true;
    }

    function start() {
      // Reset and animate up.
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setVisible(true);
      setProgress(15);
      const t1 = window.setTimeout(() => setProgress(45), 100);
      const t2 = window.setTimeout(() => setProgress(70), 350);
      const t3 = window.setTimeout(() => setProgress(85), 900);
      timers.current.push(t1, t2, t3);
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return; // left-click only
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (isInternalNav(e.target)) start();
    }

    function onFormSubmit(e: SubmitEvent) {
      // Server-action forms usually navigate/redirect. Fire progress too.
      const t = e.target as HTMLFormElement;
      if (t?.tagName === "FORM") start();
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onFormSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onFormSubmit, true);
      timers.current.forEach(clearTimeout);
    };
  }, []);

  // URL changed → finish + hide.
  useEffect(() => {
    if (!visible) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setProgress(100);
    const t = window.setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 250);
    timers.current.push(t);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 z-[100] h-[3px] pointer-events-none"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 200ms ease" }}
    >
      <div
        className="h-full bg-primary"
        style={{
          width: `${progress}%`,
          transition: "width 200ms cubic-bezier(0.4, 0, 0.2, 1)",
          boxShadow: "0 0 8px currentColor",
        }}
      />
    </div>
  );
}
