import { Node } from "@xyflow/react";

import { NODE_TYPES, getFormulaElement } from "./node-helpers";

//--------------------------------------------------
// Canvas Layout
//--------------------------------------------------
//
// The canvas is laid out in two columns. The left column stacks the
// walkthrough controls, any control nodes and the formulas on one vertical
// axis. The right column stacks the visualizations. A formula's block covers
// its labels and step descriptions, so placing blocks apart keeps everything
// drawn around one formula clear of its neighbors.

/**
 * Bounds of a block relative to its node's position
 */
export interface IExtent {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * A top-level canvas node as the layout sees it
 * @property id - React Flow node ID
 * @property width - Width of the node itself
 * @property height - Height of the node itself
 * @property extent - The node and everything drawn around it, such as labels
 * @property anchorX - Formulas only: x of the relation symbol (such as =)
 */
export interface ILayoutBlock {
  id: string;
  width: number;
  height: number;
  extent: IExtent;
  anchorX?: number;
}

/**
 * The canvas content sorted into the layout's columns
 * @property controls - Walkthrough controls, then control nodes, top to bottom
 * @property formulas - Formulas, top to bottom
 * @property visualizations - Graphs and charts, top to bottom
 */
export interface ICanvasLayoutInput {
  controls: ILayoutBlock[];
  formulas: ILayoutBlock[];
  visualizations: ILayoutBlock[];
}

export interface IPosition {
  x: number;
  y: number;
}

/**
 * Gaps between blocks, in canvas units
 */
export const LAYOUT_GAPS = {
  // Between the formula column and the visualization column
  column: 80,
  // Between control nodes
  control: 16,
  // Between the last control and the first formula
  controlToFormula: 32,
  // Between formulas, measured between their labels
  formula: 40,
  // Between visualizations
  visualization: 32,
} as const;

/**
 * Blocks closer than this have collided and need a new layout
 */
export const MIN_CLEARANCE = 12;

/**
 * Stacked blocks may grow this far into the gap between them before the
 * canvas is laid out again, which keeps the column's spacing even
 */
export const GAP_TOLERANCE = 8;

const CONTROL_NODE_TYPES = new Set(["control", "controlPanel"]);
const WALKTHROUGH_NODE_TYPE = "interpreterControl";

export const isVisualizationNode = (node: Node): boolean =>
  node.type === "graph" || node.type === "emptyNode";

const unionExtents = (a: IExtent, b: IExtent): IExtent => ({
  left: Math.min(a.left, b.left),
  top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
});

/**
 * Get a formula's extent: the formula plus its visible labels, step
 * descriptions and expression highlights, which are all its child nodes
 */
function getFormulaExtent(formulaNode: Node, nodes: Node[]): IExtent {
  let extent: IExtent = {
    left: 0,
    top: 0,
    right: formulaNode.measured?.width ?? 0,
    bottom: formulaNode.measured?.height ?? 0,
  };
  for (const child of nodes) {
    if (child.parentId !== formulaNode.id) continue;
    // Hidden children are waiting to be positioned
    if (child.style?.opacity === 0) continue;
    const width = child.measured?.width;
    const height = child.measured?.height;
    if (!width || !height) continue;
    const [originX, originY] = child.origin ?? [0, 0];
    const left = child.position.x - originX * width;
    const top = child.position.y - originY * height;
    extent = unionExtents(extent, {
      left,
      top,
      right: left + width,
      bottom: top + height,
    });
  }
  return extent;
}

/**
 * Sort the top-level nodes into layout blocks
 * @param nodes - Array of all React Flow nodes
 * @returns The layout input, or null while a top-level node is unmeasured
 */
export function collectLayoutBlocks(nodes: Node[]): ICanvasLayoutInput | null {
  const walkthrough: ILayoutBlock[] = [];
  const controls: ILayoutBlock[] = [];
  const formulas: ILayoutBlock[] = [];
  const visualizations: ILayoutBlock[] = [];
  for (const node of nodes) {
    if (node.parentId) continue;
    const width = node.measured?.width;
    const height = node.measured?.height;
    if (!width || !height) return null;
    const block: ILayoutBlock = {
      id: node.id,
      width,
      height,
      extent: { left: 0, top: 0, right: width, bottom: height },
    };
    if (node.type === WALKTHROUGH_NODE_TYPE) {
      walkthrough.push(block);
    } else if (CONTROL_NODE_TYPES.has(node.type ?? "")) {
      controls.push(block);
    } else if (node.type === NODE_TYPES.FORMULA) {
      formulas.push({ ...block, extent: getFormulaExtent(node, nodes) });
    } else if (isVisualizationNode(node)) {
      visualizations.push(block);
    }
  }
  return {
    controls: [...walkthrough, ...controls],
    formulas,
    visualizations,
  };
}

/**
 * Grow each block's extent to cover every extent it has had. Labels and step
 * descriptions change from step to step, and laying out with the largest
 * extents keeps the formulas from shifting as the reader steps back and forth.
 * @param input - Layout blocks with their current extents
 * @param reserved - Largest extent seen per node ID, updated in place
 * @returns Layout blocks with their reserved extents
 */
export function reserveExtents(
  input: ICanvasLayoutInput,
  reserved: Map<string, IExtent>
): ICanvasLayoutInput {
  const reserve = (block: ILayoutBlock): ILayoutBlock => {
    const previous = reserved.get(block.id);
    const extent = previous
      ? unionExtents(previous, block.extent)
      : block.extent;
    reserved.set(block.id, extent);
    return { ...block, extent };
  };
  return {
    controls: input.controls.map(reserve),
    formulas: input.formulas.map(reserve),
    visualizations: input.visualizations.map(reserve),
  };
}

interface IStackItem {
  block: ILayoutBlock;
  gapBefore: number;
}

/**
 * List each column's blocks top to bottom with the gap above each block
 */
function getColumns({
  controls,
  formulas,
  visualizations,
}: ICanvasLayoutInput): IStackItem[][] {
  return [
    [
      ...controls.map((block) => ({ block, gapBefore: LAYOUT_GAPS.control })),
      ...formulas.map((block, index) => ({
        block,
        gapBefore:
          index === 0 ? LAYOUT_GAPS.controlToFormula : LAYOUT_GAPS.formula,
      })),
    ],
    visualizations.map((block) => ({
      block,
      gapBefore: LAYOUT_GAPS.visualization,
    })),
  ];
}

/**
 * Stack blocks top to bottom from y = 0
 * @param items - The column's blocks
 * @param getX - x position for each block
 * @param positions - Positions to fill in
 * @returns The height of the stack
 */
function stackColumn(
  items: IStackItem[],
  getX: (block: ILayoutBlock) => number,
  positions: Map<string, IPosition>
): number {
  let y = 0;
  items.forEach(({ block, gapBefore }, index) => {
    if (index > 0) y += gapBefore;
    positions.set(block.id, { x: getX(block), y: y - block.extent.top });
    y += block.extent.bottom - block.extent.top;
  });
  return y;
}

/**
 * Compute positions for the top-level nodes. Formulas share one vertical
 * axis: their relation symbols line up when every formula has one, and their
 * centers line up otherwise. Controls are centered over the formulas, and
 * the shorter column is centered vertically against the taller one.
 * @param input - Layout blocks sorted into columns
 * @returns Position for each block, keyed by node ID
 */
export function computeCanvasLayout(
  input: ICanvasLayoutInput
): Map<string, IPosition> {
  const { controls, formulas, visualizations } = input;
  const [formulaColumn, visualizationColumn] = getColumns(input);
  const positions = new Map<string, IPosition>();

  const alignOnAnchors =
    formulas.length > 1 &&
    formulas.every((formula) => formula.anchorX !== undefined);
  const formulaXs = new Map(
    formulas.map((formula) => [
      formula.id,
      -(alignOnAnchors ? formula.anchorX! : formula.width / 2),
    ])
  );

  // Center controls on the formulas themselves, ignoring their labels
  let axis = 0;
  if (formulas.length > 0) {
    const left = Math.min(...formulaXs.values());
    const right = Math.max(
      ...formulas.map((formula) => formulaXs.get(formula.id)! + formula.width)
    );
    axis = (left + right) / 2;
  }
  const columnHeight = stackColumn(
    formulaColumn,
    (block) =>
      formulaXs.get(block.id) ??
      axis - (block.extent.left + block.extent.right) / 2,
    positions
  );

  // Visualizations start a fixed gap right of the column's widest block,
  // labels included
  const columnRight = formulaColumn.length
    ? Math.max(
        ...formulaColumn.map(
          ({ block }) => positions.get(block.id)!.x + block.extent.right
        )
      )
    : -LAYOUT_GAPS.column;
  const visualizationHeight = stackColumn(
    visualizationColumn,
    (block) => columnRight + LAYOUT_GAPS.column - block.extent.left,
    positions
  );

  const offset = (columnHeight - visualizationHeight) / 2;
  const shorter = offset > 0 ? visualizations : [...controls, ...formulas];
  for (const block of shorter) {
    const position = positions.get(block.id)!;
    position.y += Math.abs(offset);
  }

  for (const position of positions.values()) {
    position.x = Math.round(position.x);
    position.y = Math.round(position.y);
  }
  return positions;
}

/**
 * Shift a layout so that one node keeps its current position
 * @param positions - Positions from computeCanvasLayout
 * @param id - ID of the node to keep in place
 * @param current - That node's current position
 * @returns The shifted positions
 */
export function keepInPlace(
  positions: Map<string, IPosition>,
  id: string,
  current: IPosition
): Map<string, IPosition> {
  const target = positions.get(id);
  if (!target) return positions;
  const dx = current.x - target.x;
  const dy = current.y - target.y;
  return new Map(
    Array.from(positions, ([nodeId, { x, y }]) => [
      nodeId,
      { x: x + dx, y: y + dy },
    ])
  );
}

/**
 * Check whether blocks have grown into each other's space: a block in a
 * column has eaten more than GAP_TOLERANCE of the gap above it, or any two
 * blocks are closer than MIN_CLEARANCE, as when a long label reaches a graph
 * @param input - Layout blocks with their current extents
 * @param positions - Current position of each block's node
 */
export function isLayoutCrowded(
  input: ICanvasLayoutInput,
  positions: Map<string, IPosition>
): boolean {
  const rectOf = (block: ILayoutBlock): IExtent | null => {
    const position = positions.get(block.id);
    if (!position) return null;
    return {
      left: position.x + block.extent.left,
      top: position.y + block.extent.top,
      right: position.x + block.extent.right,
      bottom: position.y + block.extent.bottom,
    };
  };

  for (const column of getColumns(input)) {
    for (let index = 1; index < column.length; index++) {
      const above = rectOf(column[index - 1].block);
      const below = rectOf(column[index].block);
      if (
        above &&
        below &&
        below.top - above.bottom < column[index].gapBefore - GAP_TOLERANCE
      ) {
        return true;
      }
    }
  }

  const rects = [
    ...input.controls,
    ...input.formulas,
    ...input.visualizations,
  ].flatMap((block) => rectOf(block) ?? []);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (
        a.left < b.right + MIN_CLEARANCE &&
        b.left < a.right + MIN_CLEARANCE &&
        a.top < b.bottom + MIN_CLEARANCE &&
        b.top < a.bottom + MIN_CLEARANCE
      ) {
        return true;
      }
    }
  }
  return false;
}

//--------------------------------------------------
// Relation Symbols
//--------------------------------------------------

// MathJax draws each character as an mjx-c element whose class names its code
// point: =, ≈, ≠, ≤, ≥, ≡, ∝, < and >.
const RELATION_GLYPHS = [
  "mjx-c3D",
  "mjx-c2248",
  "mjx-c2260",
  "mjx-c2264",
  "mjx-c2265",
  "mjx-c2261",
  "mjx-c221D",
  "mjx-c3C",
  "mjx-c3E",
];

// A relation inside one of these belongs to a script, fraction, root or
// matrix rather than to the formula, as with the = in \sum_{i=1}^{n}.
const NESTING_TAGS = new Set([
  "MJX-MSUB",
  "MJX-MSUP",
  "MJX-MSUBSUP",
  "MJX-MUNDER",
  "MJX-MOVER",
  "MJX-MUNDEROVER",
  "MJX-MMULTISCRIPTS",
  "MJX-MFRAC",
  "MJX-MSQRT",
  "MJX-MROOT",
  "MJX-MTABLE",
]);

const isNestedOperator = (operator: Element): boolean => {
  for (
    let element = operator.parentElement;
    element && element.tagName !== "MJX-MATH";
    element = element.parentElement
  ) {
    if (NESTING_TAGS.has(element.tagName)) return true;
  }
  return false;
};

/**
 * Find the x of a formula's first top-level relation symbol, such as =
 * @param formulaNode - The React Flow formula node
 * @param zoom - The React Flow viewport zoom
 * @returns Center x of the symbol relative to the node, or undefined
 */
export function getFormulaAnchorX(
  formulaNode: Node,
  zoom: number
): number | undefined {
  const formulaElement = getFormulaElement(formulaNode);
  if (!formulaElement) return undefined;
  for (const operator of formulaElement.querySelectorAll("mjx-mo")) {
    const glyph = operator.querySelector(":scope > mjx-c");
    if (!glyph) continue;
    if (!RELATION_GLYPHS.some((name) => glyph.classList.contains(name))) {
      continue;
    }
    if (isNestedOperator(operator)) continue;
    const formulaRect = formulaElement.getBoundingClientRect();
    const rect = operator.getBoundingClientRect();
    return (rect.left + rect.width / 2 - formulaRect.left) / zoom;
  }
  return undefined;
}

/**
 * Add each formula's relation symbol position, read from the rendered math
 * @param input - Layout blocks
 * @param nodes - Array of all React Flow nodes
 * @param zoom - The React Flow viewport zoom
 * @returns Layout blocks whose formulas have anchors where found
 */
export function withFormulaAnchors(
  input: ICanvasLayoutInput,
  nodes: Node[],
  zoom: number
): ICanvasLayoutInput {
  return {
    ...input,
    formulas: input.formulas.map((formula) => {
      const formulaNode = nodes.find((node) => node.id === formula.id);
      return formulaNode
        ? { ...formula, anchorX: getFormulaAnchorX(formulaNode, zoom) }
        : formula;
    }),
  };
}

/**
 * Check whether MathJax has typeset every formula node
 */
export function areFormulasTypeset(nodes: Node[]): boolean {
  return nodes.every(
    (node) =>
      node.type !== NODE_TYPES.FORMULA ||
      !!getFormulaElement(node)?.querySelector("mjx-container")
  );
}
