import { create } from "zustand";

// ---------------------------------------------------------------------------
// Per-window local state — NOT synced across windows
// ---------------------------------------------------------------------------

export interface LocalState {
  /** Scroll position for the current note editor. */
  scrollPosition: number;
  setScrollPosition: (pos: number) => void;

  /** Whether the editor is in focus. */
  editorFocused: boolean;
  setEditorFocused: (focused: boolean) => void;
}

export const useLocalStore = create<LocalState>()((set) => ({
  scrollPosition: 0,
  setScrollPosition: (pos) => set({ scrollPosition: pos }),

  editorFocused: false,
  setEditorFocused: (focused) => set({ editorFocused: focused }),
}));
