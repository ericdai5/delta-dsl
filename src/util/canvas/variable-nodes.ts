import { type MutableRefObject, useCallback } from "react";

import { Node, useReactFlow } from "@xyflow/react";

import { VAR_SELECTORS } from "../../internal/css-classes";
import { ComputationStore } from "../../store/computation";
import {
  getVariableDimensionKey,
  getVariableOccurrenceRef,
} from "../variable-occurrence";
import {
  processVariableElementsForLabels,
  updateLabelPlacement,
} from "./label-node";
import {
  NODE_TYPES,
  findFormulaNodeById,
  forEachFormulaNode,
  getFormulaElementFromContainer,
  getRelativePositionAndDimensions,
  getVariableNodes,
} from "./node-helpers";

/*********** Helper Functions for Variable Nodes ***********/

/**
 * Check if MathJax is ready and execute callback, or wait and retry
 * @param callback - Function to execute when MathJax is ready
 * @param delay - Delay in ms to wait if MathJax isn't ready (default 200)
 */
export function whenMathJaxReady(
  callback: () => void,
  delay: number = 200
): void {
  if (
    window.MathJax &&
    window.MathJax.startup &&
    window.MathJax.startup.document
  ) {
    callback();
  } else {
    setTimeout(callback, delay);
  }
}

/**
 * Calculate position and dimensions of a variable element relative to its formula
 * @param varElement - The variable HTML element
 * @param formulaElement - The formula container element
 * @param viewport - The React Flow viewport
 * @returns Position and dimensions for creating a variable node
 */
export function getVariablePositionAndDimensions(
  varElement: HTMLElement,
  formulaElement: Element,
  viewport: { zoom: number }
): {
  position: { x: number; y: number };
  dimensions: { width: number; height: number };
} {
  const varRect = varElement.getBoundingClientRect();
  const formulaRect = formulaElement.getBoundingClientRect();
  return getRelativePositionAndDimensions(varRect, formulaRect, viewport);
}

/**
 * Create a variable node object
 * @param nodeId - The unique node ID
 * @param cssId - The CSS ID (varId) of the variable
 * @param instance - The 1-indexed variable occurrence in authored LaTeX order
 * @param position - Position relative to parent formula node
 * @param dimensions - Width and height of the variable element
 * @param parentId - The parent formula node ID
 * @param formulaId - The public formula ID
 * @returns A React Flow node object for the variable
 */
export function createVariableNode(
  nodeId: string,
  cssId: string,
  instance: number,
  position: { x: number; y: number },
  dimensions: { width: number; height: number },
  parentId: string,
  formulaId: string
): Node {
  return {
    id: nodeId,
    type: "variable",
    position,
    parentId,
    extent: "parent",
    data: {
      varId: cssId,
      symbol: cssId,
      instance,
      formulaId,
      formulaNodeId: parentId,
      width: dimensions.width,
      height: dimensions.height,
      labelPlacement: "below",
    },
    draggable: false,
    selectable: true,
  };
}

/**
 * Process variable elements within a formula and update/create variable nodes
 * @param formulaElement - The DOM element containing the formula
 * @param formulaNode - The React Flow formula node
 * @param index - The index of the formula
 * @param viewport - The React Flow viewport
 * @param variableNodes - Map of existing variable nodes
 * @param foundNodeIds - Set to track which node IDs were found
 * @returns Object containing arrays of updated and new nodes
 */
export const updateVarNodes = (
  formulaElement: Element,
  formulaNode: Node,
  id: string,
  viewport: { zoom: number },
  variableNodes: Map<string, Node>,
  foundNodeIds: Set<string>,
  computationStore: ComputationStore
): { updatedNodes: Node[]; newNodes: Node[] } => {
  const updatedNodes: Node[] = [];
  const newNodes: Node[] = [];
  const variableElements = formulaElement.querySelectorAll(
    VAR_SELECTORS.ALL
  );
  variableElements.forEach((varElement: Element) => {
    const htmlVarElement = varElement as HTMLElement;
    const occurrence = getVariableOccurrenceRef(htmlVarElement);
    if (!occurrence) return;
    const { varId: cssId, instance } = occurrence;
    if (!computationStore.variables.has(cssId)) return;
    const nodeId = `variable-${id}-${cssId}-${instance}`;
    foundNodeIds.add(nodeId);
    const { position, dimensions } = getVariablePositionAndDimensions(
      htmlVarElement,
      formulaElement,
      viewport
    );

    // Store fresh dimensions in computation store for use by expression node calculation
    // Scope the key to the exact authored occurrence in this formula.
    const dimensionKey = getVariableDimensionKey(id, cssId, instance);
    computationStore.setVariableDimensions(dimensionKey, {
      x: position.x,
      y: position.y,
      width: dimensions.width,
      height: dimensions.height,
    });

    const varNode = variableNodes.get(nodeId);
    if (varNode) {
      const posChanged =
        varNode.position.x !== position.x || varNode.position.y !== position.y;
      const dimChanged =
        varNode.data.width !== dimensions.width ||
        varNode.data.height !== dimensions.height;
      const occurrenceChanged =
        varNode.data.instance !== instance ||
        varNode.data.formulaId !== id ||
        varNode.data.formulaNodeId !== formulaNode.id;
      // Only add to updated nodes if something actually changed
      if (posChanged || dimChanged || occurrenceChanged) {
        updatedNodes.push({
          ...varNode,
          position,
          data: {
            ...varNode.data,
            instance,
            formulaId: id,
            formulaNodeId: formulaNode.id,
            width: dimensions.width,
            height: dimensions.height,
          },
        });
      }
    } else {
      // Create new node
      newNodes.push(
        createVariableNode(
          nodeId,
          cssId,
          instance,
          position,
          dimensions,
          formulaNode.id,
          id
        )
      );
    }
  });
  return { updatedNodes, newNodes };
};

/**
 * Create variable nodes from DOM elements for a single formula
 */
export const createVarNodes = (
  formulaElement: Element,
  formulaNode: Node,
  id: string,
  viewport: { zoom: number },
  computationStore: ComputationStore
): Node[] => {
  const { newNodes } = updateVarNodes(
    formulaElement,
    formulaNode,
    id,
    viewport,
    new Map(),
    new Set(),
    computationStore
  );
  return newNodes;
};

/**
 * Process all formula nodes and create/update variable nodes
 * @param currentNodes - All current React Flow nodes
 * @param viewport - The React Flow viewport
 * @param computationStore - Scoped computation store
 * @param existingVarNodes - Optional map of existing variable nodes (for update mode)
 * @param foundNodeIds - Optional set to track found node IDs (for update mode)
 * @returns Combined results from all formulas
 */
export const processAllFormulaVarNodes = (
  currentNodes: Node[],
  viewport: { zoom: number },
  computationStore: ComputationStore,
  existingVarNodes?: Map<string, Node>,
  foundNodeIds?: Set<string>
): { updatedNodes: Node[]; newNodes: Node[] } => {
  const updatedNodes: Node[] = [];
  const newNodes: Node[] = [];
  const varMap = existingVarNodes ?? new Map();
  const foundIds = foundNodeIds ?? new Set<string>();
  forEachFormulaNode(currentNodes, (formulaNode, formulaElement, id) => {
    const { updatedNodes: updated, newNodes: created } = updateVarNodes(
      formulaElement,
      formulaNode,
      id,
      viewport,
      varMap,
      foundIds,
      computationStore
    );
    updatedNodes.push(...updated);
    newNodes.push(...created);
  });
  return { updatedNodes, newNodes };
};

type Viewport = { zoom: number; x: number; y: number };

/**
 * Common wrapper for variable node operations
 * Handles requestAnimationFrame, MathJax readiness, and nodesInitialized check
 */
function withVarNodeContext(
  getNodes: () => Node[],
  getViewport: () => Viewport,
  nodesInitialized: boolean,
  callback: (nodes: Node[], viewport: Viewport) => void
): void {
  requestAnimationFrame(() => {
    whenMathJaxReady(() => {
      if (!nodesInitialized) return;
      callback(getNodes(), getViewport());
    });
  });
}

/**
 * Add variable nodes and label nodes for a single formula.
 * This is used by FormulaComponent where we know the specific formula ID.
 */
export function addVariableNodesForFormula({
  getNodes,
  getViewport,
  setNodes,
  nodesInitialized,
  bootstrapCompleteRef,
  formulaId,
  containerElement,
  computationStore,
}: {
  getNodes: () => Node[];
  getViewport: () => { zoom: number; x: number; y: number };
  setNodes: (nodes: Node[] | ((nodes: Node[]) => Node[])) => void;
  nodesInitialized: boolean;
  bootstrapCompleteRef: MutableRefObject<boolean>;
  formulaId: string;
  containerElement?: Element | null;
  computationStore: ComputationStore;
}): void {
  // Formula-only config: skip variable-node creation entirely.
  if (computationStore.variables.size === 0) {
    bootstrapCompleteRef.current = true;
    return;
  }

  withVarNodeContext(
    getNodes,
    getViewport,
    nodesInitialized,
    (currentNodes, viewport) => {
      const formulaElement = getFormulaElementFromContainer(
        containerElement,
        currentNodes,
        formulaId
      );
      if (!formulaElement) {
        return;
      }
      const formulaNode = findFormulaNodeById(currentNodes, formulaId);
      if (!formulaNode || !formulaNode.measured) {
        return;
      }
      const varNodes = createVarNodes(
        formulaElement,
        formulaNode,
        formulaId,
        viewport,
        computationStore
      );
      if (varNodes.length === 0) {
        bootstrapCompleteRef.current = true;
        return;
      }

      // Get active variables from computation store
      const activeVariables = computationStore.getActiveVariables();
      const currentStep = computationStore.currentStep;

      setNodes((currentNodes) => {
        const baseNodes = currentNodes.filter(
          (node) =>
            node.type !== NODE_TYPES.VARIABLE && node.type !== NODE_TYPES.LABEL
        );
        const nodesWithVariables = [...baseNodes, ...varNodes];
        const { labelNodes, variableNodeUpdates } =
          processVariableElementsForLabels(
            formulaElement!,
            formulaNode,
            formulaId,
            nodesWithVariables,
            viewport,
            computationStore,
            activeVariables,
            currentStep
          );
        const updatedVarNodes = updateLabelPlacement(
          varNodes,
          variableNodeUpdates
        );
        return [...baseNodes, ...updatedVarNodes, ...labelNodes];
      });
      bootstrapCompleteRef.current = true;
    }
  );
}

/**
 * Hook to get a function that adds variable nodes for all formulas. The
 * function keeps its identity between renders, so effects that depend on it
 * don't re-run on every render.
 */
export const useAddVariableNodes = ({
  nodesInitialized,
  setNodes,
  addLabelNodes,
  addstepNodes,
  bootstrapCompleteRef,
  computationStore,
}: {
  nodesInitialized: boolean;
  setNodes: (nodes: Node[] | ((nodes: Node[]) => Node[])) => void;
  bootstrapCompleteRef: MutableRefObject<boolean>;
  addLabelNodes: () => void;
  addstepNodes: () => void;
  computationStore: ComputationStore;
}) => {
  const { getNodes, getViewport } = useReactFlow();
  return useCallback(() => {
    // Formula-only config: skip variable-node creation entirely.
    if (computationStore.variables.size === 0) {
      bootstrapCompleteRef.current = true;
      return;
    }

    withVarNodeContext(
      getNodes,
      getViewport,
      nodesInitialized,
      (currentNodes, viewport) => {
        const { newNodes: varNodes } = processAllFormulaVarNodes(
          currentNodes,
          viewport,
          computationStore
        );
        if (varNodes.length === 0) {
          bootstrapCompleteRef.current = true;
          return;
        }
        setNodes((currentNodes) => {
          const nonVarNodes = currentNodes.filter(
            (node) => node.type !== NODE_TYPES.VARIABLE
          );
          return [...nonVarNodes, ...varNodes];
        });
        bootstrapCompleteRef.current = true;
        setTimeout(() => {
          addLabelNodes();
          addstepNodes();
        }, 100);
      }
    );
  }, [
    getNodes,
    getViewport,
    nodesInitialized,
    setNodes,
    addLabelNodes,
    addstepNodes,
    bootstrapCompleteRef,
    computationStore,
  ]);
};

/**
 * Hook to get a function that updates variable nodes or adds new ones. The
 * function keeps its identity between renders, so effects that depend on it
 * don't re-run on every render.
 */
export const useUpdateVariableNodes = ({
  nodesInitialized,
  setNodes,
  bootstrapCompleteRef,
  computationStore,
}: {
  nodesInitialized: boolean;
  setNodes: (nodes: Node[] | ((nodes: Node[]) => Node[])) => void;
  bootstrapCompleteRef: MutableRefObject<boolean>;
  computationStore: ComputationStore;
}) => {
  const { getNodes, getViewport } = useReactFlow();
  return useCallback(() => {
    withVarNodeContext(
      getNodes,
      getViewport,
      nodesInitialized,
      (currentNodes, viewport) => {
        const varNodes = getVariableNodes(currentNodes);
        const existingVarNodes = new Map<string, Node>();
        varNodes.forEach((node) => existingVarNodes.set(node.id, node));
        const foundNodeIds = new Set<string>();
        const { updatedNodes, newNodes } = processAllFormulaVarNodes(
          currentNodes,
          viewport,
          computationStore,
          existingVarNodes,
          foundNodeIds
        );
        const hasChanges =
          updatedNodes.length > 0 ||
          newNodes.length > 0 ||
          varNodes.some((node) => !foundNodeIds.has(node.id));
        if (hasChanges) {
          setNodes((currentNodes) => {
            const nonVarNodes = currentNodes.filter(
              (node) => node.type !== NODE_TYPES.VARIABLE
            );
            const keptVarNodes = getVariableNodes(currentNodes).filter((node) =>
              foundNodeIds.has(node.id)
            );
            const finalVarNodes = keptVarNodes.map(
              (node) => updatedNodes.find((u) => u.id === node.id) || node
            );
            return [...nonVarNodes, ...finalVarNodes, ...newNodes];
          });
        }
        if (foundNodeIds.size > 0) {
          bootstrapCompleteRef.current = true;
        }
      }
    );
  }, [
    getNodes,
    getViewport,
    nodesInitialized,
    setNodes,
    bootstrapCompleteRef,
    computationStore,
  ]);
};
