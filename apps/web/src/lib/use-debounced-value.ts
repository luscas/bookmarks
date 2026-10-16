import { useEffect, useState } from "react";

/**
 * Return `value` after it has stopped changing for `delayMs`. Used to keep the
 * search box responsive without firing a request per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
