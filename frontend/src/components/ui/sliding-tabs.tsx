import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface SlidingTabOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface SlidingTabsProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SlidingTabOption<T>[];
  className?: string;
  indicatorClassName?: string;
  tabClassName?: string;
  iconClassName?: string;
  activeTabClassName?: string;
  inactiveTabClassName?: string;
}

type IndicatorRect = { left: number; top: number; width: number; height: number };

export function SlidingTabs<T extends string>({
  value,
  onValueChange,
  options,
  className,
  indicatorClassName,
  tabClassName,
  iconClassName = "h-4 w-4",
  activeTabClassName = "text-foreground",
  inactiveTabClassName = "text-muted-foreground hover:text-foreground",
}: SlidingTabsProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<IndicatorRect>({ left: 0, top: 0, width: 0, height: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateIndicator = () => {
      const index = options.findIndex((o) => o.value === value);
      const el = tabRefs.current[index];
      if (!el) return;
      setIndicator({
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      });
    };

    updateIndicator();

    const ro = new ResizeObserver(updateIndicator);
    ro.observe(container);
    return () => ro.disconnect();
  }, [value, options]);

  return (
    <div ref={containerRef} className={cn("relative inline-flex", className)}>
      <span
        aria-hidden
        className={cn("pointer-events-none absolute left-0 top-0 transition-[transform,width,height] duration-200 ease-out", indicatorClassName)}
        style={{
          width: indicator.width,
          height: indicator.height,
          transform: `translate(${indicator.left}px, ${indicator.top}px)`,
        }}
      />
      {options.map((option, i) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            onClick={() => onValueChange(option.value)}
            className={cn(
              "relative z-10 flex items-center font-medium transition-colors",
              tabClassName,
              active ? activeTabClassName : inactiveTabClassName,
            )}
          >
            {Icon && <Icon className={cn("shrink-0", iconClassName)} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
