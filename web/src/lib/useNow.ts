import { useEffect, useState } from "react";

// The current time, renewed every `intervalMs`, for ages and countdowns a page shows.
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
