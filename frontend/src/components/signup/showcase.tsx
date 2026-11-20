"use client";

import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { cx } from "@/lib/cx";

import { type Slide, SLIDES } from "./slides";

const INTERVAL_MS = 6000;

const QUERY = "(prefers-reduced-motion: reduce)";

/** True when the person has asked their system for less motion. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia?.(QUERY);
      media?.addEventListener?.("change", notify);
      return () => media?.removeEventListener?.("change", notify);
    },
    () => !!window.matchMedia?.(QUERY)?.matches,
    () => false,
  );
}

/**
 * Three slides beside the sign-up form. They advance by themselves every few seconds, stop while
 * the pointer or keyboard focus is on them (or when the system asks for less motion), and can be
 * moved by the arrows or the dots.
 */
export function Showcase({ slides = SLIDES }: { slides?: Slide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const still = useReducedMotion();
  const count = slides.length;

  useEffect(() => {
    if (paused || still || count < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [paused, still, count]);

  const go = (to: number) => setIndex(((to % count) + count) % count);
  const auto = !paused && !still;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="What you can do with the system"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="relative flex h-full min-h-0 flex-col justify-between overflow-hidden rounded-[32px] bg-gradient-to-br from-blue-600 to-blue-700 p-10 text-white"
    >
      <div aria-hidden className="absolute -top-24 -right-24 size-80 rounded-full bg-white/10" />
      <div aria-hidden className="absolute -bottom-32 -left-20 size-96 rounded-full bg-white/5" />
      <div aria-live={auto ? "off" : "polite"} className="relative grid flex-1 place-items-center">
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
            aria-hidden={i !== index}
            className={cx(
              "col-start-1 row-start-1 flex w-full flex-col items-center gap-8 text-center transition-opacity duration-500 motion-reduce:transition-none",
              i === index ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <slide.Art />
            <div className="flex max-w-md flex-col gap-2">
              <h2 className="text-page-title">{slide.title}</h2>
              <p className="text-body text-white/80">{slide.text}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="relative flex items-center justify-between pt-6">
        <button
          type="button"
          aria-label="Previous slide"
          onClick={() => go(index - 1)}
          className="grid size-10 place-items-center rounded-full bg-white/15 hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <CaretLeft aria-hidden size={18} />
        </button>
        <div className="flex items-center gap-2">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              aria-label={`Show slide ${i + 1} of ${count}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => go(i)}
              className={cx(
                "h-2 rounded-full transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                i === index ? "w-8 bg-white" : "w-2 bg-white/40 hover:bg-white/60",
              )}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="Next slide"
          onClick={() => go(index + 1)}
          className="grid size-10 place-items-center rounded-full bg-white/15 hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <CaretRight aria-hidden size={18} />
        </button>
      </div>
    </section>
  );
}
