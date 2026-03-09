import { lazy, Suspense, useRef, useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import { WindowChrome } from "@/components/WindowChrome";
import { loadNote, saveNote, setNoteOpen, renameNote } from "@/lib/noteService";
import { useWindowStateSaver, saveWindowState } from "@/lib/windowState";
import { useGlobalStore } from "@/stores/globalStore";
import { emitEvent, listenEvent } from "@/lib/events";

const DEBOUNCE_MS = 1000;
const SAVED_DISPLAY_MS = 1500;
const FAILED_DISPLAY_MS = 3000;

const NoteEditor = lazy(() =>
  import("@/components/NoteEditor").then((mod) => ({
    default: mod.NoteEditor,
  })),
);

function EditorFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
      Loading editor...
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
      Loading note...
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-red-400">
      Failed to load note: {message}
    </div>
  );
}

export function NoteWindow() {
  const { id } = useParams<{ id: string }>();
  const editorRef = useRef<MDXEditorMethods>(null);
  const [title, setTitle] = useState("Note");
  const [initialContent, setInitialContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");

  // Persist window position/size to SQLite on move/resize
  useWindowStateSaver(id, "notes");

  const handleRename = useCallback(async (newName: string) => {
    if (!id) return;
    try {
      await renameNote(id, newName);
      setTitle(newName);
      await useGlobalStore.getState().refreshNotes();
      await emitEvent("note:renamed", { noteId: id, newTitle: newName });
    } catch (err) {
      console.error("[hoverpad] Failed to rename note:", err);
    }
  }, [id]);

  // Listen for renames from other windows (e.g. control panel)
  useEffect(() => {
    if (!id) return;
    const unlisten = listenEvent("note:renamed", (e) => {
      if (e.payload.noteId === id) {
        setTitle(e.payload.newTitle);
      }
    });
    return () => { unlisten.then((fn) => fn()).catch(console.error); };
  }, [id]);

  // Refs for debounce and dirty tracking (avoid re-renders)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to track if a save is currently in-flight (prevents racing)
  const isSavingRef = useRef(false);

  /**
   * Core save function used by debounce, Ctrl+S, and close.
   * Returns a promise that resolves when the save is complete.
   */
  const performSave = useCallback(
    async (noteId: string): Promise<void> => {
      const markdown = editorRef.current?.getMarkdown();
      if (markdown == null) return;

      // Prevent concurrent saves from racing
      if (isSavingRef.current) return;
      isSavingRef.current = true;
      isDirtyRef.current = false;

      // Clear any pending status-clear timer
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }

      setSaveStatus("saving");
      try {
        await saveNote(noteId, markdown);
        isSavingRef.current = false;
        setSaveStatus("saved");
        statusTimerRef.current = setTimeout(
          () => setSaveStatus("idle"),
          SAVED_DISPLAY_MS,
        );
      } catch (err) {
        isSavingRef.current = false;
        console.error("[hoverpad] Failed to save note:", err);
        setSaveStatus("failed");
        statusTimerRef.current = setTimeout(
          () => setSaveStatus("idle"),
          FAILED_DISPLAY_MS,
        );
      }
    },
    [],
  );

  // Load note content on mount
  useEffect(() => {
    if (!id) return;

    loadNote(id)
      .then(({ meta, content }) => {
        setTitle(meta.title);
        setInitialContent(content);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[hoverpad] Failed to load note:", message);
        setLoadError(message);
      });
  }, [id]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  // Ctrl+S to save immediately
  useEffect(() => {
    if (!id) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();

        // Cancel any pending debounce timer
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }

        // Save immediately
        void performSave(id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [id, performSave]);

  // Handle window close: save state + content, then mark note as not open
  const handleClose = useCallback(async () => {
    if (id) {
      // Save window position/size immediately before closing
      await saveWindowState(id, "notes");

      // Cancel any pending debounce
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      // If there are unsaved changes, save before closing
      if (isDirtyRef.current) {
        await performSave(id);
      }

      try {
        await setNoteOpen(id, false);
        // Refresh the global store so isOpen updates propagate
        await useGlobalStore.getState().refreshNotes();
      } catch (err) {
        console.error("[hoverpad] Failed to set note closed:", err);
      }
    }
  }, [id, performSave]);

  // onChange from the editor: schedule a debounced save
  const handleChange = useCallback(() => {
    if (!id) return;

    isDirtyRef.current = true;

    // Clear any existing debounce timer
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Schedule a new debounced save
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void performSave(id);
    }, DEBOUNCE_MS);
  }, [id, performSave]);

  // Determine the display title for the title bar
  const displayTitle =
    saveStatus === "saving"
      ? `${title} - Saving...`
      : saveStatus === "saved"
        ? `${title} - Saved`
        : saveStatus === "failed"
          ? `${title} - Save failed`
          : title;

  // Show loading state while content is being fetched
  if (loadError) {
    return (
      <WindowChrome title="Note" onBeforeClose={handleClose}>
        <ErrorState message={loadError} />
      </WindowChrome>
    );
  }

  if (initialContent === null) {
    return (
      <WindowChrome title="Note" onBeforeClose={handleClose}>
        <LoadingState />
      </WindowChrome>
    );
  }

  return (
    <WindowChrome
      title={displayTitle}
      onBeforeClose={handleClose}
      onRename={(name) => void handleRename(name)}
    >
      <Suspense fallback={<EditorFallback />} >
        <NoteEditor
          ref={editorRef}
          initialMarkdown={initialContent}
          onChange={handleChange}
        />
      </Suspense>
    </WindowChrome>
  );
}
