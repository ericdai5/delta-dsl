import React, { useCallback, useEffect, useRef } from "react";

import { reaction } from "mobx";
import { observer } from "mobx-react-lite";

import { VAR_SELECTORS } from "../internal/css-classes";
import { ComputationStore } from "../store/computation";
import { attachInlineEditHandler } from "../util/inline-edit-overlay";
import {
  getInputVariableState,
  processLatexContent,
} from "../util/parse/variable";
import {
  setupScaleWrappers,
  updateVariableHoverState,
} from "../util/scale-wrapper";
import { injectVariableSVGs } from "../util/svg/svg-processor";
import { enableTouchDrag } from "../util/touch-drag";
import { useMathJax } from "../util/use-mathjax";
import { getVariableElements } from "../util/variable-occurrence";
import { useStore } from "./hooks";

interface InlineFormulaProps {
  /** Formula ID to render (looks up from environment) */
  id: string;
  /** Optional class name */
  className?: string;
  /** Optional inline styles */
  style?: React.CSSProperties;
  /** Font scale relative to surrounding text (default: 1) */
  scale?: number;
}

/**
 * Inline formula component that renders MathJax formulas within text.
 * No React Flow canvas, no labels, no drag handles - just the formula.
 */
const InlineFormulaInner = observer(
  ({
    id,
    scale = 1,
    computationStore,
  }: {
    id: string;
    scale?: number;
    computationStore: ComputationStore;
  }) => {
    const containerRef = useRef<HTMLSpanElement>(null);
    const { isLoaded: mathJaxLoaded } = useMathJax();

    // Get formula latex by ID
    const getFormulaLatex = useCallback((): string | null => {
      const formulas = computationStore.environment?.formulas;
      if (!formulas) return null;
      const formula = formulas.find((f) => f.id === id);
      return formula?.latex || null;
    }, [id, computationStore.environment?.formulas]);

    // Attach hover and drag listeners to elements with variable IDs
    const attachVariableInteractionListeners = useCallback(
      (container: HTMLElement) => {
        // Get all variable IDs from the computation store
        const variableIds = Array.from(computationStore.variables.keys());

        variableIds.forEach((varId) => {
          const variable = computationStore.variables.get(varId);
          const isDraggable = variable?.input === "drag";
          const isInlineEditable = variable?.input === "inline";
          // Only enable inline editing on formula if latexDisplay is "value"
          // When latexDisplay is "name" (default), the label handles inline editing instead
          const latexDisplay = variable?.latexDisplay ?? "name";
          const elements = getVariableElements(container, varId);

          elements.forEach((element) => {
            const el = element as HTMLElement;

            // Mouse enter - set hover state
            el.addEventListener("mouseenter", () => {
              computationStore.setVariableHover(varId, true);
            });
            // Mouse leave - clear hover state
            el.addEventListener("mouseleave", () => {
              computationStore.setVariableHover(varId, false);
            });

            // Add click-to-edit for inline input variables
            if (isInlineEditable && latexDisplay === "value") {
              attachInlineEditHandler(el, varId, computationStore);
            }
            // Add drag-to-change for draggable variables
            else if (isDraggable) {
              el.style.cursor = "ns-resize";

              let isDragging = false;
              let startY = 0;
              let startValue = 0;

              const variableState = getInputVariableState(
                varId,
                computationStore
              );
              if (!variableState) return;

              const { stepSize, minValue, maxValue } = variableState;

              const handleMouseMove = (e: MouseEvent) => {
                if (!isDragging) return;
                e.preventDefault();
                e.stopPropagation();
                const deltaY = startY - e.clientY;
                const newValue = startValue + deltaY * stepSize;
                computationStore.setValue(
                  varId,
                  Math.max(minValue, Math.min(maxValue, newValue))
                );
              };

              const handleMouseUp = (e: MouseEvent) => {
                if (isDragging) {
                  isDragging = false;
                  e.preventDefault();
                  e.stopPropagation();
                  document.removeEventListener(
                    "mousemove",
                    handleMouseMove,
                    true
                  );
                  document.removeEventListener("mouseup", handleMouseUp, true);
                }
              };

              const handleMouseDown = (e: MouseEvent) => {
                isDragging = true;
                startY = e.clientY;
                // Get current value at drag start
                const currentVariable = computationStore.variables.get(varId);
                startValue =
                  typeof currentVariable?.value === "number"
                    ? currentVariable.value
                    : 0;
                e.preventDefault();
                e.stopPropagation();

                document.addEventListener("mousemove", handleMouseMove, true);
                document.addEventListener("mouseup", handleMouseUp, true);
              };

              el.addEventListener("mousedown", handleMouseDown);
              enableTouchDrag(el);
            }
          });
        });
      },
      [computationStore]
    );

    // Render the formula with MathJax
    const renderFormula = useCallback(async () => {
      if (!containerRef.current || !mathJaxLoaded || !window.MathJax) return;

      const latex = getFormulaLatex();
      if (!latex) {
        console.warn(`InlineFormula: Formula not found with id "${id}"`);
        return;
      }

      try {
        const container = containerRef.current;

        // Clear previous MathJax content
        window.MathJax.typesetClear([container]);

        // Process LaTeX to add interactive variable CSS classes
        let processedLatex: string;
        try {
          processedLatex = processLatexContent(latex, 2, computationStore, id);
        } catch (e) {
          console.warn(
            "InlineFormula: LaTeX processing failed, using raw latex"
          );
          processedLatex = latex;
        }

        // Create element with inline math mode (no \displaystyle for true inline)
        // Use scale prop (default 1) to match surrounding text
        const mathSpan = document.createElement("span");
        mathSpan.style.fontSize = `${scale}em`;
        mathSpan.textContent = `\\(${processedLatex}\\)`;

        // Replace content and typeset
        container.innerHTML = "";
        container.appendChild(mathSpan);
        await window.MathJax.typesetPromise([container]);

        // Inject SVG elements for variables after MathJax rendering
        try {
          injectVariableSVGs(container, computationStore);
        } catch (svgError) {
          console.error(
            "InlineFormula: Error injecting variable SVGs:",
            svgError
          );
        }

        // Wrap interactive variables so hover scaling happens outside MathJax layout.
        setupScaleWrappers(
          container,
          VAR_SELECTORS.ALL,
          computationStore.highlightedVarIds
        );

        // After rendering, attach hover and drag event listeners to variable elements
        attachVariableInteractionListeners(container);
      } catch (error) {
        console.error("InlineFormula: Render error:", error);
      }
    }, [
      id,
      getFormulaLatex,
      mathJaxLoaded,
      computationStore,
      scale,
      attachVariableInteractionListeners,
    ]);

    // Initial render when MathJax is ready
    useEffect(() => {
      if (mathJaxLoaded) {
        renderFormula();
      }
    }, [mathJaxLoaded, renderFormula]);

    // Re-render when variables change
    useEffect(() => {
      if (!mathJaxLoaded) return;

      const disposer = reaction(
        () => {
          // Track variable values for reactivity
          const entries = Array.from(computationStore.variables.entries());
          // Also track editing states to trigger re-render when editing ends
          const editingStates = Array.from(
            computationStore.editingStates.entries()
          );
          return {
            values: entries.map(([id, v]) => ({ id, value: v.value })),
            editingStates,
          };
        },
        () => {
          // Skip re-render if any variable is being edited
          if (computationStore.editingStates.size > 0) {
            return;
          }
          renderFormula();
        }
      );

      return () => disposer();
    }, [mathJaxLoaded, renderFormula, computationStore]);

    // React to highlight state changes and update DOM directly
    useEffect(() => {
      const disposer = reaction(
        () => computationStore.highlightedVarIds,
        (highlightedVarIds) => {
          if (!containerRef.current) return;
          updateVariableHoverState(containerRef.current, highlightedVarIds);
        }
      );
      return () => disposer();
    }, [computationStore]);

    return (
      <span
        ref={containerRef}
        className="inline-formula rendered-latex"
        style={{ display: "inline", verticalAlign: "baseline" }}
      />
    );
  }
);

/**
 * InlineFormula - Renders a formula inline within text
 *
 * Usage:
 * ```tsx
 * <Provider config={config}>
 *   <p>The formula <InlineFormula id="kinetic-energy" /> shows energy.</p>
 * </Provider>
 * ```
 */
export const InlineFormula: React.FC<InlineFormulaProps> = observer(
  ({ id, className = "", style = {}, scale = 1 }) => {
    const context = useStore();
    const instance = context?.instance;
    const isLoading = context?.isLoading ?? true;
    const computationStore = context?.computationStore;

    // Show placeholder while loading or no context
    if (isLoading || !instance || !computationStore) {
      return (
        <span
          className={`inline-formula ${className}`}
          style={{ display: "inline", ...style }}
        >
          ...
        </span>
      );
    }

    return (
      <span
        className={`inline-formula-wrapper ${className}`}
        style={{ display: "inline", ...style }}
      >
        <InlineFormulaInner
          id={id}
          scale={scale}
          computationStore={computationStore}
        />
      </span>
    );
  }
);

export default InlineFormula;
