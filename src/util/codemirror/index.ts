import React from "react";

import { autocompletion } from "@codemirror/autocomplete";
import { ReactCodeMirrorRef } from "@uiw/react-codemirror";

import {
  editorCompletions,
  jsPatternCompletions,
} from "./autocomplete";
import { autocompleteTheme } from "./autocomplete-style";

/**
 * CodeMirror utility functions for code highlighting and manipulation
 */

/**
 * Shared basic setup configuration for CodeMirror editors
 * Provides consistent settings across all CodeMirror instances
 */
export const CodeMirrorSetup = {
  lineNumbers: true,
  foldGutter: false,
  dropCursor: false,
  allowMultipleSelections: false,
  indentOnInput: false,
  bracketMatching: true,
  closeBrackets: false,
  autocompletion: false,
  highlightSelectionMatches: false,
  searchKeymap: false,
};

/**
 * Shared style configuration for CodeMirror editors
 * Provides consistent appearance across all CodeMirror instances
 */
export const CodeMirrorStyle = {
  fontSize: "14px",
  fontFamily: '"Geist Mono", monospace',
  height: "100%",
  overflow: "auto" as const,
};

/**
 * Highlights a specific range of code in a CodeMirror editor
 * @param codeMirrorRef - React ref to the CodeMirror component
 * @param start - Start character position
 * @param end - End character position
 */
export const highlightCode = (
  codeMirrorRef: React.MutableRefObject<ReactCodeMirrorRef | null>,
  start: number,
  end: number
) => {
  if (codeMirrorRef.current) {
    const view = codeMirrorRef.current.view;
    if (view) {
      // Convert character positions to CodeMirror positions
      const doc = view.state.doc;
      const startPos = Math.min(start, doc.length);
      const endPos = Math.min(end, doc.length);
      // Set selection in CodeMirror
      view.dispatch({
        selection: { anchor: startPos, head: endPos },
        scrollIntoView: true,
      });
    }
  }
};

/**
 * Creates autocomplete extension for formula editor with custom completions
 */
export const createAutocompletion = () => {
  return [
    autocompletion({
      override: [editorCompletions, jsPatternCompletions],
      activateOnTyping: true,
      maxRenderedOptions: 10,
      closeOnBlur: true,
    }),
    autocompleteTheme,
  ];
};
