import { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  NODE_TYPES,
  findVariableNodesByVarId,
  findVariableNodesForFormulaNode,
  positionAndShowstepNodes,
} from "./node-helpers";

const makeNode = (
  id: string,
  type: string,
  data: Record<string, unknown>,
  parentId?: string
): Node => ({
  id,
  type,
  data,
  parentId,
  position: { x: 0, y: 0 },
});

const formulaNode = makeNode("formula-node-a", NODE_TYPES.FORMULA, {
  id: "formula-a",
});

const nodes: Node[] = [
  formulaNode,
  makeNode(
    "v-2-b",
    NODE_TYPES.VARIABLE,
    { varId: "v", instance: 2 },
    formulaNode.id
  ),
  makeNode(
    "v-other-formula",
    NODE_TYPES.VARIABLE,
    { varId: "v", instance: 1 },
    "formula-node-b"
  ),
  makeNode("v-legacy", NODE_TYPES.VARIABLE, { varId: "v" }, formulaNode.id),
  makeNode(
    "not-a-variable",
    NODE_TYPES.LABEL,
    { varId: "v", instance: 1 },
    formulaNode.id
  ),
  makeNode(
    "v-2-a",
    NODE_TYPES.VARIABLE,
    { varId: "v", instance: 2 },
    formulaNode.id
  ),
  makeNode(
    "w-1",
    NODE_TYPES.VARIABLE,
    { varId: "w", instance: 1 },
    formulaNode.id
  ),
  makeNode(
    "v-1",
    NODE_TYPES.VARIABLE,
    { varId: "v", instance: 1 },
    formulaNode.id
  ),
];

describe("variable node finders", () => {
  it("filters and orders occurrences within a React Flow formula node", () => {
    const matches = findVariableNodesForFormulaNode(
      nodes,
      formulaNode.id,
      "v"
    );

    expect(matches.map((node) => node.id)).toEqual([
      "v-1",
      "v-2-a",
      "v-2-b",
      "v-legacy",
    ]);
  });

  it("resolves public formula IDs before using the shared finder", () => {
    expect(
      findVariableNodesByVarId(nodes, "formula-a", "v").map(
        (node) => node.id
      )
    ).toEqual(["v-1", "v-2-a", "v-2-b", "v-legacy"]);
    expect(findVariableNodesByVarId(nodes, "missing-formula", "v")).toEqual([]);
  });
});

describe("positionAndShowstepNodes", () => {
  const stepNode: Node = {
    ...makeNode("step-0", NODE_TYPES.STEP, {}, formulaNode.id),
    measured: { width: 200, height: 24 },
    style: { opacity: 0 },
  };
  const stepY = (laneTop?: number) =>
    positionAndShowstepNodes(
      [formulaNode, stepNode],
      formulaNode,
      laneTop === undefined ? undefined : () => laneTop
    ).find((node) => node.id === "step-0")!.position.y;

  it("places a description just above an unlabeled formula", () => {
    expect(stepY()).toBe(-25 - 24);
  });

  it("raises a description to the reserved lane", () => {
    expect(stepY(-80)).toBe(-80);
  });

  it("never lowers a description into the labels below the lane", () => {
    expect(stepY(-20)).toBe(-25 - 24);
  });
});
