import { Clipboard, ClipboardCheck } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { Button } from "../ui/button";

interface ClipBoardButtonProps {
  content: string;
  onClick?: () => void;
  className?: string;
}

export function ClipBoardButton(props: ClipBoardButtonProps) {
  const [clickedOnClipBoard, setClickedOnClipBoard] = useState(false);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(props.content);
    } catch {
      return; // permission denied / insecure context — don't fake a success state
    }
    setClickedOnClipBoard(true);
    props.onClick?.();

    setTimeout(() => {
      setClickedOnClipBoard(false);
    }, 2000);
  };

  return (
    <Button variant="outline" size="icon" onClick={() => void handleClick()} className={props.className}>
      <ClipboardCheck
        className={cn("scale-0 rotate-90 transition-transform duration-500 ease-in-out", {
          "scale-100 rotate-0": clickedOnClipBoard,
        })}
      />
      <Clipboard
        className={cn("absolute scale-100 rotate-0 transition-transform duration-500 ease-in-out", {
          "scale-0 -rotate-90": clickedOnClipBoard,
        })}
      />
      <span className="sr-only">Copy to clipboard</span>
    </Button>
  );
}
