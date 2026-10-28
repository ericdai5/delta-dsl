import { Node } from "@xyflow/react";

//--------------------------------------------------
// Node Types
//--------------------------------------------------

/**
 * Node type constants for type-safe node filtering
 */
export const NODE_TYPES = {
  FORMULA: "formula",
  VARIABLE: "variable",
  LABEL: "label",
  STEP: "step",
  EXPRESSION: "expression",
} as const;

const DEFAULT_STEP_NODE_HEIGHT = 32;

//--------------------------------------------------
// Node Finders
//--------------------------------------------------

/**
 * Iterate through all measured formula nodes with their DOM elements
 * @param nodes - Array of all React Flow nodes
 * @param callback - Function to call for each valid formula node
 */
export function forEachFormulaNode(
  nodes: Node[],
  callback: (formulaNode: Node, formulaElement: Element, id: string) => void
): void {
  const formulaNodes = nodes.filter((n) => n.type === NODE_TYPES.FORMULA);
  formulaNodes.forEach((formulaNode) => {
    if (!formulaNode.measured) return;
    const id = formulaNode.data.id;
    if (!id || typeof id !== "string") return;
    const formulaElement = getFormulaElement(formulaNode);
    if (!formulaElement) return;
    callback(formulaNode, formulaElement, id);
  });
}

/**
 * Find a formula node by its id
 * @param nodes - Array of all React Flow nodes
 * @param id - The id to search for
 * @returns The formula node or undefined if not found
 */
export function findFormulaNodeById(
  nodes: Node[],
  id: string
): Node | undefined {
  return nodes.find(
    (node) => node.type === NODE_TYPES.FORMULA && node.data.id === id
  );
}

/**
 * Find all label nodes for a specific formula
 * @param nodes - Array of all React Flow nodes
 * @param id - The id to filter by
 * @returns Array of label nodes for this formula
 */
export function findLabelNodesById(nodes: Node[], id: string): Node[] {
  return nodes.filter(
    (node) => node.type === NODE_TYPES.LABEL && node.data.formulaId === id
  );
}

/**
 * Find variable nodes within a React Flow formula node, ordered by their
 * authored LaTeX occurrence.
 *
 * @param nodes - Array of variable or canvas nodes
 * @param formulaNodeId - Internal React Flow ID of the parent formula node
 * @param varId - Variable identifier (cssId)
 * @returns Matching variable nodes in occurrence order
 */
export function findVariableNodesForFormulaNode(
  nodes: Node[],
  formulaNodeId: string,
  varId: string
): Node[] {
  return nodes
    .filter(
      (node) =>
        node.type === NODE_TYPES.VARIABLE &&
        node.parentId === formulaNodeId &&
        node.data.varId === varId
    )
    .sort((left, right) => {
      const leftInstance =
        typeof left.data.instance === "number"
          ? left.data.instance
          : Number.POSITIVE_INFINITY;
      const rightInstance =
        typeof right.data.instance === "number"
          ? right.data.instance
          : Number.POSITIVE_INFINITY;
      return leftInstance - rightInstance || left.id.localeCompare(right.id);
    });
}

/**
 * Find variable nodes by varId (CSS identifier) within a specific formula
 * @param nodes - Array of all React Flow nodes
 * @param id - The id to filter by
 * @param varId - The variable identifier (cssId)
 * @returns Array of matching variable nodes
 */
export function findVariableNodesByVarId(
  nodes: Node[],
  id: string,
  varId: string
): Node[] {
  const formulaNode = findFormulaNodeById(nodes, id);
  if (!formulaNode) return [];
  return findVariableNodesForFormulaNode(nodes, formulaNode.id, varId);
}

//--------------------------------------------------
// DOM Helpers
//--------------------------------------------------

/**
 * Get the DOM element for a formula node by its React Flow node ID
 * @param formulaNode - The React Flow formula node
 * @returns The formula DOM element or null if not found
 */
export function getFormulaElement(formulaNode: Node): Element | null {
  return document.querySelector(`[data-id="${formulaNode.id}"] .formula-node`);
}

/**
 * Get the formula DOM element from a container or fallback to document query
 * @param containerElement - Optional container element to search within
 * @param nodes - Array of all React Flow nodes (needed for fallback)
 * @param formulaId - The formula ID to find
 * @returns The formula DOM element or null if not found
 */
export function getFormulaElementFromContainer(
  containerElement: Element | null | undefined,
  nodes: Node[],
  formulaId: string
): Element | null {
  if (containerElement) {
    return containerElement.querySelector(".formula-node");
  }
  // Fall back to document query
  const formulaNode = findFormulaNodeById(nodes, formulaId);
  if (formulaNode) {
    return getFormulaElement(formulaNode);
  }
  return null;
}

/**
 * Calculate position and dimensions of an element relative to a formula element
 * @param elementRect - DOMRect of the element
 * @param formulaRect - DOMRect of the formula element
 * @param viewport - The React Flow viewport (for zoom adjustment)
 * @returns Position and dimensions adjusted for zoom
 */
export function getRelativePositionAndDimensions(
  elementRect: DOMRect,
  formulaRect: DOMRect,
  viewport: { zoom: number }
): {
  position: { x: number; y: number };
  dimensions: { width: number; height: number };
} {
  return {
    position: {
      x: (elementRect.left - formulaRect.left) / viewport.zoom,
      y: (elementRect.top - formulaRect.top) / viewport.zoom,
    },
    dimensions: {
      width: elementRect.width / viewport.zoom,
      height: elementRect.height / viewport.zoom,
    },
  };
}

//--------------------------------------------------
// Node Getters
//--------------------------------------------------

/**
 * Get all nodes of a specific type from the node array
 * @param nodes - Array of all React Flow nodes
 * @param type - The node type to filter by (from NODE_TYPES)
 * @returns Array of nodes matching the specified type
 */
export function getNodesByType(nodes: Node[], type: string): Node[] {
  return nodes.filter((node) => node.type === type);
}

// Convenience functions for common node types
export const getFormulaNodes = (nodes: Node[]) =>
  getNodesByType(nodes, NODE_TYPES.FORMULA);
export const getLabelNodes = (nodes: Node[]) =>
  getNodesByType(nodes, NODE_TYPES.LABEL);
export const getVariableNodes = (nodes: Node[]) =>
  getNodesByType(nodes, NODE_TYPES.VARIABLE);
export const getExpressionNodes = (nodes: Node[]) =>
  getNodesByType(nodes, NODE_TYPES.EXPRESSION);
export const getStepNodes = (nodes: Node[]) =>
  getNodesByType(nodes, NODE_TYPES.STEP);

/**
 * Extract unique formula IDs from an array of nodes
 * @param nodes - Array of React Flow nodes (typically label or variable nodes)
 * @returns Set of unique ids
 */
export function extractIds(nodes: Node[]): Set<string> {
  const ids = new Set<string>();
  nodes.forEach((node) => {
    const formulaId = node.data.formulaId;
    if (formulaId && typeof formulaId === "string") {
      ids.add(formulaId);
    }
  });
  return ids;
}

//--------------------------------------------------
// Node Measurement Checkers
//--------------------------------------------------

/**
 * Check if all nodes in the given array are measured
 * @param nodes - Array of nodes to check
 * @returns Whether all nodes are measured (or true if array is empty)
 */
export function checkNodesMeasured(nodes: Node[]): boolean {
  if (nodes.length === 0) return true;
  return nodes.every((node) => node.measured);
}

/**
 * Check if all nodes (labels, views, and their corresponding variables) are ready for positioning
 * @param nodes - Array of all React Flow nodes
 * @returns Object containing node arrays and overall readiness status
 */
export function checkAllNodesMeasured(nodes: Node[]): {
  labelNodes: Node[];
  stepNodes: Node[];
  allReady: boolean;
} {
  const labelNodes = getLabelNodes(nodes);
  const stepNodes = getStepNodes(nodes);
  const variableNodes = getVariableNodes(nodes);
  const labelNodesMeasured = checkNodesMeasured(labelNodes);
  const stepNodesMeasured = checkNodesMeasured(stepNodes);
  const variableNodesMeasured = checkNodesMeasured(variableNodes);
  return {
    labelNodes,
    stepNodes,
    allReady: labelNodesMeasured && stepNodesMeasured && variableNodesMeasured,
  };
}

/**
 * Position step nodes to avoid label collisions and make them visible
 * @param currentNodes - Current array of nodes
 * @param formulaNode - The parent formula node
 * @param getLaneTop - Optional top of the space reserved above a formula,
 *   keyed by its node ID. Step nodes go no lower than this, so descriptions
 *   stay on one row from step to step.
 * @returns Updated array of nodes with positioned and visible step nodes
 */
export function positionAndShowstepNodes(
  currentNodes: Node[],
  formulaNode: Node,
  getLaneTop?: (formulaNodeId: string) => number | undefined
): Node[] {
  return currentNodes.map((node) => {
    if (node.type === NODE_TYPES.STEP) {
      // Calculate the step node X center position
      const viewCenterX = node.position.x;
      const stepNodeHeight =
        node.measured?.height || node.height || DEFAULT_STEP_NODE_HEIGHT;

      // Calculate Y position that avoids label collisions. Placing it
      // higher, at the reserved lane, only adds space below it.
      const laneTop = node.parentId ? getLaneTop?.(node.parentId) : undefined;
      const newY = Math.min(
        getStepNodeYPositionAvoidingLabels(
          currentNodes,
          formulaNode,
          viewCenterX,
          25,
          stepNodeHeight
        ),
        laneTop ?? Infinity
      );

      return {
        ...node,
        position: { x: node.position.x, y: newY },
        style: {
          ...node.style,
          opacity: 1, // Make visible
          pointerEvents: "auto" as const, // Enable interactions
        },
      };
    }
    return node;
  });
}

/**
 * Calculate the optimal Y position for a step node that avoids collisions with label nodes.
 * Step nodes are positioned above the formula. If there are any labels above the formula,
 * position the step node above all of them.
 *
 * @param nodes - Array of all React Flow nodes
 * @param formulaNode - The parent formula node
 * @param _stepNodeX - The X position (unused, kept for API compatibility)
 * @param baseOffset - Base offset above the formula (default 25)
 * @returns The optimal Y position for the step node (negative value, above formula)
 */
export function getStepNodeYPositionAvoidingLabels(
  nodes: Node[],
  formulaNode: Node,
  _stepNodeX: number,
  baseOffset: number = 25,
  stepNodeHeight: number = DEFAULT_STEP_NODE_HEIGHT
): number {
  const spacingBetweenStepAndLabels = 14;

  // Find all label nodes that belong to this formula
  const labelNodes = nodes.filter(
    (node) => node.type === NODE_TYPES.LABEL && node.parentId === formulaNode.id
  );

  // If there are no labels, keep the step above the formula with a fixed gap.
  if (labelNodes.length === 0) {
    return -baseOffset - stepNodeHeight;
  }

  // Find the highest top edge among labels that are above the formula.
  let minTopLabelY = Infinity;

  for (const labelNode of labelNodes) {
    const labelTopY = labelNode.position.y;

    // Only consider labels above the formula.
    if (labelTopY < 0) {
      minTopLabelY = Math.min(minTopLabelY, labelTopY);
    }
  }

  // If we have labels above, place step above those labels with explicit gap:
  // [step description] ...gap... [top labels] ...gap... [formula]
  if (minTopLabelY !== Infinity) {
    return minTopLabelY - spacingBetweenStepAndLabels - stepNodeHeight;
  }

  // Otherwise keep step above formula with fixed gap.
  return -baseOffset - stepNodeHeight;
}
