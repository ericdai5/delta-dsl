import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { observer } from "mobx-react-lite";

import { PanelRightClose, PanelRightOpen, Sparkles } from "lucide-react";

import { Provider } from "./core";
import { examples as formulaExamples } from "./examples";
import { Config } from "./formulize";
import Editor from "./internal/api-code-editor";
import PlaygroundCanvas from "./internal/playground";
import PlaygroundBreadcrumb from "./internal/playground-breadcrumb";
import { debugStore } from "./store/debug";
import IconButton from "./ui/icon-button";
import { executeUserCode } from "./util/code-executor";

// The code editor's undo and redo shortcuts (CodeMirror's history keymap):
// redo is Shift+Cmd+Z on a Mac and Ctrl+Y elsewhere.
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const shortcutHints = isMac
  ? [
      { keys: "⌘Z", action: "Undo" },
      { keys: "⇧⌘Z", action: "Redo" },
    ]
  : [
      { keys: "Ctrl+Z", action: "Undo" },
      { keys: "Ctrl+Y", action: "Redo" },
    ];

const APIPage = observer(() => {
  const navigate = useNavigate();
  const { exampleId } = useParams<{ exampleId: string }>();

  // Get example keys for navigation
  const exampleKeys = useMemo(
    () => Object.keys(formulaExamples) as (keyof typeof formulaExamples)[],
    []
  );

  // Derive selected template from URL parameter
  const selectedTemplate = useMemo(() => {
    if (exampleId && exampleId in formulaExamples) {
      return exampleId as keyof typeof formulaExamples;
    }
    return exampleKeys[0];
  }, [exampleId, exampleKeys]);

  const [isRendered, setIsRendered] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [editorWidth, setEditorWidth] = useState(400);
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  // Navigate to example by updating the URL
  const setSelectedTemplate = useCallback(
    (template: keyof typeof formulaExamples | undefined) => {
      if (template) {
        navigate(`/examples/${template}`);
      }
    },
    [navigate]
  );

  // Execute code and extract config
  const executeCode = useCallback(async (codeToExecute: string) => {
    if (!codeToExecute || codeToExecute.trim() === "") {
      setConfig(null);
      setError(null);
      return;
    }
    try {
      setError(null);
      const extractedConfig = await executeUserCode(codeToExecute);
      setConfig(extractedConfig);
    } catch (err) {
      console.error("Code execution error:", err);
      setError(err instanceof Error ? err.message : String(err));
      setConfig(null);
    }
  }, []);

  // Update debugStore when selectedTemplate changes
  useEffect(() => {
    if (selectedTemplate && formulaExamples[selectedTemplate]) {
      debugStore.setSelectedTemplate(
        selectedTemplate,
        formulaExamples[selectedTemplate]
      );
    }
  }, [selectedTemplate]);

  // Execute code when debugStore.code changes (observer triggers re-render)
  const code = debugStore.code;
  useEffect(() => {
    executeCode(code);
  }, [code, executeCode]);

  // Memoized callback to prevent Provider re-initialization on parent re-renders
  const handleRenderError = useCallback((renderError: string | null) => {
    if (renderError) {
      setError(renderError);
    }
  }, []);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = editorWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return;
        const delta = moveEvent.clientX - startX;
        const containerWidth =
          containerRef.current?.getBoundingClientRect().width ?? 1200;
        const newWidth = Math.min(
          Math.max(300, startWidth + delta),
          containerWidth - 300
        );
        setEditorWidth(newWidth);
      };

      const handleMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [editorWidth]
  );

  return (
    <div className="h-full flex flex-col">
      {/* Top bar, spanning the code panel and the preview */}
      <header className="flex h-12 flex-shrink-0 items-center border-b border-slate-200 bg-white px-4">
        <PlaygroundBreadcrumb
          onConfigSelect={setSelectedTemplate}
          activeConfigKey={selectedTemplate}
        />
      </header>
      <div ref={containerRef} className="relative min-h-0 flex-1 flex">
        {/* Editor Panel */}
        <div
          className={`${isRendered ? "border-r border-slate-200" : ""} overflow-hidden flex flex-col flex-shrink-0`}
          style={{
            width: isRendered ? editorWidth : 0,
            transition: isRendered ? undefined : "width 0.3s ease-in-out",
          }}
        >
          <div className="min-w-[300px] h-full flex flex-col">
            <div className="flex-1 min-h-0 overflow-hidden">
              <Editor
                code={debugStore.code}
                onChange={(newCode) => debugStore.setCode(newCode)}
                onRender={() => {}}
                error={error}
              />
            </div>
            {/* Undo and redo are keyboard shortcuts; this is the reminder. */}
            <div className="flex flex-shrink-0 items-center gap-4 border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
              {shortcutHints.map(({ keys, action }) => (
                <span key={action} className="flex items-center gap-1.5">
                  <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[11px] text-slate-600">
                    {keys}
                  </kbd>
                  {action}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Resize Handle */}
        {isRendered && (
          <div className="relative flex-shrink-0 w-0">
            <div
              onMouseDown={handleResizeStart}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 cursor-col-resize group flex items-center justify-center w-4 h-12"
            >
              <div className="w-1.5 h-8 rounded-full bg-white border border-slate-200 group-hover:bg-slate-100 group-hover:border-slate-300 transition-colors shadow-sm" />
            </div>
          </div>
        )}

        {/* Main Content Panel */}
        <div className="relative flex-1 min-w-0">
          <Provider config={config || undefined} onError={handleRenderError}>
            <PlaygroundCanvas />
          </Provider>
          {/* Editor controls sit just outside the code panel, against its
              right border, so they never cover the code. */}
          <div className="absolute top-2.5 left-2.5 z-30 flex flex-col gap-2">
            {/* The toggle comes first so it stays in the same spot whether
                the editor is open or collapsed. */}
            {isRendered ? (
              <>
                <IconButton
                  size="lg"
                  icon={PanelRightOpen}
                  alt="Toggle Editor"
                  onClick={() => setIsRendered(!isRendered)}
                  title="Toggle Code Editor"
                  tooltipPosition="right"
                />
                <IconButton
                  size="lg"
                  icon={Sparkles}
                  alt="Format Code"
                  onClick={() => debugStore.toggleAutoFormat()}
                  title="Format Code"
                  tooltipPosition="right"
                  isActive={debugStore.autoFormat}
                />
              </>
            ) : (
              <IconButton
                size="lg"
                icon={PanelRightClose}
                alt="Toggle Editor"
                onClick={() => setIsRendered(!isRendered)}
                title="Toggle Code Editor"
                tooltipPosition="right"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default APIPage;
