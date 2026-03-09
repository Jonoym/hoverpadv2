import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Highlight names registered with the CSS Custom Highlight API
// ---------------------------------------------------------------------------
const HIGHLIGHT_ALL = "FindBarAll";
const HIGHLIGHT_CURRENT = "FindBarCurrent";

// ---------------------------------------------------------------------------
// Text search helpers
// ---------------------------------------------------------------------------

/** Collect all text nodes under `root`. */
function getTextNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }
  return nodes;
}

/** Find all Range objects matching `query` (case-insensitive) in the document body. */
function findMatches(query: string): Range[] {
  if (!query) return [];
  const lowerQuery = query.toLowerCase();
  const ranges: Range[] = [];
  const textNodes = getTextNodes(document.body);

  for (const node of textNodes) {
    const text = node.textContent?.toLowerCase() ?? "";
    let start = 0;
    while (true) {
      const idx = text.indexOf(lowerQuery, start);
      if (idx === -1) break;
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + query.length);
      ranges.push(range);
      start = idx + 1;
    }
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FindBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Range[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open / close on Ctrl+F / Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Focus the input when opened
  useEffect(() => {
    if (open) {
      // Slight delay to ensure render
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setMatches([]);
    setCurrentIndex(0);
    // Clear highlights
    CSS.highlights?.delete(HIGHLIGHT_ALL);
    CSS.highlights?.delete(HIGHLIGHT_CURRENT);
  }, []);

  // Search and highlight whenever query changes
  useEffect(() => {
    if (!open) return;

    const results = findMatches(query);
    setMatches(results);
    setCurrentIndex(results.length > 0 ? 0 : -1);

    // Apply highlights
    CSS.highlights?.delete(HIGHLIGHT_ALL);
    CSS.highlights?.delete(HIGHLIGHT_CURRENT);

    if (results.length === 0) return;

    const allHighlight = new Highlight(...results);
    CSS.highlights?.set(HIGHLIGHT_ALL, allHighlight);

    // Highlight and scroll to first match
    const currentHighlight = new Highlight(results[0]!);
    CSS.highlights?.set(HIGHLIGHT_CURRENT, currentHighlight);
    scrollToRange(results[0]!);
  }, [query, open]);

  // Update current highlight when navigating
  useEffect(() => {
    if (matches.length === 0 || currentIndex < 0) return;

    CSS.highlights?.delete(HIGHLIGHT_CURRENT);
    const range = matches[currentIndex];
    if (range) {
      const currentHighlight = new Highlight(range);
      CSS.highlights?.set(HIGHLIGHT_CURRENT, currentHighlight);
      scrollToRange(range);
    }
  }, [currentIndex, matches]);

  const goNext = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % matches.length);
  }, [matches]);

  const goPrev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + matches.length) % matches.length);
  }, [matches]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Enter") {
        e.preventDefault();
        goNext();
      }
    },
    [close, goNext, goPrev],
  );

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed top-2 right-2 z-[300] flex items-center gap-1.5",
        "rounded-lg border border-neutral-700 bg-neutral-800/95 px-2.5 py-1.5",
        "shadow-xl backdrop-blur-sm",
      )}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in page…"
        className={cn(
          "w-48 rounded bg-neutral-900 border border-neutral-600 px-2 py-1",
          "text-xs text-neutral-200 placeholder:text-neutral-500",
          "outline-none focus:border-blue-500/60",
        )}
      />

      {/* Match count */}
      <span className="min-w-[3.5rem] text-center text-xs text-neutral-500 tabular-nums">
        {query
          ? matches.length > 0
            ? `${currentIndex + 1}/${matches.length}`
            : "No matches"
          : ""}
      </span>

      {/* Previous */}
      <button
        type="button"
        onClick={goPrev}
        disabled={matches.length === 0}
        className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 disabled:opacity-30 disabled:hover:bg-transparent"
        title="Previous (Shift+Enter)"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 10L8 6L4 10" />
        </svg>
      </button>

      {/* Next */}
      <button
        type="button"
        onClick={goNext}
        disabled={matches.length === 0}
        className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 disabled:opacity-30 disabled:hover:bg-transparent"
        title="Next (Enter)"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6L8 10L12 6" />
        </svg>
      </button>

      {/* Close */}
      <button
        type="button"
        onClick={close}
        className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        title="Close (Escape)"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 4L12 12M12 4L4 12" />
        </svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scrollToRange(range: Range) {
  const rect = range.getBoundingClientRect();
  // Only scroll if the match is outside the viewport
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    const el = range.startContainer.parentElement;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
