import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

interface CreateTicketInlineProps {
  columnId: string;
  onSubmit: (title: string, columnId: string) => Promise<void>;
}

export function CreateTicketInline({ columnId, onSubmit }: CreateTicketInlineProps) {
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(trimmed, columnId);
      setValue("");
    } catch (err) {
      console.error("[kanban] Failed to create ticket:", err);
    } finally {
      setIsSubmitting(false);
      // Re-focus the input for rapid entry
      inputRef.current?.focus();
    }
  }, [value, columnId, onSubmit, isSubmitting]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    }
    if (e.key === "Escape") {
      setValue("");
      inputRef.current?.blur();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Add a ticket..."
      disabled={isSubmitting}
      className={cn(
        "w-full rounded-md px-2.5 py-1.5 text-sm",
        "bg-transparent text-neutral-300",
        "border border-transparent",
        "placeholder:text-neutral-600",
        "transition-colors duration-150",
        "focus:border-neutral-600 focus:bg-neutral-800/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50",
        "hover:bg-neutral-800/30",
        isSubmitting && "opacity-50",
      )}
    />
  );
}
