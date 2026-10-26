import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { exampleDisplayNames } from "../examples";
import { ExampleCardContent } from "./example-card";
import {
  IExampleKey,
  displayName,
  exampleCardClass,
  otherExampleKeys,
  publicExampleKeys,
} from "./example-list";

interface IExampleSwitcherProps {
  onConfigSelect?: (key: IExampleKey) => void;
  activeConfigKey?: IExampleKey;
}

// Arrows on the carousel's edges; each fades out when there is nothing more
// on its side.
const edgeButtonClass =
  "absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 shadow-sm transition-opacity duration-150 hover:bg-slate-50 hover:text-slate-950 disabled:pointer-events-none disabled:opacity-0";

export const ExampleSwitcher: React.FC<IExampleSwitcherProps> = ({
  onConfigSelect,
  activeConfigKey,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [pickerTop, setPickerTop] = useState(0);
  const [canScroll, setCanScroll] = useState({ back: false, forward: false });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const label = activeConfigKey
    ? displayName(activeConfigKey)
    : "Select Example";

  // Fade only names that overflow; re-check when the panel is resized.
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    const check = () => setIsTruncated(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [label]);

  const updateScrollButtons = () => {
    const track = trackRef.current;
    if (!track) return;
    setCanScroll({
      back: track.scrollLeft > 0,
      forward: track.scrollLeft + track.clientWidth < track.scrollWidth - 1,
    });
  };

  // Open with the current example's card centered in the carousel, and keep
  // the arrows right if the window is resized while it is open.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const track = trackRef.current;
    if (!track) return;
    const active = track.querySelector<HTMLElement>('[aria-current="true"]');
    if (active) {
      track.scrollLeft =
        active.offsetLeft - (track.clientWidth - active.offsetWidth) / 2;
    }
    updateScrollButtons();
    const observer = new ResizeObserver(updateScrollButtons);
    observer.observe(track);
    return () => observer.disconnect();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  const toggle = () => {
    // The picker is fixed to the window's left edge so the wide carousel stays
    // on screen. It opens 8px below the top bar.
    const topBar = buttonRef.current?.closest("header") ?? buttonRef.current;
    const rect = topBar?.getBoundingClientRect();
    if (rect) setPickerTop(rect.bottom + 8);
    setIsOpen(!isOpen);
  };

  const select = (key: IExampleKey) => {
    onConfigSelect?.(key);
    setIsOpen(false);
  };

  const scrollCarousel = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({
      left: direction * track.clientWidth * 0.8,
      behavior: "smooth",
    });
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggle}
        className="flex min-w-0 items-center gap-1 py-1 text-sm text-slate-950"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        {/* Long names fade out at the right edge instead of wrapping. */}
        <span
          ref={labelRef}
          className={`min-w-0 overflow-hidden whitespace-nowrap ${
            isTruncated
              ? "[mask-image:linear-gradient(to_right,black_calc(100%_-_2rem),transparent)]"
              : ""
          }`}
        >
          {label}
        </span>
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 text-slate-500 transition-transform duration-200 motion-reduce:transition-none ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
      )}

      {/* Example carousel. It stays mounted so it can animate both open and
          closed; while closed it is invisible and out of the tab order. */}
      <div
        aria-label="Examples"
        className={`fixed left-2.5 z-50 w-[min(calc(100vw-1.25rem),60rem)] origin-top-left rounded-xl border border-slate-200 bg-white shadow-md transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none ${
          isOpen
            ? "visible translate-y-0 scale-100 opacity-100"
            : "invisible -translate-y-1 scale-[0.98] opacity-0"
        }`}
        role="dialog"
        style={{ top: pickerTop }}
      >
        <div className="relative">
          <button
            aria-label="Scroll examples left"
            className={`${edgeButtonClass} left-2`}
            disabled={!canScroll.back}
            onClick={() => scrollCarousel(-1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Mouse wheels scroll vertically, so their scrolling moves the
              carousel sideways. */}
          <div
            ref={trackRef}
            className="scrollbar-hide overflow-x-auto"
            onScroll={updateScrollButtons}
            onWheel={(event) => {
              if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                event.currentTarget.scrollLeft += event.deltaY;
              }
            }}
          >
            {/* The padding around the cards matches the gap between them. */}
            <div className="flex w-max gap-4 p-4">
              {publicExampleKeys.map((key) => (
                <button
                  key={key}
                  onClick={() => select(key)}
                  className={`${exampleCardClass(activeConfigKey === key)} w-80 flex-shrink-0`}
                  aria-current={activeConfigKey === key ? "true" : undefined}
                >
                  <ExampleCardContent exampleKey={key} />
                </button>
              ))}
            </div>
          </div>

          <button
            aria-label="Scroll examples right"
            className={`${edgeButtonClass} right-2`}
            disabled={!canScroll.forward}
            onClick={() => scrollCarousel(1)}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* The full example list stays available in local development. */}
        {import.meta.env.DEV && (
          <div className="border-t border-slate-200 p-3">
            <p className="px-1 pb-1 text-xs text-slate-500">
              More examples (development only)
            </p>
            <div className="flex flex-wrap gap-1">
              {otherExampleKeys.map((key) => (
                <button
                  key={key}
                  onClick={() => select(key)}
                  className={`px-2 py-1.5 text-sm text-left rounded-lg transition-colors ${
                    activeConfigKey === key
                      ? "bg-blue-50 text-blue-700"
                      : "hover:bg-gray-50"
                  }`}
                >
                  {exampleDisplayNames[key]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default ExampleSwitcher;
