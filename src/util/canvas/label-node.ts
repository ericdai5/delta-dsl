import { Node } from "@xyflow/react";

import { VAR_SELECTORS } from "../../internal/css-classes";
import { ComputationStore } from "../../store/computation";
import { ICollectedStep } from "../../types/step";
import {
  NODE_TYPES,
  findFormulaNodeById,
  findVariableNodesForFormulaNode,
  forEachFormulaNode,
  getFormulaElementFromContainer,
  getVariableNodes,
} from "./node-helpers";

// Common type for label placement direction
type PlacementDirection = "below" | "above";

// Enhanced label positioning system
export interface LabelPlacement {
  x: number;
  y: number;
  placement: PlacementDirection;
}

export interface NodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  id: string;
  type: "variable" | "label" | "formula";
}

/**
 * Advanced optimal label positioning system that places labels outside formula nodes
 * while maintaining horizontal alignment with their variables
 */
export const getLabelNodePos = (
  varNodePos: { x: number; y: number },
  varNodeDim: { width: number; height: number },
  formulaNode: Node,
  formulaNodeDim: { width: number; height: number },
  viewport: { zoom: number },
  forcePlacement?: "above" | "below"
): LabelPlacement => {
  // Since labels are hidden initially and repositioned using measured dimensions,
  // we just need simple placeholder values
  const placeholderHeight = 24;

  // Define spacing constants (adjusted for zoom)
  const spacing = {
    vertical: 10 / viewport.zoom, // Space between formula and labels
  };

  // varNodePos is already relative to the formula node (from HTML element positioning)
  const formulaNodePos = formulaNode.position;

  // For initial hidden render, just position at variable center
  // Actual positioning will be calculated using measured dimensions
  const absoluteVariableX = formulaNodePos.x + varNodePos.x;
  const variableCenterX = absoluteVariableX + varNodeDim.width / 2;
  const labelX = variableCenterX; // Simple center position for placeholder

  // Possible placement strategies: above or below the formula node.
  const placements: Array<{
    type: LabelPlacement["placement"];
    position: { x: number; y: number };
  }> = [
    {
      type: "below",
      position: {
        x: labelX,
        y: formulaNodePos.y + formulaNodeDim.height + spacing.vertical,
      },
    },
    {
      type: "above",
      position: {
        x: labelX,
        y: formulaNodePos.y - placeholderHeight - spacing.vertical,
      },
    },
  ];

  // If forcePlacement is provided, select that placement
  if (forcePlacement) {
    const forced = placements.find((p) => p.type === forcePlacement);
    if (forced) {
      return {
        x: forced.position.x,
        y: forced.position.y,
        placement: forced.type,
      };
    }
  }

  // Default (non-step) mode: choose the lane that yields a shorter vertical path
  // from variable center to label center. This keeps edges more direct.
  const variableCenterY =
    formulaNodePos.y + varNodePos.y + varNodeDim.height / 2;
  const formulaCenterY = formulaNodePos.y + formulaNodeDim.height / 2;
  const abovePlacement = placements.find((p) => p.type === "above");
  const belowPlacement = placements.find((p) => p.type === "below");
  if (!abovePlacement || !belowPlacement) {
    return {
      x: labelX,
      y: formulaNodePos.y + formulaNodeDim.height + spacing.vertical,
      placement: "below",
    };
  }

  const aboveCenterY = abovePlacement.position.y + placeholderHeight / 2;
  const belowCenterY = belowPlacement.position.y + placeholderHeight / 2;
  const aboveDistance = Math.abs(variableCenterY - aboveCenterY);
  const belowDistance = Math.abs(variableCenterY - belowCenterY);
  let selectedPlacement = belowPlacement;
  if (aboveDistance < belowDistance) {
    selectedPlacement = abovePlacement;
  } else if (aboveDistance === belowDistance) {
    selectedPlacement =
      variableCenterY <= formulaCenterY ? abovePlacement : belowPlacement;
  }

  return {
    x: selectedPlacement.position.x,
    y: selectedPlacement.position.y,
    placement: selectedPlacement.type,
  };
};

export interface AddLabelNodesParams {
  getNodes: () => Node[];
  getViewport: () => { zoom: number; x: number; y: number };
  setNodes: (nodes: Node[] | ((nodes: Node[]) => Node[])) => void;
  computationStore: ComputationStore;
}

export interface AdjustLabelPositionsParams {
  getNodes: () => Node[];
  setNodes: (nodes: Node[] | ((nodes: Node[]) => Node[])) => void;
  lockCurrentPlacements?: boolean;
}

export interface UpdateLabelNodesParams {
  getNodes: () => Node[];
  getViewport: () => { zoom: number; x: number; y: number };
  setNodes: (nodes: Node[] | ((nodes: Node[]) => Node[])) => void;
  formulaId: string;
  containerElement?: Element | null;
  computationStore: ComputationStore;
}

interface LabelPlacementUpdate {
  nodeId: string;
  labelPlacement: PlacementDirection;
}

/**
 * Apply labelPlacement updates to variable nodes
 * @param nodes - Array of nodes to update
 * @param updates - Array of updates with nodeId and labelPlacement
 * @returns Updated nodes array
 */
export const updateLabelPlacement = (
  nodes: Node[],
  updates: LabelPlacementUpdate[]
): Node[] => {
  if (updates.length === 0) return nodes;
  const updatesByNodeId = new Map(
    updates.map((update) => [update.nodeId, update.labelPlacement])
  );
  return nodes.map((node) => {
    const labelPlacement = updatesByNodeId.get(node.id);
    if (labelPlacement) {
      if (
        (node.data as { labelPlacement?: PlacementDirection })
          .labelPlacement === labelPlacement
      ) {
        return node;
      }
      return {
        ...node,
        data: {
          ...node.data,
          labelPlacement,
        },
      };
    }
    return node;
  });
};

const hasLabelPlacementChanges = (
  nodes: Node[],
  updates: LabelPlacementUpdate[]
): boolean => {
  if (updates.length === 0) return false;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return updates.some(({ nodeId, labelPlacement }) => {
    const node = nodeById.get(nodeId);
    if (!node) return false;
    return (
      (node.data as { labelPlacement?: PlacementDirection }).labelPlacement !==
      labelPlacement
    );
  });
};

const isExpressionLabelNode = (node: Node): boolean =>
  node.type === NODE_TYPES.LABEL &&
  (node.data as { labelKind?: string } | undefined)?.labelKind === "expression";

const isVariableLabelNodeForFormula = (
  node: Node,
  formulaId: string
): boolean =>
  node.type === NODE_TYPES.LABEL &&
  node.data.formulaId === formulaId &&
  !isExpressionLabelNode(node);

const HIDDEN_LABEL_STYLE = {
  opacity: 0,
  pointerEvents: "none" as const,
};

const isFormulaTargetedInStep = (
  formulaId: string,
  isStepMode: boolean,
  currentStep?: ICollectedStep
): boolean => {
  if (!isStepMode) return true;
  const formulaMap = currentStep?.formulas;
  if (!formulaMap) return true;

  const formulaIds = Object.keys(formulaMap);
  return formulaIds.includes("") || formulaIds.includes(formulaId);
};

const isRenderableValue = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  return typeof value !== "number" || !isNaN(value);
};

const shouldRenderVariableLabel = ({
  labelDisplay,
  name,
  displayValue,
}: {
  labelDisplay?: string;
  name?: string;
  displayValue: unknown;
}): boolean => {
  if (labelDisplay === "none") return false;

  const hasValue = isRenderableValue(displayValue);
  const hasName = !!name;

  // value-only labels still render when a name is present.
  if (labelDisplay === "value" && !hasValue && !hasName) return false;
  return hasValue || hasName;
};

const isVariableActiveInFormula = (
  varId: string,
  allFormulaVars?: Set<string>,
  thisFormulaVars?: Set<string>
): boolean => {
  return !!allFormulaVars?.has(varId) || !!thisFormulaVars?.has(varId);
};

const getVariableDisplayValue = (
  varId: string,
  isStepMode: boolean,
  computationStore: ComputationStore,
  fallbackValue: unknown
): unknown => {
  if (isStepMode) {
    return computationStore.getDisplayValue(varId);
  }
  return fallbackValue;
};

const createHiddenVariableLabelNode = ({
  formulaId,
  variableId,
  formulaNode,
  labelPos,
  lockPlacement,
}: {
  formulaId: string;
  variableId: string;
  formulaNode: Node;
  labelPos: LabelPlacement;
  lockPlacement: boolean;
}): Node => {
  const relativePosition = {
    x: labelPos.x - formulaNode.position.x,
    y: labelPos.y - formulaNode.position.y,
  };

  return {
    id: `label-${formulaId}-${variableId}`,
    type: "label",
    position: relativePosition,
    parentId: formulaNode.id,
    data: {
      varId: variableId,
      formulaId,
      placement: labelPos.placement,
      lockPlacement,
    },
    draggable: false,
    selectable: false,
    style: { ...HIDDEN_LABEL_STYLE },
  };
};

/**
 * Process variable elements for a single formula and create label nodes
 * @param formulaElement - The DOM element containing the formula
 * @param formulaNode - The React Flow formula node
 * @param id - The ID of the formula (e.g., "kinetic-energy")
 * @param currentNodes - Array of all current React Flow nodes
 * @param viewport - The React Flow viewport
 * @returns Object containing arrays of label nodes and variable node updates
 */
export const processVariableElementsForLabels = (
  formulaElement: Element,
  formulaNode: Node,
  id: string,
  currentNodes: Node[],
  viewport: { zoom: number; x: number; y: number },
  computationStore: ComputationStore,
  activeVariables: Map<string, Set<string>>,
  currentStep?: ICollectedStep
): {
  labelNodes: Node[];
  variableNodeUpdates: LabelPlacementUpdate[];
} => {
  const isStepMode = computationStore.isStepMode();
  const labelNodes: Node[] = [];
  const variableNodeUpdates: LabelPlacementUpdate[] = [];
  const useStepLayoutPreference = isStepMode && !!currentStep;

  if (!isFormulaTargetedInStep(id, isStepMode, currentStep)) {
    return { labelNodes, variableNodeUpdates };
  }

  const formulaDimensions = getNodeDimensions(formulaNode, {
    width: DEFAULT_DIMENSIONS.formulaWidth,
    height: DEFAULT_DIMENSIONS.formulaHeight,
  });
  const variableNodes = getVariableNodes(currentNodes);
  const allFormulasVars = activeVariables.get("");
  const thisFormulaVars = activeVariables.get(id);

  // Track which variables already have labels to prevent duplicates
  const processedVariables = new Set<string>();
  // Find variable elements within this formula
  const variableElements = formulaElement.querySelectorAll(
    VAR_SELECTORS.ALL
  );
  variableElements.forEach((varElement: Element) => {
    const htmlVarElement = varElement as HTMLElement;
    const cssId = htmlVarElement.id;
    if (!cssId) return;
    // Skip if we've already processed this variable
    if (processedVariables.has(cssId)) return;
    processedVariables.add(cssId);

    const variable = computationStore.variables.get(cssId);

    const displayValue = getVariableDisplayValue(
      cssId,
      isStepMode,
      computationStore,
      variable?.value
    );

    if (
      !shouldRenderVariableLabel({
        labelDisplay: variable?.labelDisplay,
        name: variable?.name,
        displayValue,
      })
    ) {
      return;
    }

    if (
      isStepMode &&
      !isVariableActiveInFormula(cssId, allFormulasVars, thisFormulaVars)
    ) {
      return;
    }

    const variableNode = findVariableNodesForFormulaNode(
      variableNodes,
      formulaNode.id,
      cssId
    )[0];
    if (!variableNode) return;

    const htmlElementPosition = variableNode.position;
    const htmlElementDimensions = {
      width: (variableNode.data.width as number) || 0,
      height: (variableNode.data.height as number) || 0,
    };

    const labelPos = getLabelNodePos(
      htmlElementPosition,
      htmlElementDimensions,
      formulaNode,
      formulaDimensions,
      viewport,
      useStepLayoutPreference ? "below" : undefined
    );

    labelNodes.push(
      createHiddenVariableLabelNode({
        formulaId: id,
        variableId: cssId,
        formulaNode,
        labelPos,
        // In step mode, variable labels are intentionally anchored to a specific lane.
        // Keep them locked during later placement optimization.
        lockPlacement: useStepLayoutPreference,
      })
    );

    variableNodeUpdates.push({
      nodeId: variableNode.id,
      labelPlacement: labelPos.placement,
    });
  });
  return { labelNodes, variableNodeUpdates };
};

/**
 * Update label nodes for a single formula.
 * This is used by FormulaComponent when activeVariables change.
 * Optimized to only add/remove labels when the set of active variables changes,
 * NOT when values change (values are handled by LabelNode component via MobX).
 */
export const updateLabelNodes = ({
  getNodes,
  getViewport,
  setNodes,
  formulaId,
  containerElement,
  computationStore,
}: UpdateLabelNodesParams): boolean => {
  const currentNodes = getNodes();
  const viewport = getViewport();

  // Get active variables and current step from computation store
  const activeVariables = computationStore.getActiveVariables();
  const currentStep = computationStore.currentStep;
  const formulaElement = getFormulaElementFromContainer(
    containerElement,
    currentNodes,
    formulaId
  );
  if (!formulaElement) return false;
  const formulaNode = findFormulaNodeById(currentNodes, formulaId);
  if (!formulaNode || !formulaNode.measured) return false;
  // Get existing variable nodes for this formula
  const existingVariableNodes = currentNodes.filter(
    (node) =>
      node.type === NODE_TYPES.VARIABLE && node.parentId === formulaNode.id
  );

  if (existingVariableNodes.length === 0) return false;

  // Get existing label nodes for this formula
  const existingLabelNodes = currentNodes.filter((node) =>
    isVariableLabelNodeForFormula(node, formulaId)
  );
  const existingLabelVarIds = new Set(
    existingLabelNodes.map((node) => node.data.varId as string)
  );

  // Calculate which labels should exist based on current activeVariables
  // We need to process the formula to determine this
  const nonLabelNodes = currentNodes.filter(
    (node) => node.type !== NODE_TYPES.LABEL
  );
  const { labelNodes: newLabelNodes, variableNodeUpdates } =
    processVariableElementsForLabels(
      formulaElement!,
      formulaNode,
      formulaId,
      nonLabelNodes,
      viewport,
      computationStore,
      activeVariables,
      currentStep
    );
  const newLabelVarIds = new Set(
    newLabelNodes.map((node) => node.data.varId as string)
  );

  // Check if the set of active variables has changed
  const sameActiveSet =
    existingLabelVarIds.size === newLabelVarIds.size &&
    [...existingLabelVarIds].every((id) => newLabelVarIds.has(id));

  if (sameActiveSet) {
    // Same active variables - no need to recreate labels
    // Just update variable node placements if needed
    if (hasLabelPlacementChanges(currentNodes, variableNodeUpdates)) {
      setNodes((currentNodes) => {
        return updateLabelPlacement(currentNodes, variableNodeUpdates);
      });
    }
    return false;
  }

  // Active variables changed - need to add/remove labels
  setNodes((currentNodes) => {
    // Remove only variable labels owned by this formula.
    // Preserve expression labels and labels from other formulas.
    const nonManagedNodes = currentNodes.filter(
      (node) => !isVariableLabelNodeForFormula(node, formulaId)
    );

    // Keep existing labels that are still needed
    const keptLabels = existingLabelNodes.filter((node) =>
      newLabelVarIds.has(node.data.varId as string)
    );

    // Find newly needed labels (not in existing)
    const labelsToAdd = newLabelNodes.filter(
      (node) => !existingLabelVarIds.has(node.data.varId as string)
    );

    // Apply variable node updates (labelPlacement)
    const updatedNodes = updateLabelPlacement(
      nonManagedNodes,
      variableNodeUpdates
    );

    return [...updatedNodes, ...keptLabels, ...labelsToAdd];
  });
  return true;
};

/**
 * Update label nodes for all formulas in the canvas (multi-formula version).
 * This updates labels in place rather than removing and re-adding them,
 * which prevents flickering during step transitions.
 */
export const updateAllLabelNodes = ({
  getNodes,
  getViewport,
  setNodes,
  computationStore,
}: AddLabelNodesParams): boolean => {
  const currentNodes = getNodes();
  const viewport = getViewport();

  // Get active variables and current step from computation store
  const activeVariables = computationStore.getActiveVariables();
  const currentStep = computationStore.currentStep;

  // Collect updates for all formulas
  const allNewLabelNodes: Node[] = [];
  const allVariableNodeUpdates: LabelPlacementUpdate[] = [];
  const labelIdsToKeep = new Set<string>();

  forEachFormulaNode(currentNodes, (formulaNode, formulaElement, formulaId) => {
    // Get existing label nodes for this formula
    const existingLabelNodes = currentNodes.filter((node) =>
      isVariableLabelNodeForFormula(node, formulaId)
    );
    const existingLabelVarIds = new Set(
      existingLabelNodes.map((node) => node.data.varId as string)
    );

    // Calculate which labels should exist based on current activeVariables
    const nonLabelNodes = currentNodes.filter(
      (node) => node.type !== NODE_TYPES.LABEL
    );
    const { labelNodes: newLabelNodes, variableNodeUpdates } =
      processVariableElementsForLabels(
        formulaElement,
        formulaNode,
        formulaId,
        nonLabelNodes,
        viewport,
        computationStore,
        activeVariables,
        currentStep
      );

    const newLabelVarIds = new Set(
      newLabelNodes.map((node) => node.data.varId as string)
    );

    // Determine which existing labels to keep
    for (const existingLabel of existingLabelNodes) {
      const varId = existingLabel.data.varId as string;
      if (newLabelVarIds.has(varId)) {
        labelIdsToKeep.add(existingLabel.id);
      }
    }

    // Determine which new labels to add (not in existing)
    for (const newLabel of newLabelNodes) {
      const varId = newLabel.data.varId as string;
      if (!existingLabelVarIds.has(varId)) {
        allNewLabelNodes.push(newLabel);
      }
    }

    allVariableNodeUpdates.push(...variableNodeUpdates);
  });

  const hasVariableLabelRemovals = currentNodes.some((node) => {
    if (node.type !== NODE_TYPES.LABEL) return false;
    if (isExpressionLabelNode(node)) return false;
    return !labelIdsToKeep.has(node.id);
  });

  if (
    !hasVariableLabelRemovals &&
    allNewLabelNodes.length === 0 &&
    !hasLabelPlacementChanges(currentNodes, allVariableNodeUpdates)
  ) {
    return false;
  }

  // Apply all updates in a single setNodes call
  setNodes((currentNodes) => {
    // Remove labels that are no longer needed, keep all other nodes
    const filteredNodes = currentNodes.filter((node) => {
      if (node.type !== NODE_TYPES.LABEL) return true;
      // Always keep expression labels (they are managed by step-node.ts)
      if (isExpressionLabelNode(node)) return true;
      // Keep variable label if it's in the keep set
      return labelIdsToKeep.has(node.id);
    });

    // Apply variable node updates (labelPlacement)
    const updatedNodes = updateLabelPlacement(
      filteredNodes,
      allVariableNodeUpdates
    );

    // Add new labels
    return [...updatedNodes, ...allNewLabelNodes];
  });
  return hasVariableLabelRemovals || allNewLabelNodes.length > 0;
};

/**
 * Add label nodes to the canvas after variable nodes are positioned
 */
export const addLabelNodes = ({
  getNodes,
  getViewport,
  setNodes,
  computationStore,
}: AddLabelNodesParams): void => {
  const currentNodes = getNodes();
  const viewport = getViewport();
  const labelNodes: Node[] = [];
  const variableNodeUpdates: LabelPlacementUpdate[] = [];

  // Get active variables and current step from computation store
  const activeVariables = computationStore.getActiveVariables();
  const currentStep = computationStore.currentStep;

  forEachFormulaNode(currentNodes, (formulaNode, formulaElement, id) => {
    const { labelNodes: formulaLabels, variableNodeUpdates: formulaUpdates } =
      processVariableElementsForLabels(
        formulaElement,
        formulaNode,
        id,
        currentNodes,
        viewport,
        computationStore,
        activeVariables,
        currentStep
      );
    labelNodes.push(...formulaLabels);
    variableNodeUpdates.push(...formulaUpdates);
  });

  // Add label nodes and update variable nodes with correct placement info.
  // A step update may have added some of these labels already.
  if (labelNodes.length > 0 || variableNodeUpdates.length > 0) {
    setNodes((currentNodes) => {
      const updatedNodes = updateLabelPlacement(
        currentNodes,
        variableNodeUpdates
      );
      const existingIds = new Set(currentNodes.map((node) => node.id));
      return [
        ...updatedNodes,
        ...labelNodes.filter((node) => !existingIds.has(node.id)),
      ];
    });
  }
};

// Helper interface for label info during positioning
interface LabelInfo {
  nodeId: string;
  idealX: number; // Ideal centered X position (centered on variable)
  variableCenterX: number; // Center X of the corresponding variable node (for ordering)
  y: number;
  width: number;
  height: number;
  formulaHeight: number;
  placement: PlacementDirection;
  isExpressionLabel: boolean;
  lockPlacement: boolean;
  parentId: string;
  originX: number;
  finalX?: number; // Final X position after collision resolution
}

// Default dimension values for nodes
const DEFAULT_DIMENSIONS = {
  labelWidth: 40,
  labelHeight: 24,
  formulaWidth: 400,
  formulaHeight: 200,
} as const;

/**
 * Get node dimensions with fallbacks to measured, explicit, or default values
 */
const getNodeDimensions = (
  node: Node,
  defaults: { width: number; height: number }
): { width: number; height: number } => ({
  width: node.measured?.width || node.width || defaults.width,
  height: node.measured?.height || node.height || defaults.height,
});

/**
 * Sort labels by their variable's center X position
 * This maintains correct left-to-right ordering to prevent edge crossings
 */
const sortLabelsByVariablePosition = (labels: LabelInfo[]): LabelInfo[] => {
  return [...labels].sort((a, b) => a.variableCenterX - b.variableCenterX);
};

const NEAR_STRAIGHT_PAIR_MIN_OFFSET = 0.5;
const NEAR_STRAIGHT_PAIR_MAX_OFFSET = 14;

/**
 * For near-collision pairs, prefer one perfectly straight edge over two slight bends.
 * This intentionally "un-optimizes" balanced centering when both labels are only a
 * little off-center, which improves readability in simple two-label cases.
 */
const maybeStraightenNearPair = (
  sorted: LabelInfo[],
  spacing: number
): void => {
  if (sorted.length !== 2) return;
  const [left, right] = sorted;
  if (left.isExpressionLabel || right.isExpressionLabel) return;

  const leftOffset = (left.finalX ?? left.idealX) - left.idealX;
  const rightOffset = (right.finalX ?? right.idealX) - right.idealX;
  const leftAbs = Math.abs(leftOffset);
  const rightAbs = Math.abs(rightOffset);

  // Only apply when both labels are slightly offset in opposite directions.
  if (leftAbs < NEAR_STRAIGHT_PAIR_MIN_OFFSET) return;
  if (rightAbs < NEAR_STRAIGHT_PAIR_MIN_OFFSET) return;
  if (leftAbs > NEAR_STRAIGHT_PAIR_MAX_OFFSET) return;
  if (rightAbs > NEAR_STRAIGHT_PAIR_MAX_OFFSET) return;
  if (Math.sign(leftOffset) === Math.sign(rightOffset)) return;

  // Option A: keep left label perfectly centered, move right label if needed.
  const leftAnchoredLeftX = left.idealX;
  const leftAnchoredRightX = Math.max(
    right.idealX,
    leftAnchoredLeftX + left.width + spacing
  );
  const leftAnchoredMove = Math.abs(leftAnchoredRightX - right.idealX);

  // Option B: keep right label perfectly centered, move left label if needed.
  const rightAnchoredRightX = right.idealX;
  const rightAnchoredLeftX = Math.min(
    left.idealX,
    rightAnchoredRightX - left.width - spacing
  );
  const rightAnchoredMove = Math.abs(rightAnchoredLeftX - left.idealX);

  // Pick the anchor that causes the smaller movement on the other label.
  if (leftAnchoredMove <= rightAnchoredMove) {
    left.finalX = leftAnchoredLeftX;
    right.finalX = leftAnchoredRightX;
  } else {
    left.finalX = rightAnchoredLeftX;
    right.finalX = rightAnchoredRightX;
  }
};

/**
 * Position all labels to avoid collisions while keeping them centered
 * First resolves collisions by pushing right, then calculates the offset
 * needed to center the result and shifts all labels left accordingly
 */
const resolveAllCollisions = (labels: LabelInfo[], spacing: number): void => {
  if (labels.length === 0) return;
  if (labels.length === 1) {
    labels[0].finalX = labels[0].idealX;
    return;
  }

  const sorted = sortLabelsByVariablePosition(labels);

  // First pass: resolve collisions by pushing right
  sorted[0].finalX = sorted[0].idealX;
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = sorted[i - 1];
    const previousRight = previous.finalX! + previous.width;
    const minX = previousRight + spacing;
    current.finalX = Math.max(current.idealX, minX);
  }

  // Calculate how much the labels shifted right overall
  // Compare the center of the final layout to the center of ideal positions
  const idealLeft = Math.min(...sorted.map((l) => l.idealX));
  const idealRight = Math.max(...sorted.map((l) => l.idealX + l.width));
  const idealCenter = (idealLeft + idealRight) / 2;
  const finalLeft = sorted[0].finalX!;
  const finalRight =
    sorted[sorted.length - 1].finalX! + sorted[sorted.length - 1].width;
  const finalCenter = (finalLeft + finalRight) / 2;

  // Shift all labels left to re-center
  const shift = finalCenter - idealCenter;
  for (const label of sorted) {
    label.finalX = label.finalX! - shift;
  }

  maybeStraightenNearPair(sorted, spacing);
};

interface LabelSpacing {
  vertical: number;
  horizontal: number;
}

const DEFAULT_LABEL_SPACING: LabelSpacing = { vertical: 10, horizontal: 12 };
const MAX_PLACEMENT_OPTIMIZATION_LABELS = 10;
const PLACEMENT_SWITCH_PENALTY = 0.01;

/**
 * Calculate the center X position of a variable node
 */
const getVariableCenterX = (variableNode: Node): number => {
  if (variableNode.measured?.width) {
    return variableNode.position.x + variableNode.measured.width / 2;
  }
  const width = (variableNode.data.width as number) || 0;
  return variableNode.position.x + width / 2;
};

/**
 * Calculate the Y position for a label based on placement
 */
const calculateLabelY = (
  placement: "above" | "below",
  labelHeight: number,
  formulaHeight: number,
  verticalSpacing: number
): number => {
  if (placement === "above") {
    return -labelHeight - verticalSpacing;
  }
  return formulaHeight + verticalSpacing;
};

/**
 * Extract label info from a label node for positioning calculations
 */
const extractLabelInfo = (
  node: Node,
  variableNodes: Node[],
  currentNodes: Node[],
  spacing: LabelSpacing
): LabelInfo | null => {
  const formulaId =
    typeof node.data.formulaId === "string" ? node.data.formulaId : undefined;
  const formulaNode = formulaId
    ? findFormulaNodeById(currentNodes, formulaId)
    : currentNodes.find(
        (candidate) =>
          candidate.type === NODE_TYPES.FORMULA &&
          candidate.id === node.parentId
      );
  if (!formulaNode) return null;

  const labelDimensions = getNodeDimensions(node, {
    width: DEFAULT_DIMENSIONS.labelWidth,
    height: DEFAULT_DIMENSIONS.labelHeight,
  });
  const placement =
    (node.data.placement as PlacementDirection | undefined) ??
    (node.position.y < 0 ? "above" : "below");
  const originX = Array.isArray(node.origin) ? (node.origin[0] as number) : 0;
  const currentLeftX = node.position.x - labelDimensions.width * originX;
  const expressionLabel = isExpressionLabelNode(node);
  const lockPlacement =
    (node.data as { lockPlacement?: boolean } | undefined)?.lockPlacement ===
    true;

  let variableCenterX: number;
  let idealX: number;

  if (expressionLabel) {
    variableCenterX = currentLeftX + labelDimensions.width / 2;
    idealX = currentLeftX;
  } else {
    const cssId = node.data.varId;
    if (!cssId || typeof cssId !== "string") return null;
    const variableNode = findVariableNodesForFormulaNode(
      variableNodes,
      formulaNode.id,
      cssId
    )[0];
    if (!variableNode || !variableNode.measured) return null;
    variableCenterX = getVariableCenterX(variableNode);
    idealX = variableCenterX - labelDimensions.width / 2;
  }

  const formulaNodeHeight =
    formulaNode.measured?.height ||
    formulaNode.height ||
    DEFAULT_DIMENSIONS.formulaHeight;
  const adjustedY = expressionLabel
    ? node.position.y
    : calculateLabelY(
        placement,
        labelDimensions.height,
        formulaNodeHeight,
        spacing.vertical
      );
  return {
    nodeId: node.id,
    idealX,
    variableCenterX,
    y: adjustedY,
    width: labelDimensions.width,
    height: labelDimensions.height,
    formulaHeight: formulaNodeHeight,
    placement,
    isExpressionLabel: expressionLabel,
    lockPlacement,
    parentId: formulaNode.id,
    originX,
  };
};

/**
 * Collect label info for all measured label nodes
 */
const collectLabelInfo = (
  currentNodes: Node[],
  spacing: LabelSpacing
): Map<string, LabelInfo> => {
  const labelInfoMap = new Map<string, LabelInfo>();
  const variableNodes = getVariableNodes(currentNodes);
  for (const node of currentNodes) {
    if (node.type !== NODE_TYPES.LABEL || !node.measured) continue;
    const labelInfo = extractLabelInfo(
      node,
      variableNodes,
      currentNodes,
      spacing
    );
    if (labelInfo) {
      labelInfoMap.set(node.id, labelInfo);
    }
  }
  return labelInfoMap;
};

const groupLabelsByFormula = (
  labelInfoMap: Map<string, LabelInfo>
): Map<string, LabelInfo[]> => {
  const groupedLabels = new Map<string, LabelInfo[]>();
  for (const labelInfo of labelInfoMap.values()) {
    if (!groupedLabels.has(labelInfo.parentId)) {
      groupedLabels.set(labelInfo.parentId, []);
    }
    groupedLabels.get(labelInfo.parentId)!.push(labelInfo);
  }
  return groupedLabels;
};

const resolveByPlacementForFormula = (
  labels: LabelInfo[],
  spacing: LabelSpacing
): void => {
  const aboveLabels = labels.filter((label) => label.placement === "above");
  const belowLabels = labels.filter((label) => label.placement === "below");

  resolveAllCollisions(aboveLabels, spacing.horizontal);
  resolveAllCollisions(belowLabels, spacing.horizontal);
};

const applyPlacement = (
  label: LabelInfo,
  placement: PlacementDirection,
  spacing: LabelSpacing
): void => {
  label.placement = placement;
  label.y = calculateLabelY(
    placement,
    label.height,
    label.formulaHeight,
    spacing.vertical
  );
  label.finalX = undefined;
};

const horizontalDisplacement = (label: LabelInfo): number =>
  Math.abs((label.finalX ?? label.idealX) - label.idealX);

const getMovableLabels = (labels: LabelInfo[]): LabelInfo[] => {
  return labels.filter(
    (label) => !label.isExpressionLabel && !label.lockPlacement
  );
};

const shouldOptimizePlacements = (
  movableLabelCount: number,
  allowPlacementSwitching: boolean
): boolean => {
  if (!allowPlacementSwitching) return false;
  return (
    movableLabelCount >= 2 &&
    movableLabelCount <= MAX_PLACEMENT_OPTIMIZATION_LABELS
  );
};

const mapOriginalPlacements = (
  movableLabels: LabelInfo[]
): Map<string, PlacementDirection> => {
  const originalPlacements = new Map<string, PlacementDirection>();
  for (const label of movableLabels) {
    originalPlacements.set(label.nodeId, label.placement);
  }
  return originalPlacements;
};

const createPlacementCandidate = (
  labels: LabelInfo[]
): { labels: LabelInfo[]; byId: Map<string, LabelInfo> } => {
  const candidateLabels = labels.map((label) => ({ ...label }));
  const candidateById = new Map(
    candidateLabels.map((label) => [label.nodeId, label])
  );
  return { labels: candidateLabels, byId: candidateById };
};

const applyPlacementMask = (
  candidateById: Map<string, LabelInfo>,
  movableLabels: LabelInfo[],
  mask: number,
  spacing: LabelSpacing
): void => {
  for (let index = 0; index < movableLabels.length; index++) {
    const source = movableLabels[index];
    const target = candidateById.get(source.nodeId);
    if (!target) continue;
    const placement: PlacementDirection =
      (mask & (1 << index)) === 0 ? "below" : "above";
    applyPlacement(target, placement, spacing);
  }
};

const scorePlacementCandidate = (
  candidateById: Map<string, LabelInfo>,
  movableLabels: LabelInfo[],
  originalPlacements: Map<string, PlacementDirection>
): number => {
  let displacementCost = 0;
  let switchCost = 0;
  for (const label of movableLabels) {
    const resolved = candidateById.get(label.nodeId);
    if (!resolved) continue;
    displacementCost += horizontalDisplacement(resolved);
    if (resolved.placement !== originalPlacements.get(label.nodeId)) {
      switchCost += PLACEMENT_SWITCH_PENALTY;
    }
  }
  return displacementCost + switchCost;
};

const applyPlacementSolution = (
  labels: LabelInfo[],
  solution: LabelInfo[]
): void => {
  const solvedById = new Map(solution.map((label) => [label.nodeId, label]));
  for (const label of labels) {
    const resolved = solvedById.get(label.nodeId);
    if (!resolved) continue;
    label.placement = resolved.placement;
    label.y = resolved.y;
    label.finalX = resolved.finalX;
  }
};

const optimizePlacementsForFormula = (
  labels: LabelInfo[],
  spacing: LabelSpacing,
  allowPlacementSwitching: boolean
): void => {
  const movableLabels = getMovableLabels(labels);
  if (
    !shouldOptimizePlacements(movableLabels.length, allowPlacementSwitching)
  ) {
    resolveByPlacementForFormula(labels, spacing);
    return;
  }

  const originalPlacements = mapOriginalPlacements(movableLabels);
  const combinations = 1 << movableLabels.length;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestSolution: LabelInfo[] | null = null;

  for (let mask = 0; mask < combinations; mask++) {
    const candidate = createPlacementCandidate(labels);
    applyPlacementMask(candidate.byId, movableLabels, mask, spacing);
    resolveByPlacementForFormula(candidate.labels, spacing);

    const totalCost = scorePlacementCandidate(
      candidate.byId,
      movableLabels,
      originalPlacements
    );
    if (totalCost < bestCost) {
      bestCost = totalCost;
      bestSolution = candidate.labels;
    }
  }

  if (!bestSolution) {
    resolveByPlacementForFormula(labels, spacing);
    return;
  }

  applyPlacementSolution(labels, bestSolution);
};

const resolveCollisions = (
  labelsByFormula: Map<string, LabelInfo[]>,
  spacing: LabelSpacing,
  allowPlacementSwitching: boolean
): void => {
  for (const labels of labelsByFormula.values()) {
    optimizePlacementsForFormula(labels, spacing, allowPlacementSwitching);
  }
};

/**
 * Apply calculated positions to a label node
 */
const applyLabelPosition = (node: Node, labelInfo: LabelInfo): Node => {
  const finalX = labelInfo.finalX ?? labelInfo.idealX;
  return {
    ...node,
    data: {
      ...node.data,
      placement: labelInfo.placement,
    },
    position: {
      x: finalX + labelInfo.width * labelInfo.originX,
      y: labelInfo.y,
    },
    style: {
      ...node.style,
      opacity: 1,
      pointerEvents: "auto" as const,
    },
  };
};

/**
 * Check if any label positions have changed
 */
const hasLabelPositionChanges = (
  currentNodes: Node[],
  updatedNodes: Node[]
): boolean => {
  return updatedNodes.some((node, index) => {
    const original = currentNodes[index];
    const opacityChanged =
      original.style?.opacity !== node.style?.opacity &&
      original.style?.opacity === 0;
    return (
      original.position.x !== node.position.x ||
      original.position.y !== node.position.y ||
      opacityChanged
    );
  });
};

/**
 * Adjust label positions after they're rendered and measured
 * Uses center-of-mass approach to keep labels balanced around their variables
 */
export const adjustLabelPositions = ({
  getNodes,
  setNodes,
  lockCurrentPlacements = false,
}: AdjustLabelPositionsParams): void => {
  const currentNodes = getNodes();
  // Collect and process label information
  const labelInfoMap = collectLabelInfo(currentNodes, DEFAULT_LABEL_SPACING);
  const groupedLabels = groupLabelsByFormula(labelInfoMap);
  // Resolve collisions within each group
  resolveCollisions(
    groupedLabels,
    DEFAULT_LABEL_SPACING,
    !lockCurrentPlacements
  );
  // Apply calculated positions to nodes
  const updatedNodes = currentNodes.map((node) => {
    if (node.type !== NODE_TYPES.LABEL || !node.measured) return node;
    const labelInfo = labelInfoMap.get(node.id);
    if (!labelInfo) return node;
    return applyLabelPosition(node, labelInfo);
  });
  if (hasLabelPositionChanges(currentNodes, updatedNodes)) {
    setNodes(updatedNodes);
  }
};
