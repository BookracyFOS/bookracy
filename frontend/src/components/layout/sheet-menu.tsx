import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetHeader, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Link } from "@tanstack/react-router";
import { Menu } from "./menu";

import LogoHeader from "@/assets/logo_header.svg";
import LogoHeaderDark from "@/assets/logo_header_dark.svg";
import { useSettingsStore } from "@/stores/settings";
import { useState } from "react";
import { useSwipeable } from "react-swipeable";
import { cn, glassControl, glassNav } from "@/lib/utils";

export function SheetMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const theme = useSettingsStore((state) => state.theme);

  // Swipe left (toward the screen edge) to dismiss — the drawer lives on the left.
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => setIsOpen(false),
    trackMouse: false,
    delta: 50,
  });

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger className="lg:hidden" asChild>
        <Button className={cn("h-8", glassControl)} variant="outline" size="icon" aria-label="Open menu">
          <MenuIcon size={20} />
        </Button>
      </SheetTrigger>
      <SheetContent
        className={cn(
          glassNav,
          "flex h-full flex-col rounded-r-2xl pr-3 pl-[calc(0.75rem_+_env(safe-area-inset-left))] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:w-72",
        )}
        side="left"
      >
        <div {...swipeHandlers} className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Button className="mt-3 flex items-center justify-center" variant="link" asChild>
              <Link to="/" className="flex items-center gap-2" search={{ q: "" }} onClick={() => setIsOpen(false)}>
                {theme === "dark" ? <img src={LogoHeader} className="h-14" alt="Bookracy" /> : <img src={LogoHeaderDark} className="h-14" alt="Bookracy" />}
              </Link>
            </Button>
          </SheetHeader>
          <Menu isOpen closeSheetMenu={() => setIsOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
