'use client';

import { useEffect, useState } from 'react';

const TICK_MS = 16;
// Catch-up rather than a fixed speed: the model can deliver a whole sentence between two
// PARTIAL events, and a typewriter that falls behind the result is just a delay.
const CATCH_UP = 8;

export function TypedSummary({ text }: { text: string }) {
  const shown = useTypewriter(text);

  return (
    <p className="leading-relaxed">
      {shown}
      {shown.length < text.length && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-rust [animation:pulse-soft_1s_steps(2,end)_infinite]"
        />
      )}
    </p>
  );
}

function useTypewriter(text: string) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // Someone who asked the system to stop animating things does not want to wait for text.
    if (prefersReducedMotion()) {
      setCount(text.length);
      return;
    }

    // A retry replaces the summary rather than extending it, so start over.
    setCount((current) => Math.min(current, text.length));

    const timer = setInterval(() => {
      setCount((current) => {
        if (current >= text.length) return current;
        return Math.min(text.length, current + Math.max(1, Math.ceil((text.length - current) / CATCH_UP)));
      });
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [text]);

  return text.slice(0, count);
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
