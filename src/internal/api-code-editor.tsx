import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { observer } from "mobx-react-lite";

import { undo, redo } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { debugStore } from "../store/debug";
import { createAutocompletion } from "../util/codemirror";
import {
  highlightVariableRange,
  variableHighlightExtension,
} from "../util/codemirror/extension";

// CodeMirror's base theme gives its scroller a plain monospace font, which
// overrides any font set on the editor element, so the code font is set here.
const codeFontTheme = EditorView.theme({
  ".cm-scroller": {
    fontFamily:
      '"Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
  },
});

export interface EditorHandle {
  undo: () => void;
  redo: () => void;
}

interface EditorProps {
  code: string;
  onChange: (value: string) => void;
  onRender: (value?: string) => void;
  error: string | null;
}

const Editor = observer(forwardRef<EditorHandle, EditorProps>(({ code, onChange, onRender, error }, ref) => {
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  useImperativeHandle(ref, () => ({
    undo: () => {
      const view = editorRef.current?.view;
      if (view) undo(view);
    },
    redo: () => {
      const view = editorRef.current?.view;
      if (view) redo(view);
    },
  }));

  const handleCodeMirrorChange = (value: string) => {
    onChange(value);
  };

  // Read observable during render so observer triggers re-render on change
  const hoveredVariable = debugStore.hoveredVariable;

  // React to hoveredVariable changes and update highlighting
  useEffect(() => {
    const view = editorRef.current?.view;
    if (!view) return;

    if (hoveredVariable) {
      const range = debugStore.findVariableRange(hoveredVariable);
      if (range) {
        view.dispatch({
          effects: highlightVariableRange.of(range),
          scrollIntoView: false,
        });
        return;
      }
    }
    // Clear highlight
    view.dispatch({
      effects: highlightVariableRange.of(null),
    });
  }, [hoveredVariable, code]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto scrollbar-hide">
        <CodeMirror
          ref={editorRef}
          value={code}
          onChange={handleCodeMirrorChange}
          onBlur={() => {
            debugStore.formatCurrentCode();
            onRender();
          }}
          extensions={[
            javascript(),
            ...createAutocompletion(),
            ...variableHighlightExtension,
            codeFontTheme,
          ]}
          theme="light"
          style={{ fontSize: "13px" }}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            dropCursor: false,
            allowMultipleSelections: false,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            highlightSelectionMatches: false,
            searchKeymap: true,
          }}
        />
      </div>
      {error && (
        <div className="flex-shrink-0 p-3 bg-red-100 text-red-700 border-t border-red-200 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}));

export default Editor;
