import { useEffect, useRef, useState } from "react";

const computeIsMobile = (horizontal?: boolean) => {
  if (typeof window === "undefined") return false;
  return horizontal ? window.innerHeight < 600 : window.innerWidth < 1024;
};

export function useIsMobile(horizontal?: boolean) {
  // Init synchronously so the very first render is already correct (no flash /
  // double-mount of consumers that key off this, e.g. the reader's flow mode).
  const [isMobile, setIsMobile] = useState(() => computeIsMobile(horizontal));
  const isMobileCurrent = useRef<boolean | null>(isMobile);

  useEffect(() => {
    function onResize() {
      const value = horizontal ? window.innerHeight < 600 : window.innerWidth < 1024;
      const isChanged = isMobileCurrent.current !== value;
      if (!isChanged) return;

      isMobileCurrent.current = value;
      setIsMobile(value);
    }

    onResize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [horizontal]);

  return {
    isMobile,
  };
}
