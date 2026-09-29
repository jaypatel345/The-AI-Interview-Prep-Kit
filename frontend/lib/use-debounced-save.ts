"use client";
import { useEffect, useRef } from "react";

/**
 * Calls save(value) 600 ms after the last change, and flushes a pending save on unmount,
 * so typing never waits on the network and switching away never drops an edit.
 */
export function useDebouncedSave<T>(value: T, save: (v: T) => void, delay = 600) {
  const first = useRef(true);
  const pending = useRef<T | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    pending.current = value;
    const t = setTimeout(() => { pending.current = null; saveRef.current(value); }, delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  useEffect(() => () => { if (pending.current !== null) saveRef.current(pending.current); }, []);
}
