"use client";

import { useEffect } from "react";

export function CloseWindow() {
  useEffect(() => {
    const t = setTimeout(() => window.close(), 800);
    return () => clearTimeout(t);
  }, []);
  return null;
}
