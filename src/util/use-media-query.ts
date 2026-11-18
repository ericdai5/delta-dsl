import { useEffect, useState } from "react";

// A screen too narrow for two columns, such as a phone held upright
export const NARROW_SCREEN_QUERY = "(max-width: 767px)";

// A phone held either way: narrow when upright, short when on its side
export const PHONE_SCREEN_QUERY = "(max-width: 767px), (max-height: 500px)";

export const matchesMediaQuery = (query: string): boolean =>
  typeof window !== "undefined" && window.matchMedia(query).matches;

/**
 * Whether a CSS media query matches, kept current as the window changes
 */
export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() => matchesMediaQuery(query));
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
};
