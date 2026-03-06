import { useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  markdownShortcutPlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  codeBlockPlugin,
  frontmatterPlugin,
  diffSourcePlugin,
  toolbarPlugin,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  ListsToggle,
  CreateLink,
  InsertTable,
  CodeToggle,
  DiffSourceToggleWrapper,
  UndoRedo,
  Separator,
} from "@mdxeditor/editor";

import "@mdxeditor/editor/style.css";
import "@/styles/mdxeditor-overrides.css";

export interface NoteEditorProps {
  initialMarkdown?: string;
  onChange?: (markdown: string) => void;
}

/**
 * NoteEditor wraps MDXEditor with the plugin configuration specified in ADR-007.
 *
 * Exposes `getMarkdown()` and `setMarkdown()` via the forwarded ref so that
 * parent components (and eventually file I/O in P2-02) can read/write content.
 */
export const NoteEditor = forwardRef<MDXEditorMethods, NoteEditorProps>(
  function NoteEditor({ initialMarkdown = "", onChange }, ref) {
    const editorRef = useRef<MDXEditorMethods>(null);

    // Forward the MDXEditor ref methods to the parent
    useImperativeHandle(ref, () => ({
      getMarkdown: () => editorRef.current?.getMarkdown() ?? "",
      setMarkdown: (value: string) => editorRef.current?.setMarkdown(value),
      insertMarkdown: (value: string) =>
        editorRef.current?.insertMarkdown(value),
      focus: (
        callbackFn?: () => void,
        opts?: {
          defaultSelection?: "rootStart" | "rootEnd";
          preventScroll?: boolean;
        },
      ) => editorRef.current?.focus(callbackFn, opts),
      getContentEditableHTML: () =>
        editorRef.current?.getContentEditableHTML() ?? "",
      getSelectionMarkdown: () =>
        editorRef.current?.getSelectionMarkdown() ?? "",
    }));

    const handleChange = useCallback(
      (markdown: string) => {
        onChange?.(markdown);
      },
      [onChange],
    );

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <MDXEditor
          ref={editorRef}
          markdown={initialMarkdown}
          onChange={handleChange}
          className="dark-theme flex min-h-0 flex-1 flex-col"
          contentEditableClassName="prose prose-invert max-w-none flex-1 outline-none"
          plugins={[
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            markdownShortcutPlugin(),
            thematicBreakPlugin(),
            linkPlugin(),
            linkDialogPlugin(),
            tablePlugin(),
            codeBlockPlugin({ defaultCodeBlockLanguage: "text" }),
            frontmatterPlugin(),
            diffSourcePlugin({ viewMode: "rich-text" }),
            toolbarPlugin({
              toolbarContents: () => (
                <DiffSourceToggleWrapper>
                  <UndoRedo />
                  <Separator />
                  <BoldItalicUnderlineToggles />
                  <Separator />
                  <BlockTypeSelect />
                  <Separator />
                  <ListsToggle />
                  <Separator />
                  <CreateLink />
                  <InsertTable />
                  <Separator />
                  <CodeToggle />
                </DiffSourceToggleWrapper>
              ),
            }),
          ]}
        />
      </div>
    );
  },
);
