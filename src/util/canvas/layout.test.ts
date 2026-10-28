import { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  GAP_TOLERANCE,
  ICanvasLayoutInput,
  IExtent,
  ILayoutBlock,
  IPosition,
  LAYOUT_GAPS,
  MIN_CLEARANCE,
  collectLayoutBlocks,
  computeCanvasLayout,
  isLayoutCrowded,
  keepInPlace,
  reserveExtents,
} from "./layout";

const makeBlock = (
  id: string,
  width: number,
  height: number,
  options: { extent?: Partial<IExtent>; anchorX?: number } = {}
): ILayoutBlock => ({
  id,
  width,
  height,
  extent: { left: 0, top: 0, right: width, bottom: height, ...options.extent },
  anchorX: options.anchorX,
});

const rectOf = (block: ILayoutBlock, position: IPosition): IExtent => ({
  left: position.x + block.extent.left,
  top: position.y + block.extent.top,
  right: position.x + block.extent.right,
  bottom: position.y + block.extent.bottom,
});

const allBlocks = (input: ICanvasLayoutInput) => [
  ...input.controls,
  ...input.formulas,
  ...input.visualizations,
];

// The gradient descent example: walkthrough controls, two formulas with
// labels above and below, and one graph.
const gradientDescent: ICanvasLayoutInput = {
  controls: [makeBlock("interpreter-control", 176, 96)],
  formulas: [
    makeBlock("formula-loss-function", 157, 45, {
      extent: { left: -10, top: -30, bottom: 93 },
      anchorX: 30,
    }),
    makeBlock("formula-update-weight", 292, 44, {
      extent: { left: -40, top: -30, bottom: 92 },
      anchorX: 55,
    }),
  ],
  visualizations: [makeBlock("graph-node-2d-gradient-descent", 418, 418)],
};

describe("computeCanvasLayout", () => {
  it("keeps the walkthrough controls, formulas and graph apart", () => {
    const positions = computeCanvasLayout(gradientDescent);
    const blocks = allBlocks(gradientDescent);

    expect(isLayoutCrowded(gradientDescent, positions)).toBe(false);
    const graph = gradientDescent.visualizations[0];
    const graphLeft = rectOf(graph, positions.get(graph.id)!).left;
    for (const block of blocks) {
      if (block === graph) continue;
      expect(rectOf(block, positions.get(block.id)!).right).toBeLessThan(
        graphLeft
      );
    }
  });

  it("lines formulas up on their relation symbols", () => {
    const positions = computeCanvasLayout(gradientDescent);
    const [loss, update] = gradientDescent.formulas;

    expect(positions.get(loss.id)!.x + loss.anchorX!).toBe(
      positions.get(update.id)!.x + update.anchorX!
    );
  });

  it("centers the controls over the formulas", () => {
    const positions = computeCanvasLayout(gradientDescent);
    const [loss, update] = gradientDescent.formulas;
    const formulasLeft = Math.min(
      positions.get(loss.id)!.x,
      positions.get(update.id)!.x
    );
    const formulasRight = Math.max(
      positions.get(loss.id)!.x + loss.width,
      positions.get(update.id)!.x + update.width
    );
    const controls = gradientDescent.controls[0];
    const controlsCenter = positions.get(controls.id)!.x + controls.width / 2;

    expect(
      Math.abs(controlsCenter - (formulasLeft + formulasRight) / 2)
    ).toBeLessThanOrEqual(1);
  });

  it("centers formulas when one has no relation symbol", () => {
    const input: ICanvasLayoutInput = {
      controls: [],
      formulas: [
        makeBlock("a", 100, 40, { anchorX: 20 }),
        makeBlock("b", 200, 40),
      ],
      visualizations: [],
    };
    const positions = computeCanvasLayout(input);

    expect(positions.get("a")!.x + 50).toBe(positions.get("b")!.x + 100);
  });

  it("spaces formulas apart by their labels", () => {
    const positions = computeCanvasLayout(gradientDescent);
    const [loss, update] = gradientDescent.formulas;
    const lossBottom = rectOf(loss, positions.get(loss.id)!).bottom;
    const updateTop = rectOf(update, positions.get(update.id)!).top;

    expect(updateTop - lossBottom).toBe(LAYOUT_GAPS.formula);
  });

  it("centers the shorter column against the taller one", () => {
    const input: ICanvasLayoutInput = {
      controls: [],
      formulas: [makeBlock("formula", 120, 40)],
      visualizations: [makeBlock("graph", 400, 400)],
    };
    const positions = computeCanvasLayout(input);

    expect(positions.get("graph")!.y).toBe(0);
    expect(positions.get("formula")!.y).toBe(180);
  });

  it("stacks visualizations without formulas", () => {
    const input: ICanvasLayoutInput = {
      controls: [],
      formulas: [],
      visualizations: [makeBlock("a", 300, 200), makeBlock("b", 300, 100)],
    };
    const positions = computeCanvasLayout(input);

    expect(positions.get("a")).toEqual({ x: 0, y: 0 });
    expect(positions.get("b")).toEqual({
      x: 0,
      y: 200 + LAYOUT_GAPS.visualization,
    });
  });
});

describe("isLayoutCrowded", () => {
  const input: ICanvasLayoutInput = {
    controls: [makeBlock("controls", 100, 50)],
    formulas: [],
    visualizations: [makeBlock("graph", 100, 100)],
  };

  it("detects overlapping blocks", () => {
    const positions = new Map([
      ["controls", { x: 0, y: 0 }],
      ["graph", { x: 50, y: 25 }],
    ]);
    expect(isLayoutCrowded(input, positions)).toBe(true);
  });

  it("detects blocks closer than the minimum clearance", () => {
    const positions = new Map([
      ["controls", { x: 0, y: 0 }],
      ["graph", { x: 100 + MIN_CLEARANCE - 1, y: 0 }],
    ]);
    expect(isLayoutCrowded(input, positions)).toBe(true);
  });

  it("accepts blocks at the minimum clearance", () => {
    const positions = new Map([
      ["controls", { x: 0, y: 0 }],
      ["graph", { x: 100 + MIN_CLEARANCE, y: 0 }],
    ]);
    expect(isLayoutCrowded(input, positions)).toBe(false);
  });

  describe("in a column", () => {
    // A step description 30 units above the formula
    const column: ICanvasLayoutInput = {
      controls: [makeBlock("controls", 100, 50)],
      formulas: [makeBlock("formula", 100, 40, { extent: { top: -30 } })],
      visualizations: [],
    };
    const formulaAt = (clearance: number) =>
      new Map([
        ["controls", { x: 0, y: 0 }],
        ["formula", { x: 0, y: 50 + clearance + 30 }],
      ]);

    it("detects a block that grew into the gap above it", () => {
      const clearance = LAYOUT_GAPS.controlToFormula - GAP_TOLERANCE - 1;
      expect(isLayoutCrowded(column, formulaAt(clearance))).toBe(true);
    });

    it("tolerates a little growth into the gap", () => {
      const clearance = LAYOUT_GAPS.controlToFormula - GAP_TOLERANCE;
      expect(isLayoutCrowded(column, formulaAt(clearance))).toBe(false);
    });
  });
});

describe("reserveExtents", () => {
  it("only grows the reserved extents", () => {
    const reserved = new Map<string, IExtent>();
    const withLabelAbove: ICanvasLayoutInput = {
      controls: [],
      formulas: [makeBlock("formula", 100, 40, { extent: { top: -30 } })],
      visualizations: [],
    };
    const withLabelBelow: ICanvasLayoutInput = {
      controls: [],
      formulas: [makeBlock("formula", 100, 40, { extent: { bottom: 90 } })],
      visualizations: [],
    };

    reserveExtents(withLabelAbove, reserved);
    const result = reserveExtents(withLabelBelow, reserved);

    expect(result.formulas[0].extent).toEqual({
      left: 0,
      top: -30,
      right: 100,
      bottom: 90,
    });
  });
});

describe("keepInPlace", () => {
  it("shifts every position so one node stays put", () => {
    const positions = new Map([
      ["controls", { x: 10, y: 0 }],
      ["formula", { x: 0, y: 100 }],
    ]);
    const shifted = keepInPlace(positions, "controls", { x: 60, y: 20 });

    expect(shifted.get("controls")).toEqual({ x: 60, y: 20 });
    expect(shifted.get("formula")).toEqual({ x: 50, y: 120 });
  });
});

describe("collectLayoutBlocks", () => {
  const makeNode = (
    id: string,
    type: string,
    measured?: { width: number; height: number },
    extra: Partial<Node> = {}
  ): Node => ({
    id,
    type,
    data: {},
    position: { x: 0, y: 0 },
    measured,
    ...extra,
  });

  it("sorts top-level nodes into columns, walkthrough controls first", () => {
    const blocks = collectLayoutBlocks([
      makeNode("control-0", "control", { width: 80, height: 30 }),
      makeNode("formula-a", "formula", { width: 100, height: 40 }),
      makeNode("graph-node-2d-g", "graph", { width: 400, height: 400 }),
      makeNode("interpreter-control", "interpreterControl", {
        width: 176,
        height: 96,
      }),
    ]);

    expect(blocks?.controls.map((block) => block.id)).toEqual([
      "interpreter-control",
      "control-0",
    ]);
    expect(blocks?.formulas.map((block) => block.id)).toEqual(["formula-a"]);
    expect(blocks?.visualizations.map((block) => block.id)).toEqual([
      "graph-node-2d-g",
    ]);
  });

  it("extends a formula's extent over its visible labels", () => {
    const blocks = collectLayoutBlocks([
      makeNode("formula-a", "formula", { width: 100, height: 40 }),
      // A step description centered over the formula
      makeNode(
        "step-0",
        "step",
        { width: 300, height: 24 },
        { parentId: "formula-a", position: { x: 50, y: -60 }, origin: [0.5, 0] }
      ),
      makeNode(
        "label-a-x",
        "label",
        { width: 40, height: 36 },
        { parentId: "formula-a", position: { x: 20, y: 50 } }
      ),
      // Hidden labels have not been positioned yet
      makeNode(
        "label-a-y",
        "label",
        { width: 40, height: 36 },
        {
          parentId: "formula-a",
          position: { x: 0, y: 500 },
          style: { opacity: 0 },
        }
      ),
    ]);

    expect(blocks?.formulas[0].extent).toEqual({
      left: -100,
      top: -60,
      right: 200,
      bottom: 86,
    });
  });

  it("waits for every top-level node to be measured", () => {
    expect(
      collectLayoutBlocks([
        makeNode("formula-a", "formula", { width: 100, height: 40 }),
        makeNode("graph-node-2d-g", "graph"),
      ])
    ).toBeNull();
  });
});
