import React, { useCallback, useEffect, useRef, useState } from "react";

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
import { enableTouchDrag } from "../util/touch-drag";
import { useMathJax } from "../util/use-mathjax";
import { getVariableElements } from "../util/variable-occurrence";
import { useStore } from "./hooks";

interface EmbeddedFormulaProps {
  /** Formula ID to render (looks up from environment) */
  id: string;
  /** Optional: Direct LaTeX string (overrides id lookup) */
  latex?: string;
  /**
   * Optional: Abbreviated LaTeX to show by default.
   * If provided, the formula will show this abbreviated version normally,
   * and expand to show the full formula on hover.
   * The full formula is either the `latex` prop or looked up by `id`.
   */
  abbreviation?: string;
  /** Font scale (default: 0.7 for compact display) */
  scale?: number;
  /** Whether to highlight when formula is hovered via hover system */
  highlightOnHover?: boolean;
  /** Whether clicking can pin the formula open (default: true) */
  allowPinning?: boolean;
  /** Callback when this formula is hovered */
  onHover?: (isHovered: boolean) => void;
  /** Optional class name */
  className?: string;
  /** Optional inline styles */
  style?: React.CSSProperties;
}

/**
 * Inner component that receives stores as props
 */
const EmbeddedFormulaInner = observer(
  ({
    id,
    directLatex,
    abbreviation,
    scale = 0.7,
    highlightOnHover = true,
    allowPinning = true,
    onHover,
    className = "",
    style = {},
    computationStore,
  }: {
    id: string;
    directLatex?: string;
    abbreviation?: string;
    scale?: number;
    highlightOnHover?: boolean;
    allowPinning?: boolean;
    onHover?: (isHovered: boolean) => void;
    className?: string;
    style?: React.CSSProperties;
    computationStore: ComputationStore;
  }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { isLoaded: mathJaxLoaded } = useMathJax();
    const [isExpanded, setIsExpanded] = useState(false);
    const [isPinned, setIsPinned] = useState(false);
    const isDraggingRef = useRef(false);

    // Get formula latex by ID or use direct latex
    const getFullLatex = useCallback((): string | null => {
      if (directLatex) return directLatex;
      const formulas = computationStore.environment?.formulas;
      if (!formulas) return null;
      const formula = formulas.find((f) => f.id === id);
      return formula?.latex || null;
    }, [id, directLatex, computationStore.environment?.formulas]);

    // Determine which latex to display based on abbreviation, hover state, and pinned state
    const getDisplayLatex = useCallback((): string | null => {
      // If we have an abbreviation and we're not expanded or pinned, show abbreviated
      if (abbreviation && !isExpanded && !isPinned) {
        return abbreviation;
      }
      // Otherwise show the full formula
      return getFullLatex();
    }, [abbreviation, isExpanded, isPinned, getFullLatex]);

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
                  isDraggingRef.current = false;
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
                isDraggingRef.current = true;
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

      const latex = getDisplayLatex();
      if (!latex) {
        console.warn(`EmbeddedFormula: Formula not found with id "${id}"`);
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
            "EmbeddedFormula: LaTeX processing failed, using raw latex"
          );
          processedLatex = latex;
        }

        // Create element with inline math mode
        const mathSpan = document.createElement("span");
        mathSpan.style.fontSize = `${scale}em`;
        mathSpan.textContent = `\\(${processedLatex}\\)`;

        // Replace content and typeset
        container.innerHTML = "";
        container.appendChild(mathSpan);
        await window.MathJax.typesetPromise([container]);

        // Wrap interactive variables so hover scaling happens outside MathJax layout.
        setupScaleWrappers(
          container,
          VAR_SELECTORS.ALL,
          computationStore.highlightedVarIds
        );

        // After rendering, attach hover and drag event listeners to variable elements
        attachVariableInteractionListeners(container);
      } catch (error) {
        console.error("EmbeddedFormula: Render error:", error);
      }
    }, [
      id,
      getDisplayLatex,
      mathJaxLoaded,
      scale,
      attachVariableInteractionListeners,
      computationStore,
    ]);

    // Initial render and re-render when expansion or pinned state changes
    useEffect(() => {
      if (mathJaxLoaded) {
        renderFormula();
      }
    }, [mathJaxLoaded, renderFormula, isExpanded, isPinned]);

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

    // React to formula hover state (from visualization hover)
    useEffect(() => {
      if (!highlightOnHover) return;

      const disposer = reaction(
        () => computationStore.getFormulaHover(id),
        (isHovered) => {
          if (!containerRef.current) return;
          if (isHovered) {
            containerRef.current.classList.add("formula-highlighted");
          } else {
            containerRef.current.classList.remove("formula-highlighted");
          }
        }
      );
      return () => disposer();
    }, [id, highlightOnHover, computationStore]);

    // Handle mouse events for bidirectional hover and abbreviation expansion
    const handleMouseEnter = useCallback(() => {
      computationStore.setFormulaHover(id, true);
      if (abbreviation) {
        setIsExpanded(true);
      }
      onHover?.(true);
    }, [id, abbreviation, onHover, computationStore]);

    const handleMouseLeave = useCallback(() => {
      computationStore.setFormulaHover(id, false);
      // Only collapse if not pinned and not currently dragging
      if (abbreviation && !isPinned && !isDraggingRef.current) {
        setIsExpanded(false);
      }
      onHover?.(false);
    }, [id, abbreviation, isPinned, onHover, computationStore]);

    // Handle click to toggle pinned state (only if allowPinning is true)
    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        if (!allowPinning) return;
        // Don't toggle if clicking on a variable (they have their own input handlers)
        const target = e.target as HTMLElement;
        const variableTarget = target.closest(
          `.var-scale-wrapper, ${VAR_SELECTORS.ALL}`
        );
        if (variableTarget && e.currentTarget.contains(variableTarget)) {
          return;
        }
        if (abbreviation) {
          setIsPinned((prev) => !prev);
        }
      },
      [abbreviation, allowPinning]
    );

    return (
      <div
        ref={containerRef}
        className={`embedded-formula rendered-latex ${className} ${isPinned ? "formula-pinned" : ""}`}
        style={{
          display: "inline-block",
          padding: "2px 4px",
          borderRadius: "4px",
          transition: "background-color 0.15s ease",
          cursor: abbreviation ? "pointer" : "default",
          ...style,
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />
    );
  }
);

/**
 * EmbeddedFormula - A lightweight formula component for embedding within visualizations.
 *
 * Unlike InlineFormula, this component:
 * - Is designed to be embedded within SVG foreignObject or other visualization contexts
 * - Supports bidirectional hover highlighting with the visualization
 * - Has a more compact default scale
 * - Triggers formula hover events for visualization synchronization
 * - Optionally supports abbreviated display that expands on hover
 *
 * @example Basic usage
 * ```tsx
 * <foreignObject x={100} y={50} width={200} height={50}>
 *   <EmbeddedFormula
 *     id="formula_z_1_1"
 *     highlightOnHover={true}
 *   />
 * </foreignObject>
 * ```
 *
 * @example With abbreviation (expands on hover)
 * ```tsx
 * <EmbeddedFormula
 *   id="formula_h_1_1"
 *   abbreviation="h_1^{(1)}"  // Shows this by default
 *   // On hover, shows full formula looked up by id
 * />
 * ```
 */
export const EmbeddedFormula: React.FC<EmbeddedFormulaProps> = observer(
  ({
    id,
    latex,
    abbreviation,
    scale = 0.7,
    highlightOnHover = true,
    allowPinning = true,
    onHover,
    className = "",
    style = {},
  }) => {
    const context = useStore();
    const isLoading = context?.isLoading ?? true;
    const computationStore = context?.computationStore;

    // Show placeholder while loading or no context
    if (isLoading || !computationStore) {
      return (
        <span
          className={`embedded-formula ${className}`}
          style={{ display: "inline", ...style }}
        >
          ...
        </span>
      );
    }

    return (
      <EmbeddedFormulaInner
        id={id}
        directLatex={latex}
        abbreviation={abbreviation}
        scale={scale}
        highlightOnHover={highlightOnHover}
        allowPinning={allowPinning}
        onHover={onHover}
        className={className}
        style={style}
        computationStore={computationStore}
      />
    );
  }
);

export default EmbeddedFormula;
