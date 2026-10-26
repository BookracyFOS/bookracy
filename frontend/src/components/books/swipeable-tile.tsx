import { useState, type ReactNode } from "react";
import { useSwipeable } from "react-swipeable";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SwipeActionDef {
  label: string;
  icon: LucideIcon;
  /** Drives the revealed background colour. */
  tone: "danger" | "success";
  onAction: () => void;
}

interface SwipeableTileProps {
  children: ReactNode;
  /** Action when swiping LEFT (finger moves left; panel revealed on the right edge). */
  left?: SwipeActionDef;
  /** Action when swiping RIGHT (finger moves right; panel revealed on the left edge). */
  right?: SwipeActionDef;
}

const THRESHOLD = 88; // px of travel needed to fire an action
const MAX = 116; // clamp how far the tile follows the finger

const TONE_BG: Record<SwipeActionDef["tone"], string> = {
  danger: "bg-destructive text-destructive-foreground",
  success: "bg-green-600 text-white",
};

/**
 * Wraps a book tile with iOS-style swipe actions on touch. Each direction is fully
 * configurable (see Settings → swipe actions): `left` fires when swiping left (its
 * panel is revealed on the right), `right` fires when swiping right. A direction
 * with no action provided is simply inert (the tile won't drag that way).
 */
export function SwipeableTile({ children, left, right }: SwipeableTileProps) {
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);

  const handlers = useSwipeable({
    onSwiping: (e) => {
      let d = e.deltaX;
      if (d < 0 && !left) d = 0; // no left action → don't drag left
      if (d > 0 && !right) d = 0; // no right action → don't drag right
      setAnimating(false);
      setDx(Math.max(-MAX, Math.min(MAX, d)));
    },
    onSwiped: (e) => {
      setAnimating(true);
      if (e.deltaX <= -THRESHOLD && left) left.onAction();
      else if (e.deltaX >= THRESHOLD && right) right.onAction();
      setDx(0);
    },
    trackMouse: false,
    delta: 12,
  });

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {left && (
        <div className={cn("absolute inset-y-0 right-0 flex items-center justify-end gap-2 px-5 transition-opacity", TONE_BG[left.tone], dx < 0 ? "opacity-100" : "opacity-0")}>
          <span className="text-sm font-semibold">{left.label}</span>
          <left.icon className="h-5 w-5" />
        </div>
      )}
      {right && (
        <div className={cn("absolute inset-y-0 left-0 flex items-center gap-2 px-5 transition-opacity", TONE_BG[right.tone], dx > 0 ? "opacity-100" : "opacity-0")}>
          <right.icon className="h-5 w-5" />
          <span className="text-sm font-semibold">{right.label}</span>
        </div>
      )}
      <div {...handlers} className={cn("relative touch-pan-y", animating && "transition-transform duration-200 ease-out")} style={{ transform: `translateX(${dx}px)` }}>
        {children}
      </div>
    </div>
  );
}
