import { useEffect, useRef } from "react";

import { ComputationStore } from "../store/computation";
import { getInputVariableState } from "./parse/variable";
import { enableTouchDrag } from "./touch-drag";

interface UseVariableDragProps {
  varId: string;
  isDraggable: boolean;
  hasDropdownOptions?: boolean;
  computationStore?: ComputationStore | null;
}

export const useVariableDrag = ({
  varId,
  isDraggable,
  hasDropdownOptions,
  computationStore,
}: UseVariableDragProps) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = nodeRef.current;
    // Early return if computationStore is not available
    if (!computationStore) return;
    if (!element || !isDraggable || hasDropdownOptions) return;
    let isDragging = false;
    let startY = 0;
    const variableState = getInputVariableState(varId, computationStore);
    if (!variableState) return;
    const { stepSize, minValue, maxValue } = variableState;
    // Get initial value from computation store
    const currentVariable = computationStore.variables.get(varId);
    const value = currentVariable?.value;
    let startValue = typeof value === "number" ? value : 0;
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
        // Clear dragging state - hover will be cleared by natural mouse leave if needed
        computationStore.setVariableDrag(varId, false);
        document.removeEventListener("mousemove", handleMouseMove, true);
        document.removeEventListener("mouseup", handleMouseUp, true);
      }
    };
    const handleMouseDown = (e: MouseEvent) => {
      isDragging = true;
      startY = e.clientY;
      // Update startValue to current value at drag start
      const currentVariable = computationStore.variables.get(varId);
      startValue =
        typeof currentVariable?.value === "number" ? currentVariable.value : 0;
      // Track which variable is being dragged
      computationStore.setVariableDrag(varId, true);
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      // Use capture phase to ensure we get the events first
      document.addEventListener("mousemove", handleMouseMove, true);
      document.addEventListener("mouseup", handleMouseUp, true);
    };
    element.addEventListener("mousedown", handleMouseDown);
    const disableTouchDrag = enableTouchDrag(element);
    return () => {
      disableTouchDrag();
      element.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("mouseup", handleMouseUp, true);
    };
  }, [varId, isDraggable, hasDropdownOptions, computationStore]);

  return nodeRef;
};
