import { useCallback, useEffect, useRef, useState } from "react";

import { reaction, toJS } from "mobx";
import { observer } from "mobx-react-lite";

import { GripVertical } from "lucide-react";

import { useStore } from "../../core/hooks";
import { debugStore } from "../../store/debug";
import {
  FormulaNodeData,
  renderFormulaWithMathJax,
} from "../../util/canvas/formula-node";
import { buildDebugStyles } from "../../util/debug-styles";
import {
  setupScaleWrappers,
  updateVariableHoverState,
} from "../../util/scale-wrapper";
import { VAR_SELECTORS } from "../css-classes";

// Custom Formula Node Component
const FormulaNode = observer(({ data }: { data: FormulaNodeData }) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const context = useStore();
  const computationStore = context?.computationStore;

  // All hooks must be called before any conditional returns
  const [isInitialized, setIsInitialized] = useState(false);
  useEffect(() => {
    const initializeMathJax = async () => {
      if (!window.MathJax) {
        console.error("MathJax not loaded");
        return;
      }
      try {
        await window.MathJax.startup.promise;
        setIsInitialized(true);
      } catch (error) {
        console.error("Error initializing MathJax:", error);
      }
    };
    initializeMathJax();
  }, []);

  const renderFormula = useCallback(async () => {
    // Pass stores from context to the render function (convert null to undefined)
    const dataWithStores: FormulaNodeData = {
      ...data,
      computationStore: computationStore ?? undefined,
    };
    await renderFormulaWithMathJax(
      nodeRef.current,
      dataWithStores,
      isInitialized
    );
    // Pre-wrap all variable elements for scale animations
    // Pass highlighted var IDs to re-apply hover state after re-render
    if (nodeRef.current && computationStore) {
      setupScaleWrappers(
        nodeRef.current,
        VAR_SELECTORS.ALL
        // computationStore.highlightedVarIds
      );
      // Variables may have moved; let the canvas measure them again
      computationStore.markFormulaRendered();
    }
  }, [data, computationStore, isInitialized]);

  useEffect(() => {
    if (isInitialized) {
      renderFormula();
    }
  }, [isInitialized, renderFormula]);

  useEffect(() => {
    if (!computationStore) return;
    const disposer = reaction(
      () => ({
        variables: Array.from(computationStore.variables.entries()).map(
          ([id, v]) => ({
            id,
            input: v.input,
            value: v.value,
          })
        ),
        variableRolesChanged: computationStore.variableRolesChanged,
        // Re-render when active variables change (for index variable display)
        // Serialize activeVariables Map for change detection
        activeVariables: Array.from(
          computationStore.getActiveVariables().entries()
        ).map(([formulaId, varSet]) => [formulaId, Array.from(varSet)]),
        // Track editing states to trigger re-render when editing ends
        editingStates: Array.from(computationStore.editingStates.entries()),
      }),
      () => {
        // Skip re-render if any variable is being edited
        // (the input element is inside the formula and would be destroyed)
        if (computationStore.editingStates.size > 0) {
          return;
        }
        if (isInitialized) {
          renderFormula();
        }
      }
    );
    return () => disposer();
  }, [computationStore, isInitialized, renderFormula]);

  // React to hover state changes and update DOM directly
  // Uses scale wrapper helpers to apply transforms outside MathJax's layout
  useEffect(() => {
    if (!computationStore) return;
    const disposer = reaction(
      () => computationStore.highlightedVarIds,
      (highlightedVarIds) => {
        if (!nodeRef.current) return;
        updateVariableHoverState(nodeRef.current, highlightedVarIds);
      }
    );
    return () => disposer();
  }, [computationStore]);

  // All conditional returns must happen after all hooks are called
  if (!computationStore) return null;

  const customStyle = computationStore.environment?.formulaNodeStyle
    ? toJS(computationStore.environment.formulaNodeStyle)
    : {};

  // Default to showing drag handle unless explicitly set to false
  const showDragHandle = data.showDragHandle !== false;

  // Build debug styles that override customStyle when enabled
  const debugStyles = buildDebugStyles(
    debugStore.showFormulaBorders,
    debugStore.showFormulaShadow
  );

  return (
    <div
      ref={nodeRef}
      className="formula-node relative p-2.5 group"
      style={{ ...customStyle, ...debugStyles }}
    >
      {/* Left Handle - only show if showDragHandle is true */}
      {showDragHandle && (
        <div className="formula-drag-handle absolute top-1/2 -left-4 transform -translate-y-1/2 bg-white border border-slate-200 hover:bg-slate-50 rounded-md px-0.5 py-1 cursor-move z-20 opacity-0 transition-opacity duration-200">
          <GripVertical size={14} className="text-slate-400" />
        </div>
      )}
      {/* Formula content container - nodrag allows click events for inline editing */}
      <div className="formula nodrag">
        <div className="rendered-latex"></div>
      </div>
    </div>
  );
});

export default FormulaNode;
