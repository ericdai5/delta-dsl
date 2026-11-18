import React, { useCallback, useEffect, useRef } from "react";

import { reaction } from "mobx";
import { observer } from "mobx-react-lite";

import { VAR_CLASSES } from "../internal/css-classes";
import { ComputationStore } from "../store/computation";
import { formatNumberForLatex } from "../util/format-number";
import { showInlineEditOverlay } from "../util/inline-edit-overlay";
import { getInputVariableState } from "../util/parse/variable";
import { enableTouchDrag } from "../util/touch-drag";
import { useMathJax } from "../util/use-mathjax";
import { useStore } from "./hooks";

type DisplayMode = "symbol" | "value" | "both" | "withUnits";

interface InlineVariableProps {
  /** Variable ID to render */
  id: string;
  /** Display mode: "symbol" (m), "value" (2), "both" (m = 2), "withUnits" (2 kg) */
  display?: DisplayMode;
  /** Optional class name */
  className?: string;
  /** Optional inline styles */
  style?: React.CSSProperties;
  /** Font scale relative to surrounding text (default: 1) */
  scale?: number;
}

/**
 * Get the appropriate CSS class for variable styling based on input type
 */
const getVariableClass = (input?: string): string => {
  if (input === "drag" || input === "inline") {
    return VAR_CLASSES.INPUT;
  }
  return VAR_CLASSES.BASE;
};

/**
 * Inline variable component that renders a single variable within text.
 * Supports hover highlighting and drag-to-change for input variables.
 */
const InlineVariableInner = observer(
  ({
    id,
    display = "value",
    scale = 1,
    computationStore,
  }: {
    id: string;
    display: DisplayMode;
    scale: number;
    computationStore: ComputationStore;
  }) => {
    const containerRef = useRef<HTMLSpanElement>(null);
    const { isLoaded: mathJaxLoaded } = useMathJax();
    const context = useStore();
    const config = context?.config;

    // Get the variable from store
    const getVariable = useCallback(() => {
      return computationStore.variables.get(id);
    }, [id, computationStore]);

    // Get highlight state for this variable (hovered or dragged)
    const isHovered = computationStore.isVariableHighlighted(id);
    const variable = getVariable();
    const variableClass = getVariableClass(variable?.input);

    // Build LaTeX string based on display mode
    const buildLatex = useCallback((): string | null => {
      const variable = getVariable();
      if (!variable) return null;

      // In step mode, use the isolated stepValues for display
      const isStepMode = computationStore.isStepMode();
      const value = isStepMode
        ? computationStore.getDisplayValue(id)
        : variable.value;
      const units = variable.units;
      const precision = variable.precision;
      const sigFigs = variable.sigFigs;

      // Format value
      let formattedValue = "";
      if (typeof value === "number") {
        formattedValue = formatNumberForLatex(value, {
          precision,
          sigFigs,
        });
      } else if (Array.isArray(value)) {
        formattedValue = `\\{${value.join(", ")}\\}`;
      } else {
        formattedValue = "?";
      }

      switch (display) {
        case "symbol":
          return id;
        case "value":
          return formattedValue;
        case "both":
          return `${id} = ${formattedValue}`;
        case "withUnits":
          return units
            ? `${formattedValue} \\, \\text{${units}}`
            : formattedValue;
        default:
          return formattedValue;
      }
    }, [id, display, getVariable]);

    // Attach hover, drag, and inline edit listeners
    const attachInteractionListeners = useCallback(
      (container: HTMLElement) => {
        const variable = computationStore.variables.get(id);
        if (!variable) return;

        const isDraggable = variable.input === "drag";
        const isInlineEditable = variable.input === "inline";

        // Make the whole container interactive
        container.style.cursor = isInlineEditable
          ? "text"
          : isDraggable
            ? "ns-resize"
            : "default";

        // Mouse enter - set hover state
        container.addEventListener("mouseenter", () => {
          computationStore.setVariableHover(id, true);
        });
        // Mouse leave - clear hover state
        container.addEventListener("mouseleave", () => {
          computationStore.setVariableHover(id, false);
        });

        // Add drag-to-change for draggable variables
        if (isDraggable) {
          let isDragging = false;
          let startY = 0;
          let startValue = 0;
          let lastClampedValue = 0;

          const variableState = getInputVariableState(id, computationStore);
          if (!variableState) return;

          const { stepSize, minValue, maxValue } = variableState;
          const isStepMode = computationStore.isStepMode();

          const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            e.preventDefault();
            e.stopPropagation();
            const deltaY = startY - e.clientY;
            const newValue = startValue + deltaY * stepSize;
            const clampedValue = Math.max(
              minValue,
              Math.min(maxValue, newValue)
            );
            lastClampedValue = clampedValue;
            // Update the current value for live feedback
            computationStore.setValue(id, clampedValue);
          };

          const handleMouseUp = (e: MouseEvent) => {
            if (isDragging) {
              isDragging = false;
              e.preventDefault();
              e.stopPropagation();
              document.removeEventListener("mousemove", handleMouseMove, true);
              document.removeEventListener("mouseup", handleMouseUp, true);
              // In step mode, update the config default and debounce reinitialization
              if (isStepMode && config?.variables && config.variables[id]) {
                const varDef = config.variables[id];
                if (typeof varDef === "object") {
                  varDef.default = lastClampedValue;
                }
              }
            }
          };

          const handleMouseDown = (e: MouseEvent) => {
            isDragging = true;
            startY = e.clientY;
            const currentVariable = computationStore.variables.get(id);
            startValue =
              typeof currentVariable?.value === "number"
                ? currentVariable.value
                : 0;
            lastClampedValue = startValue;
            e.preventDefault();
            e.stopPropagation();

            document.addEventListener("mousemove", handleMouseMove, true);
            document.addEventListener("mouseup", handleMouseUp, true);
          };

          container.addEventListener("mousedown", handleMouseDown);
          enableTouchDrag(container);
        }

        // Add click-to-edit for inline input variables
        // Allow editing for "value" and "withUnits" display modes (where the value is shown)
        const canInlineEdit = display === "value" || display === "withUnits";
        if (isInlineEditable && canInlineEdit) {
          const handleClick = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            // Don't open if already editing
            if (computationStore.editingStates.get(id)) {
              return;
            }

            // Find the MathJax element inside the container
            const mathJaxElement = (
              container.querySelector("mjx-mn") ??
              container.querySelector("mjx-mi") ??
              container.querySelector("mjx-mrow")
            ) as HTMLElement;

            if (mathJaxElement) {
              showInlineEditOverlay({
                varId: id,
                element: mathJaxElement,
                computationStore,
              });
            }
          };

          // Prevent mousedown from causing blur when editing
          const handleMouseDown = (e: MouseEvent) => {
            if (computationStore.editingStates.get(id)) {
              e.preventDefault();
            }
            e.stopPropagation();
          };

          container.addEventListener("click", handleClick);
          container.addEventListener("mousedown", handleMouseDown);
        }
      },
      [id, display, computationStore, config]
    );

    // Render the variable with MathJax
    const renderVariable = useCallback(async () => {
      if (!containerRef.current || !mathJaxLoaded || !window.MathJax) return;

      const latex = buildLatex();
      if (!latex) {
        console.warn(`InlineVariable: Variable not found with id "${id}"`);
        return;
      }

      try {
        const container = containerRef.current;
        // Clear previous MathJax content
        window.MathJax.typesetClear([container]);
        // Create element with inline math mode
        const mathSpan = document.createElement("span");
        mathSpan.style.fontSize = `${scale}em`;
        mathSpan.textContent = `\\(${latex}\\)`;
        // Replace content and typeset
        container.innerHTML = "";
        container.appendChild(mathSpan);
        await window.MathJax.typesetPromise([container]);
        // Attach interaction listeners
        attachInteractionListeners(container);
      } catch (error) {
        console.error("InlineVariable: Render error:", error);
      }
    }, [id, buildLatex, mathJaxLoaded, scale, attachInteractionListeners]);

    // Initial render when MathJax is ready
    useEffect(() => {
      if (mathJaxLoaded) {
        renderVariable();
      }
    }, [mathJaxLoaded, renderVariable]);

    // Re-render when variable value changes
    useEffect(() => {
      if (!mathJaxLoaded) return;

      const disposer = reaction(
        () => {
          const variable = computationStore.variables.get(id);
          // Also observe stepValuesVersion to re-render when step values change
          const stepVersion = computationStore.stepValuesVersion;
          return variable
            ? { value: variable.value, input: variable.input, stepVersion }
            : null;
        },
        () => {
          renderVariable();
        }
      );

      return () => disposer();
    }, [id, mathJaxLoaded, renderVariable, computationStore]);

    return (
      <span
        ref={containerRef}
        className={`inline-variable ${VAR_CLASSES.ALL} ${variableClass} ${
          isHovered ? "hovered" : ""
        }`}
        style={{ display: "inline", verticalAlign: "baseline" }}
      />
    );
  }
);

/**
 * InlineVariable - Renders a variable inline within text
 *
 * Usage:
 * ```tsx
 * <Provider config={config}>
 *   <p>The mass <InlineVariable id="m" display="withUnits" /> affects energy.</p>
 * </Provider>
 * ```
 */
export const InlineVariable: React.FC<InlineVariableProps> = observer(
  ({ id, display = "value", className = "", style = {}, scale = 1 }) => {
    const context = useStore();
    const instance = context?.instance;
    const isLoading = context?.isLoading ?? true;
    const computationStore = context?.computationStore;

    // Show placeholder while loading or no context
    if (isLoading || !instance || !computationStore) {
      return (
        <span
          className={`inline-variable ${className}`}
          style={{ display: "inline", ...style }}
        >
          ...
        </span>
      );
    }

    return (
      <span
        className={`inline-variable-wrapper ${className}`}
        style={{ display: "inline", ...style }}
      >
        <InlineVariableInner
          id={id}
          display={display}
          scale={scale}
          computationStore={computationStore}
        />
      </span>
    );
  }
);

export default InlineVariable;
