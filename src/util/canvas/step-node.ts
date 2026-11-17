import { Edge, Node } from "@xyflow/react";

import { unescapeLatex } from "../../engine/controller";
import { ComputationStore } from "../../store/computation";
import { IStepLabelValue, IView } from "../../types/step";
import { INPUT_VARIABLE_DEFAULT } from "../../types/variable";
import { formatNumberForDisplay } from "../format-number";
import { findExpression } from "../parse/formula-tree";
import { decodeVariableOccurrenceCssRef } from "../parse/variable";
import {
  getVariableDimensionKey,
  getVariableOccurrenceElement,
} from "../variable-occurrence";
import {
  NODE_TYPES,
  getFormulaElement,
  getFormulaNodes,
  getStepNodeYPositionAvoidingLabels,
} from "./node-helpers";

/**
 * Bounding box for expression highlighting
 */
export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Result of creating step and expression nodes
 */
export interface StepNodesResult {
  stepNodes: Node[];
  expressionNodes: Node[];
  expressionLabelNodes: Node[];
  stepEdges: Edge[];
}

interface ExpressionScopeEntry {
  expression: string;
  labelValue?: IStepLabelValue;
}

type LabelHandleId = "label-handle-above" | "label-handle-below";
type ExpressionHandleId =
  | "expression-handle-top"
  | "expression-handle-bottom"
  | "expression-handle-left"
  | "expression-handle-right";

function isExpressionLabelNode(node: Node): boolean {
  return (
    node.type === NODE_TYPES.LABEL &&
    (node.data as { labelKind?: string } | undefined)?.labelKind ===
      "expression"
  );
}

function compareNodeIdSets(existingNodes: Node[], nextNodes: Node[]): boolean {
  if (existingNodes.length !== nextNodes.length) {
    return false;
  }

  const existingIds = new Set(existingNodes.map((node) => node.id));
  if (existingIds.size !== existingNodes.length) {
    return false;
  }

  const nextIds = new Set(nextNodes.map((node) => node.id));
  if (nextIds.size !== nextNodes.length) {
    return false;
  }

  return existingNodes.every((node) => nextIds.has(node.id));
}

/**
 * Calculate bounding box from active variable nodes
 * @param nodes - Array of all React Flow nodes
 * @param activeVarIds - Array of active variable IDs
 * @param computationStore - Optional computation store for fresh dimensions
 * @param formulaId - Optional formula ID for formula-specific dimension lookup
 * @returns Bounding box or null if no valid bounding box found
 */
export function calculateBoundingBoxFromVariableNodes(
  nodes: Node[],
  activeVarIds: string[],
  computationStore?: ComputationStore,
  formulaId?: string
): BoundingBox | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const formulaNodeId = formulaId
    ? nodes.find(
        (node) => node.type === NODE_TYPES.FORMULA && node.data.id === formulaId
      )?.id
    : undefined;

  // Include every selected occurrence of each active variable, but never mix
  // occurrences from another formula.
  const activeVariableNodes = nodes.filter((node) => {
    if (node.type !== NODE_TYPES.VARIABLE) return false;
    const data = node.data as {
      varId?: string;
      formulaId?: string;
    };
    if (!activeVarIds.includes(data.varId || "")) return false;
    if (!formulaId) return true;
    return formulaNodeId
      ? node.parentId === formulaNodeId
      : data.formulaId === formulaId;
  });
  if (activeVariableNodes.length === 0) {
    return null;
  }
  activeVariableNodes.forEach((node) => {
    const data = node.data as {
      varId?: string;
      instance?: number;
      width?: number;
      height?: number;
    };
    const instance =
      typeof data.instance === "number" &&
      Number.isSafeInteger(data.instance) &&
      data.instance > 0
        ? data.instance
        : null;
    const freshDimensions =
      computationStore && formulaId && data.varId && instance !== null
        ? computationStore.getVariableDimensions(
            getVariableDimensionKey(formulaId, data.varId, instance)
          )
        : undefined;
    const width =
      freshDimensions?.width || node.measured?.width || data.width || 20;
    const height =
      freshDimensions?.height || node.measured?.height || data.height || 20;
    const x = freshDimensions?.x ?? node.position.x;
    const y = freshDimensions?.y ?? node.position.y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + width);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + height);
  });

  if (minX === Infinity || maxX === -Infinity) {
    return null;
  }

  return { minX, maxX, minY, maxY };
}

/**
 * Calculate bounding box from expression scope (DOM-based)
 * Uses the stored formula tree with cssId values to find DOM elements.
 * This approach correctly handles edge cases like `=` inside subscripts.
 * @param expression - LaTeX expression string
 * @param formulaNode - The formula node
 * @param viewport - The React Flow viewport
 * @param computationStore - The computation store containing the formula tree
 * @param formulaId - The formula ID for tree lookup
 * @returns Bounding box or null if not found
 */
export function calculateBoundingBoxFromExpression(
  expression: string,
  formulaNode: Node,
  viewport: { zoom: number },
  computationStore: ComputationStore,
  formulaId?: string
): BoundingBox | null {
  if (!formulaId) {
    return null;
  }
  // Get the stored formula tree with cssId values
  const formulaTree = computationStore.getFormulaTree(formulaId);
  if (!formulaTree) {
    return null;
  }
  // Use AST-based subtree matching with the stored tree
  const unescapedExpression = unescapeLatex(expression);
  // Get variable symbols from computation store to parse expression with same grouping
  const variableSymbols = Array.from(computationStore.variables.keys());
  const expressionMatch = findExpression(
    formulaTree,
    unescapedExpression,
    variableSymbols
  );
  if (!expressionMatch || expressionMatch.elementIds.length === 0) {
    return null;
  }
  // Get DOM elements using the cssIds from the formula tree
  const formulaElement = getFormulaElement(formulaNode);
  if (!formulaElement) {
    return null;
  }
  const formulaRect = formulaElement.getBoundingClientRect();
  const expressionElements: Element[] = [];
  // Query DOM elements by their cssIds (from \cssId{} wrappers)
  for (const cssRef of expressionMatch.elementIds) {
    const { variableId, occurrenceIndex } =
      decodeVariableOccurrenceCssRef(cssRef);
    let element: Element | null = null;
    if (occurrenceIndex !== null) {
      element = getVariableOccurrenceElement(
        formulaElement,
        variableId,
        occurrenceIndex + 1
      );
    } else {
      element = formulaElement.querySelector(
        `[id="${CSS.escape(variableId)}"]`
      );
    }
    if (element) {
      expressionElements.push(element);
    }
  }
  if (expressionElements.length === 0) {
    return null;
  }
  // Calculate bounding box from all expression elements
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const element of expressionElements) {
    const rect = element.getBoundingClientRect();
    const elemMinX = (rect.left - formulaRect.left) / viewport.zoom;
    const elemMaxX = (rect.right - formulaRect.left) / viewport.zoom;
    const elemMinY = (rect.top - formulaRect.top) / viewport.zoom;
    const elemMaxY = (rect.bottom - formulaRect.top) / viewport.zoom;
    minX = Math.min(minX, elemMinX);
    maxX = Math.max(maxX, elemMaxX);
    minY = Math.min(minY, elemMinY);
    maxY = Math.max(maxY, elemMaxY);
  }
  if (minX === Infinity || maxX === -Infinity) {
    return null;
  }
  const boundingBox = { minX, maxX, minY, maxY };
  return boundingBox;
}

/**
 * Create a step node
 * @param stepNodeId - The ID for the step node
 * @param formulaNode - The parent formula node
 * @param view - The formula-specific step data (description and label entries)
 * @param position - Position for the step node
 * @returns The step node
 */
export function createstepNode(
  stepNodeId: string,
  formulaNode: Node,
  view: IView,
  position: { x: number; y: number }
): Node {
  return {
    id: stepNodeId,
    type: NODE_TYPES.STEP,
    position,
    parentId: formulaNode.id,
    origin: [0.5, 0] as [number, number],
    data: {
      description: view.description ?? "",
    },
    // No draggable flag, so the canvas's nodesDraggable decides
    selectable: true,
    style: {
      opacity: 0, // Hidden until positioned
      pointerEvents: "none" as const,
    },
  };
}

/**
 * Create an expression node
 * @param expressionNodeId - The ID for the expression node
 * @param formulaNode - The parent formula node
 * @param boundingBox - The bounding box for the expression
 * @param activeVarIds - Array of active variable IDs
 * @param padding - Padding around the bounding box
 * @returns The expression node
 */
export function createExpressionNode(
  expressionNodeId: string,
  formulaNode: Node,
  boundingBox: BoundingBox,
  activeVarIds: string[],
  padding: number = 4
): Node {
  const { minX, maxX, minY, maxY } = boundingBox;
  const expressionWidth = maxX - minX + padding * 2;
  const expressionHeight = maxY - minY + padding * 2;

  return {
    id: expressionNodeId,
    type: NODE_TYPES.EXPRESSION,
    position: {
      x: minX - padding,
      y: minY - padding,
    },
    parentId: formulaNode.id,
    extent: "parent",
    data: {
      width: expressionWidth,
      height: expressionHeight,
      varIds: activeVarIds,
    },
    draggable: false,
    selectable: false,
  };
}

/**
 * Collect expression scopes from non-variable step label keys.
 */
function collectExpressionScopes(
  view: IView,
  variableIds: Set<string>
): ExpressionScopeEntry[] {
  const scopes: ExpressionScopeEntry[] = [];
  const seen = new Set<string>();

  if (!view.labels) {
    return scopes;
  }

  for (const [latex, labelValue] of Object.entries(view.labels)) {
    if (variableIds.has(latex)) {
      continue;
    }
    if (seen.has(latex)) {
      // Merge duplicate expression keys by preserving the first scope entry.
      const existing = scopes.find((scope) => scope.expression === latex);
      if (existing && existing.labelValue === undefined) {
        existing.labelValue = labelValue;
      }
      continue;
    }
    seen.add(latex);
    scopes.push({ expression: latex, labelValue });
  }

  return scopes;
}

function formatStepLabelValue(labelValue: IStepLabelValue): string {
  if (labelValue === undefined || labelValue === null) {
    return "";
  }
  if (typeof labelValue === "number") {
    const precision = Math.max(0, INPUT_VARIABLE_DEFAULT.PRECISION);
    return formatNumberForDisplay(labelValue, { precision });
  }
  if (Array.isArray(labelValue)) {
    if (labelValue.length === 0) {
      return "[]";
    }
    return `[${labelValue.map((value) => String(value)).join(", ")}]`;
  }
  return String(labelValue);
}

/**
 * Create a static label node for expression labels defined in step.labels.
 */
function createExpressionLabelNode(
  expressionLabelNodeId: string,
  formulaNode: Node,
  expression: string,
  labelValue: IStepLabelValue,
  expressionBoundingBox: BoundingBox,
  slotIndex: number,
  placeAboveFormula: boolean
): Node {
  const formulaId =
    typeof formulaNode.data?.id === "string"
      ? (formulaNode.data.id as string)
      : undefined;
  const formulaHeight =
    formulaNode.measured?.height ||
    formulaNode.height ||
    expressionBoundingBox.maxY;
  const expressionCenterX =
    (expressionBoundingBox.minX + expressionBoundingBox.maxX) / 2;
  const labelSlotSpacing = 30;
  const labelYOffsetFromFormula = 30;
  const baseY = placeAboveFormula
    ? -labelYOffsetFromFormula
    : formulaHeight + 12;
  const yPosition = placeAboveFormula
    ? baseY - slotIndex * labelSlotSpacing
    : baseY + slotIndex * labelSlotSpacing;

  return {
    id: expressionLabelNodeId,
    type: NODE_TYPES.LABEL,
    position: {
      x: expressionCenterX,
      y: yPosition,
    },
    origin: [0.5, 0] as [number, number],
    parentId: formulaNode.id,
    data: {
      labelKind: "expression",
      formulaId,
      expression,
      expressionLabel: formatStepLabelValue(labelValue),
      placement: placeAboveFormula ? "above" : "below",
    },
    draggable: false,
    selectable: false,
    style: {
      pointerEvents: "auto" as const,
    },
  };
}

/**
 * Resolve edge handle ids for label->expression edges based on relative geometry.
 */
function resolveExpressionEdgeHandles(
  expressionBoundingBox: BoundingBox,
  expressionLabelNode: Node
): { sourceHandle: LabelHandleId; targetHandle: ExpressionHandleId } {
  const expressionCenterX =
    (expressionBoundingBox.minX + expressionBoundingBox.maxX) / 2;
  const expressionCenterY =
    (expressionBoundingBox.minY + expressionBoundingBox.maxY) / 2;

  const labelX = expressionLabelNode.position.x;
  const labelHeight =
    expressionLabelNode.measured?.height || expressionLabelNode.height || 24;
  const labelCenterY = expressionLabelNode.position.y + labelHeight / 2;

  const dx = labelX - expressionCenterX;
  const dy = labelCenterY - expressionCenterY;

  const sourceHandle: LabelHandleId =
    dy >= 0 ? "label-handle-above" : "label-handle-below";

  let targetHandle: ExpressionHandleId;
  if (Math.abs(dx) > Math.abs(dy)) {
    targetHandle =
      dx >= 0 ? "expression-handle-right" : "expression-handle-left";
  } else {
    targetHandle =
      dy >= 0 ? "expression-handle-bottom" : "expression-handle-top";
  }

  return { sourceHandle, targetHandle };
}

/**
 * Create an edge connecting an expression label node to an expression node.
 */
export function createExpressionLabelEdge(
  expressionLabelNodeId: string,
  expressionNodeId: string,
  sourceHandle: LabelHandleId,
  targetHandle: ExpressionHandleId
): Edge {
  return {
    id: `edge-step-label-${expressionLabelNodeId}-${expressionNodeId}`,
    source: expressionLabelNodeId,
    target: expressionNodeId,
    sourceHandle,
    targetHandle,
    type: "default",
    style: {
      stroke: "#cbd5e1",
      strokeWidth: 1,
    },
    animated: false,
    selectable: false,
    deletable: false,
  };
}

/**
 * Parameters for creating step nodes for a single formula
 */
export interface CreatestepNodesParams {
  currentNodes: Node[];
  formulaNode: Node;
  view: IView;
  activeVarIds: string[];
  viewport?: { zoom: number };
  stepNodeIndex?: number;
  computationStore: ComputationStore;
}

/**
 * Create step and expression nodes from a formula step
 * @param params - Parameters for creating step nodes
 * @returns Object containing step nodes, expression nodes, and edges
 */
export function createStepAndExpressionNodes(
  params: CreatestepNodesParams
): StepNodesResult {
  const {
    currentNodes,
    formulaNode,
    view,
    activeVarIds,
    viewport = { zoom: 1 },
    stepNodeIndex = 0,
    computationStore,
  } = params;

  const stepNodes: Node[] = [];
  const expressionNodes: Node[] = [];
  const expressionLabelNodes: Node[] = [];
  const stepEdges: Edge[] = [];

  // Get formula ID for token lookup
  const formulaId = formulaNode.data?.id as string | undefined;
  const variableIds = new Set(Array.from(computationStore.variables.keys()));
  const expressionScopes = collectExpressionScopes(view, variableIds);

  const padding = 4;
  let expressionLabelSlotIndex = 0;
  const useStepLayoutPreference =
    computationStore.isStepMode() && !!computationStore.currentStep;

  expressionScopes.forEach((scope, expressionIndex) => {
    const expressionBoundingBox = calculateBoundingBoxFromExpression(
      scope.expression,
      formulaNode,
      viewport,
      computationStore,
      formulaId
    );
    if (!expressionBoundingBox) {
      console.warn("Skipping unmatched/malformed expression scope", {
        expression: scope.expression,
        expressionIndex,
        formulaId,
        scope,
      });
      return;
    }

    const expressionNodeId = `expression-${stepNodeIndex}-${expressionIndex}`;
    expressionNodes.push(
      createExpressionNode(
        expressionNodeId,
        formulaNode,
        expressionBoundingBox,
        activeVarIds,
        padding
      )
    );

    if (scope.labelValue !== undefined && scope.labelValue !== null) {
      const expressionLabelNodeId = `label-expression-${stepNodeIndex}-${expressionIndex}`;
      const expressionLabelNode = createExpressionLabelNode(
        expressionLabelNodeId,
        formulaNode,
        scope.expression,
        scope.labelValue,
        expressionBoundingBox,
        expressionLabelSlotIndex,
        useStepLayoutPreference
      );
      expressionLabelNodes.push(expressionLabelNode);

      const { sourceHandle, targetHandle } = resolveExpressionEdgeHandles(
        expressionBoundingBox,
        expressionLabelNode
      );
      stepEdges.push(
        createExpressionLabelEdge(
          expressionLabelNodeId,
          expressionNodeId,
          sourceHandle,
          targetHandle
        )
      );
      expressionLabelSlotIndex++;
    }
  });

  const formulaCenterX =
    (formulaNode.measured?.width || formulaNode.width || 200) / 2;
  const hasDescription =
    typeof view.description === "string" && view.description.trim().length > 0;
  if (hasDescription) {
    // Step nodes are centered on the formula and are independent from expression nodes.
    const stepNodeY = getStepNodeYPositionAvoidingLabels(
      currentNodes,
      formulaNode,
      formulaCenterX
    );
    const stepNodeId = `step-${stepNodeIndex}`;
    stepNodes.push(
      createstepNode(stepNodeId, formulaNode, view, {
        x: formulaCenterX,
        y: stepNodeY + stepNodeIndex * 60,
      })
    );
  }

  return { stepNodes, expressionNodes, expressionLabelNodes, stepEdges };
}

/**
 * Parameters for the addstepNodes utility function
 */
export interface AddstepNodesParams {
  getNodes: () => Node[];
  getViewport?: () => { zoom: number; x: number; y: number };
  setNodes: (nodes: Node[] | ((nodes: Node[]) => Node[])) => void;
  setEdges: (edges: Edge[] | ((edges: Edge[]) => Edge[])) => void;
  formulaId?: string; // Optional: specific formula ID (for FormulaComponent)
  computationStore: ComputationStore;
}

/**
 * Add step nodes to the canvas based on current execution state
 * This is the main utility function used by both canvas.tsx and FormulaComponent.tsx
 * Supports multi-formula steps where each formula can have its own step data.
 */
export function addstepNodes({
  getNodes,
  getViewport,
  setNodes,
  setEdges,
  formulaId,
  computationStore,
}: AddstepNodesParams): void {
  const currentNodes = getNodes();
  const viewport = getViewport?.() || { zoom: 1, x: 0, y: 0 };
  // Get current step from computation store
  const step = computationStore.currentStep;

  // Get existing step-related nodes
  const existingStepNodes = currentNodes.filter(
    (node) => node.type === NODE_TYPES.STEP
  );
  const existingExpressionNodes = currentNodes.filter(
    (node) => node.type === NODE_TYPES.EXPRESSION
  );
  const existingExpressionLabelNodes = currentNodes.filter((node) =>
    isExpressionLabelNode(node)
  );

  // Early return if no existing step artifacts and no current step - nothing to do
  const hasNoExistingStepArtifacts =
    existingStepNodes.length === 0 &&
    existingExpressionNodes.length === 0 &&
    existingExpressionLabelNodes.length === 0;
  const hasNoCurrentStep =
    !step || !step.formulas || Object.keys(step.formulas).length === 0;

  if (hasNoExistingStepArtifacts && hasNoCurrentStep) {
    return;
  }

  if (hasNoCurrentStep) {
    // Remove step, expression, and expression-label nodes if no current step
    setNodes((currentNodes) =>
      currentNodes.filter(
        (node) =>
          node.type !== NODE_TYPES.STEP &&
          node.type !== NODE_TYPES.EXPRESSION &&
          !isExpressionLabelNode(node)
      )
    );
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => !edge.id.startsWith("edge-step-"))
    );
    return;
  }

  // Collect all step nodes, expression nodes, and edges across all matching formulas
  const allstepNodes: Node[] = [];
  const allExpressionNodes: Node[] = [];
  const allExpressionLabelNodes: Node[] = [];
  const allStepEdges: Edge[] = [];
  let stepNodeIndex = 0;

  // Iterate over each formula step
  // For ICollectedStep, formulas is optional Record<string, IView>
  const formulas: Record<string, IView> = step?.formulas ?? {};
  for (const [viewFormulaId, view] of Object.entries(formulas)) {
    // Empty string viewFormulaId means "apply to all formulas"
    const isAllFormulas = viewFormulaId === "";

    // Determine which formula node to use
    let formulaNode: Node | undefined;

    if (formulaId) {
      // FormulaComponent context: we have a specific formulaId
      // Check if this step applies to this formula
      if (!isAllFormulas && viewFormulaId !== formulaId) {
        // This step is for a different formula, skip it
        continue;
      }
      // Find the formula node for this component
      formulaNode = currentNodes.find(
        (node) => node.type === NODE_TYPES.FORMULA && node.data.id === formulaId
      );
    } else {
      // Canvas context: no specific formulaId
      if (isAllFormulas) {
        // Apply to first formula node
        const formulaNodes = getFormulaNodes(currentNodes);
        formulaNode = formulaNodes[0];
      } else {
        // Apply to specific formula by viewFormulaId
        formulaNode = currentNodes.find(
          (node) =>
            node.type === NODE_TYPES.FORMULA && node.data.id === viewFormulaId
        );
      }
    }

    if (!formulaNode || !formulaNode.measured) {
      continue;
    }

    // Get active variable IDs for this formula view from variable-key labels entries.
    const activeVarIds = new Set<string>();
    if (view.labels) {
      for (const labelLatex of Object.keys(view.labels)) {
        if (computationStore.variables.has(labelLatex)) {
          activeVarIds.add(labelLatex);
        }
      }
    }

    // Create step and expression nodes for this formula
    const { stepNodes, expressionNodes, expressionLabelNodes, stepEdges } =
      createStepAndExpressionNodes({
        currentNodes,
        formulaNode,
        view,
        activeVarIds: Array.from(activeVarIds),
        viewport,
        stepNodeIndex,
        computationStore,
      });

    allstepNodes.push(...stepNodes);
    allExpressionNodes.push(...expressionNodes);
    allExpressionLabelNodes.push(...expressionLabelNodes);
    allStepEdges.push(...stepEdges);
    stepNodeIndex += 1;
  }
  // Check if step nodes can be updated in place (same structure, only content changed)
  const sameStructure =
    existingStepNodes.length === allstepNodes.length &&
    existingStepNodes.every(
      (existingNode, index) => existingNode.id === allstepNodes[index]?.id
    );
  const canReuseExpressionNodes = compareNodeIdSets(
    existingExpressionNodes,
    allExpressionNodes
  );
  const canReuseExpressionLabelNodes = compareNodeIdSets(
    existingExpressionLabelNodes,
    allExpressionLabelNodes
  );
  const hasRenderableStepArtifacts =
    allstepNodes.length > 0 ||
    allExpressionNodes.length > 0 ||
    allExpressionLabelNodes.length > 0;

  // Add nodes to the canvas
  if (hasRenderableStepArtifacts) {
    if (
      sameStructure &&
      canReuseExpressionNodes &&
      canReuseExpressionLabelNodes
    ) {
      // Same structure - UPDATE existing nodes' data instead of recreating
      // This prevents flash/flicker when only descriptions change
      const stepNodeMap = new Map(allstepNodes.map((node) => [node.id, node]));
      const expressionNodeMap = new Map(
        allExpressionNodes.map((node) => [node.id, node])
      );
      const expressionLabelNodeMap = new Map(
        allExpressionLabelNodes.map((node) => [node.id, node])
      );

      setNodes((currentNodes) => {
        return currentNodes.map((node) => {
          if (node.type === NODE_TYPES.STEP) {
            const newNode = stepNodeMap.get(node.id);
            if (!newNode) {
              return node;
            }
            const isHidden = node.style?.opacity === 0;
            const hasDescriptionChange =
              node.data.description !== newNode.data.description;
            const hasPositionChange =
              node.position.x !== newNode.position.x ||
              node.position.y !== newNode.position.y;
            if (hasDescriptionChange || (isHidden && hasPositionChange)) {
              return {
                ...node,
                // Keep stable position for visible nodes during value-only updates.
                // Hidden nodes can still accept position updates before first layout pass.
                position: isHidden ? newNode.position : node.position,
                data: {
                  ...node.data,
                  description: newNode.data.description,
                },
              };
            }
          }
          if (node.type === NODE_TYPES.EXPRESSION) {
            const newNode = expressionNodeMap.get(node.id);
            if (!newNode) {
              return node;
            }
            const hasPositionChange =
              node.position.x !== newNode.position.x ||
              node.position.y !== newNode.position.y;
            const hasDimensionChange =
              node.data.width !== newNode.data.width ||
              node.data.height !== newNode.data.height;
            if (hasPositionChange || hasDimensionChange) {
              return {
                ...node,
                position: newNode.position,
                data: {
                  ...node.data,
                  width: newNode.data.width,
                  height: newNode.data.height,
                },
              };
            }
          }
          if (isExpressionLabelNode(node)) {
            const newNode = expressionLabelNodeMap.get(node.id);
            if (
              newNode &&
              (node.data.expressionLabel !== newNode.data.expressionLabel ||
                node.data.expression !== newNode.data.expression ||
                node.position.x !== newNode.position.x ||
                node.position.y !== newNode.position.y)
            ) {
              return {
                ...node,
                position: newNode.position,
                data: {
                  ...node.data,
                  expressionLabel: newNode.data.expressionLabel,
                  expression: newNode.data.expression,
                },
              };
            }
          }
          return node;
        });
      });

      setEdges((currentEdges) => {
        const nonStepEdges = currentEdges.filter(
          (edge) => !edge.id.startsWith("edge-step-")
        );
        return [...nonStepEdges, ...allStepEdges];
      });
      return;
    }

    setNodes((currentNodes) => {
      const filteredNodes = currentNodes.filter(
        (node) =>
          node.type !== NODE_TYPES.STEP &&
          node.type !== NODE_TYPES.EXPRESSION &&
          !isExpressionLabelNode(node)
      );
      return [
        ...filteredNodes,
        ...allExpressionNodes,
        ...allstepNodes,
        ...allExpressionLabelNodes,
      ];
    });

    // Add expression-label edges after nodes are rendered
    if (allStepEdges.length > 0) {
      setTimeout(() => {
        setEdges((currentEdges) => {
          const nonStepEdges = currentEdges.filter(
            (edge) => !edge.id.startsWith("edge-step-")
          );
          return [...nonStepEdges, ...allStepEdges];
        });
      }, 100);
    } else {
      // Remove expression-label edges if no expression label nodes
      setEdges((currentEdges) =>
        currentEdges.filter((edge) => !edge.id.startsWith("edge-step-"))
      );
    }
  } else {
    // Remove step nodes, expression nodes, expression-label nodes, and step edges
    setNodes((currentNodes) =>
      currentNodes.filter(
        (node) =>
          node.type !== NODE_TYPES.STEP &&
          node.type !== NODE_TYPES.EXPRESSION &&
          !isExpressionLabelNode(node)
      )
    );
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => !edge.id.startsWith("edge-step-"))
    );
  }
}
