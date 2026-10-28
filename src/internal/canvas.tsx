import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { reaction } from "mobx";
import { observer } from "mobx-react-lite";

import {
  Edge,
  Node,
  NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { ComputationStore } from "../store/computation";
import { debugStore } from "../store/debug";
import { IControls } from "../types/control";
import { IEnvironment } from "../types/environment";
import { computeLabelVariableEdges } from "../util/canvas/edges";
import {
  addLabelNodes as addLabelNodesUtil,
  adjustLabelPositions as adjustLabelPositionsUtil,
  updateAllLabelNodes as updateAllLabelNodesUtil,
} from "../util/canvas/label-node";
import {
  IExtent,
  IPosition,
  areFormulasTypeset,
  collectLayoutBlocks,
  computeCanvasLayout,
  isLayoutCrowded,
  keepInPlace,
  reserveExtents,
  withFormulaAnchors,
} from "../util/canvas/layout";
import {
  NODE_TYPES,
  checkAllNodesMeasured,
  getFormulaNodes,
  getLabelNodes,
  getVariableNodes,
  positionAndShowstepNodes,
} from "../util/canvas/node-helpers";
import { addstepNodes as addstepNodesUtil } from "../util/canvas/step-node";
import {
  useAddVariableNodes,
  useUpdateVariableNodes,
} from "../util/canvas/variable-nodes";
import { CanvasControls } from "./canvas-controls";
import { nodeTypes as defaultNodeTypes } from "./nodes/node";
import BayesProbabilityChart from "../visualizations/custom/components/bayes-probability-chart";

interface CanvasProps {
  controls?: IControls[];
  environment?: IEnvironment;
  computationStore: ComputationStore;
}

const BAYES_EXAMPLE_ID = "bayesWithCustomVisualization";
const BAYES_FORMULA_ID = "bayes-theorem";

const CanvasFlow = observer(
  ({ controls, environment, computationStore }: CanvasProps) => {
    // Toggle state for showing all drag handles
    const [showGrips, setShowGrips] = useState(false);
    const toggleGrips = useCallback(() => setShowGrips((prev) => !prev), []);

    // Ref for the canvas container to observe size changes
    const canvasContainerRef = useRef<HTMLDivElement>(null);

    // Tracks completion of the variable/label bootstrap pipeline
    const bootstrapCompleteRef = useRef(false);

    // Track if initial fitView has been called to prevent re-fitting on every render
    const initialFitViewCalledRef = useRef(false);

    // Track if the top-level nodes have been arranged since they were created
    const layoutAppliedRef = useRef(false);

    // Largest extent each top-level node has had, so the space reserved for
    // labels never shrinks while stepping through a walkthrough
    const reservedExtentsRef = useRef(new Map<string, IExtent>());

    // Once the reader drags a node, keep their arrangement
    const userArrangedRef = useRef(false);

    // Label nodes are added shortly after variable nodes, either by the
    // bootstrap or by a step update, and the first layout waits for them
    const [labelsBootstrapped, setLabelsBootstrapped] = useState(false);

    // Track pending label update animation frame (outside useEffect for persistence)
    const labelUpdateFrameRef = useRef<number | null>(null);
    // Track nested animation frame for label/step node rebuild
    const labelRebuildFrameRef = useRef<number | null>(null);

    // Track if step nodes have been repositioned after label adjustment
    const stepNodeRepositionedRef = useRef(false);

    // React Flow hooks for accessing measured node data
    const { getNodes, getViewport, fitView } = useReactFlow();
    const nodesInitialized = useNodesInitialized();

    // Helper function to get expressions to render from the system
    const getFormula = useCallback((): string[] => {
      if (computationStore.formulas.length > 0) {
        return computationStore.formulas.map((f) => f.latex);
      }
      return [];
    }, [computationStore.formulas]);

    // Initialize React Flow state first
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const selectedTemplate = debugStore.selectedTemplate;

    /**
     * Check if a label node should be visible based on the same logic as LabelNode component
     * @param varId - The variable ID to check
     * @returns true if the label should be visible, false otherwise
     */
    const shouldLabelBeVisible = useCallback(
      (varId: string): boolean => {
        // If not in step mode, always show labels
        if (!computationStore.isStepMode()) {
          return true;
        }

        // In step mode, only show labels for active variables
        // activeVariables is a Map<formulaId, Set<varId>>
        // For canvas.tsx (multi-formula canvas), check all formula sets
        const activeVariables = computationStore.getActiveVariables();
        for (const varSet of activeVariables.values()) {
          if (varSet.has(varId)) {
            return true;
          }
        }
        return false;
      },
      [computationStore]
    );

    /**
     * Create edges between label nodes and their corresponding variable nodes
     * @param currentNodes - The current array of nodes
     * @returns Array of edges connecting labels to variables
     */
    const createLabelVariableEdges = useCallback(
      (currentNodes: Node[]): Edge[] =>
        computeLabelVariableEdges(currentNodes, shouldLabelBeVisible),
      [shouldLabelBeVisible]
    );

    // Enhanced onNodesChange that remembers when the reader moves a node
    const handleNodesChange = useCallback(
      (changes: NodeChange[]) => {
        if (
          changes.some(
            (change) => change.type === "position" && change.dragging
          )
        ) {
          userArrangedRef.current = true;
        }
        onNodesChange(changes);
      },
      [onNodesChange]
    );

    // Create nodes from formulas and controls
    const createNodes = useCallback((): Node[] => {
      const nodes: Node[] = [];
      const formulas = getFormula();

      let currentY = 50; // Starting Y position

      // Add interpreter control node if in step mode
      if (computationStore.isStepMode() && environment) {
        nodes.push({
          id: "interpreter-control",
          type: "interpreterControl",
          position: { x: 600, y: currentY },
          data: { environment },
          draggable: true,
        });
        currentY += 80; // Add space after interpreter controls
      }

      // Add individual control nodes if controls exist
      if (controls && controls.length > 0) {
        controls.forEach((control, index) => {
          nodes.push({
            id: `control-${index}`,
            type: "control",
            position: { x: 250, y: currentY },
            data: { control },
            draggable: true,
          });
          currentY += 100; // Add space after each control
        });
      }

      // Add formula nodes vertically
      formulas.forEach((latex, index) => {
        // Get id from computation store formulas
        const formula = computationStore.formulas[index];
        if (!formula?.id) {
          console.error(`Formula at index ${index} missing required id`);
          return;
        }
        const id = formula.id;
        nodes.push({
          id: `formula-${id}`,
          type: "formula",
          position: { x: 250, y: currentY },
          data: {
            latex,
            environment,
            id,
            computationStore,
          },
          dragHandle: ".formula-drag-handle",
          draggable: true,
          style: {
            cursor: "default",
          },
        });
        currentY += 200; // Vertical spacing between formula nodes
      });

      const graph2D = environment?.graph2d ?? [];
      const graph3D = environment?.graph3d ?? [];
      const hasGraphNodes = graph2D.length > 0 || graph3D.length > 0;
      let vizY = 0; // Start visualizations at the same Y as formulas

      if (hasGraphNodes) {
        graph2D.forEach((plot) => {
          nodes.push({
            id: `graph-node-2d-${plot.id}`,
            type: "graph",
            position: { x: 800, y: vizY },
            data: { graphId: plot.id },
            draggable: true,
            dragHandle: ".visualization-drag-handle",
          });
          vizY += 300;
        });
        graph3D.forEach((plot) => {
          nodes.push({
            id: `graph-node-3d-${plot.id}`,
            type: "graph",
            position: { x: 800, y: vizY },
            data: { graphId: plot.id },
            draggable: true,
            dragHandle: ".visualization-drag-handle",
          });
          vizY += 300;
        });
      }

      const isBayesExampleSelected = selectedTemplate === BAYES_EXAMPLE_ID;
      const hasBayesFormula = computationStore.formulas.some(
        (formula) => formula.id === BAYES_FORMULA_ID
      );

      if (isBayesExampleSelected || hasBayesFormula) {
        nodes.push({
          id: "bayes-chart",
          type: "emptyNode",
          position: { x: 800, y: vizY },
          data: { component: BayesProbabilityChart },
          draggable: true,
          dragHandle: ".empty-node-drag-handle",
        });
      }

      return nodes;
    }, [getFormula, controls, environment, computationStore, selectedTemplate]);

    // Function to add step nodes for variables with step descriptions
    const addstepNodes = useCallback(() => {
      addstepNodesUtil({
        getNodes,
        getViewport,
        setNodes,
        setEdges,
        computationStore,
      });
    }, [getNodes, getViewport, setNodes, setEdges, computationStore]);

    // Separate function to add label nodes after variable nodes are positioned
    const addLabelNodes = useCallback(() => {
      addLabelNodesUtil({
        getNodes,
        getViewport,
        setNodes,
        computationStore,
      });
      setLabelsBootstrapped(true);
    }, [getNodes, getViewport, setNodes, computationStore]);

    // Function to update label nodes in place (used during step transitions)
    const updateLabelNodes = useCallback(() => {
      const labelSetChanged = updateAllLabelNodesUtil({
        getNodes,
        getViewport,
        setNodes,
        computationStore,
      });
      setLabelsBootstrapped(true);
      return labelSetChanged;
    }, [getNodes, getViewport, setNodes, computationStore]);

    // Function to adjust label positions after they're rendered and measured
    const adjustLabelPositions = useCallback(() => {
      adjustLabelPositionsUtil({
        getNodes,
        setNodes,
        lockCurrentPlacements: computationStore.isDragging,
      });
    }, [computationStore, getNodes, setNodes]);

    // Function to add variable nodes as subnodes using React Flow's measurement system
    const addVariableNodes = useAddVariableNodes({
      nodesInitialized,
      setNodes,
      addLabelNodes,
      addstepNodes,
      bootstrapCompleteRef,
      computationStore,
    });

    const updateVariableNodes = useUpdateVariableNodes({
      nodesInitialized,
      setNodes,
      bootstrapCompleteRef,
      computationStore,
    });

    // Update nodes when formulas or controls change
    useEffect(() => {
      const resetNodes = () => {
        // New nodes are measured, bootstrapped and arranged from scratch
        bootstrapCompleteRef.current = false;
        layoutAppliedRef.current = false;
        initialFitViewCalledRef.current = false;
        userArrangedRef.current = false;
        reservedExtentsRef.current = new Map();
        setLabelsBootstrapped(false);
        // Clear manually positioned labels when formulas change
        setNodes(createNodes());
        setEdges([]); // Clear edges when nodes are reset
        // Variable nodes will be added when nodes are initialized
      };
      const disposer = reaction(
        () => ({
          formulas: computationStore.formulas.map((f) => f.latex),
          controls: controls,
        }),
        resetNodes
      );

      // Initial setup
      resetNodes();

      return () => {
        disposer();
      };
    }, [createNodes, setNodes, setEdges, computationStore, controls]);

    // Add variable nodes when React Flow nodes are initialized and measured
    useEffect(() => {
      if (nodesInitialized && !bootstrapCompleteRef.current) {
        if (computationStore.variables.size === 0) {
          bootstrapCompleteRef.current = true;
          return;
        }
        addVariableNodes();
      }
    }, [nodesInitialized, nodes, addVariableNodes, computationStore]);

    // Arrange the top-level nodes once their labels and step descriptions are
    // placed, then fit the view (only on initial load). After that, arrange
    // them again only when a step's labels crowd a neighboring node.
    // reserveExtents keeps that space for every later step, so the formulas
    // stay put as the reader steps back and forth.
    useEffect(() => {
      if (!nodesInitialized || nodes.length === 0) return;
      // Wait until variable-node bootstrap has completed (including zero-variable configs).
      if (!bootstrapCompleteRef.current) return;
      // Labels are added shortly after the variable nodes, hidden until positioned
      if (!labelsBootstrapped && getVariableNodes(nodes).length > 0) return;
      if (getLabelNodes(nodes).some((node) => node.style?.opacity === 0)) {
        return;
      }
      if (!areFormulasTypeset(nodes)) return;

      const isFirstLayout = !layoutAppliedRef.current;
      if (
        isFirstLayout ||
        (!userArrangedRef.current && !computationStore.isDragging)
      ) {
        const blocks = collectLayoutBlocks(nodes);
        if (!blocks) return;
        const reservedBlocks = reserveExtents(
          blocks,
          reservedExtentsRef.current
        );
        const currentPositions = new Map<string, IPosition>(
          nodes
            .filter((node) => !node.parentId)
            .map((node) => [node.id, node.position])
        );
        if (isFirstLayout || isLayoutCrowded(blocks, currentPositions)) {
          let positions = computeCanvasLayout(
            withFormulaAnchors(reservedBlocks, nodes, getViewport().zoom)
          );
          // Keep the top of the formula column, such as the walkthrough
          // controls the reader is clicking, where it was
          const anchor = blocks.controls[0] ?? blocks.formulas[0];
          const anchorPosition = anchor && currentPositions.get(anchor.id);
          if (!isFirstLayout && anchorPosition) {
            positions = keepInPlace(positions, anchor.id, anchorPosition);
          }
          layoutAppliedRef.current = true;
          const moved = nodes.some((node) => {
            const position = positions.get(node.id);
            return (
              position &&
              (position.x !== node.position.x || position.y !== node.position.y)
            );
          });
          if (moved) {
            setNodes((currentNodes) =>
              currentNodes.map((node) => {
                const position = positions.get(node.id);
                return position ? { ...node, position } : node;
              })
            );
            // The fit runs on the next render, after the move.
            return;
          }
        }
      }

      if (!initialFitViewCalledRef.current) {
        // Like fitViewOptions, never zoom past 100%, so a single short formula
        // isn't blown up to fill the canvas.
        fitView({ duration: 300, padding: 0.2, maxZoom: 1 });
        initialFitViewCalledRef.current = true;
      }
    }, [
      nodesInitialized,
      nodes,
      labelsBootstrapped,
      fitView,
      getViewport,
      setNodes,
      computationStore,
    ]);

    // Re-add variable nodes when computation store variables change
    useEffect(() => {
      const disposer = reaction(
        () => ({
          // Watch for changes in the set of variables (additions/removals)
          variableKeys: Array.from(computationStore.variables.keys()).sort(),
        }),
        () => {
          if (nodesInitialized) {
            // Variables set has changed, need to recreate all variable nodes
            bootstrapCompleteRef.current = false;
            if (computationStore.variables.size === 0) {
              setNodes((currentNodes) =>
                currentNodes.filter(
                  (node) =>
                    node.type !== NODE_TYPES.VARIABLE &&
                    node.type !== NODE_TYPES.LABEL &&
                    node.type !== NODE_TYPES.STEP &&
                    node.type !== NODE_TYPES.EXPRESSION
                )
              );
              bootstrapCompleteRef.current = true;
              return;
            }
            addVariableNodes();
          }
        },
        {
          fireImmediately: false,
        }
      );
      return () => disposer();
    }, [
      nodesInitialized,
      addVariableNodes,
      computationStore.variables,
      setNodes,
    ]);

    // Update variable node positions/dimensions when values change or editing ends
    useEffect(() => {
      let wasEditing = false;
      const disposer = reaction(
        () => ({
          variables: Array.from(computationStore.variables.entries()).map(
            ([id, variable]) => ({
              id,
              value: variable.value,
              precision: variable.precision,
              sigFigs: variable.sigFigs,
            })
          ),
          // Track editing states to delay update until after MathJax re-renders
          editingStatesSize: computationStore.editingStates.size,
        }),
        ({ editingStatesSize }) => {
          if (!nodesInitialized || !bootstrapCompleteRef.current) return;

          // Track if we're currently editing
          if (editingStatesSize > 0) {
            wasEditing = true;
            // Still update during editing - the input width reflects typed content
            updateVariableNodes();
            return;
          }

          // If editing just ended, delay to let MathJax re-render first
          if (wasEditing) {
            wasEditing = false;
            // Use requestAnimationFrame to wait for MathJax to re-render
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                updateVariableNodes();
              });
            });
            return;
          }

          updateVariableNodes();
        }
      );
      return () => disposer();
    }, [nodesInitialized, updateVariableNodes, computationStore]);

    // Update edges whenever nodes change to keep label-variable connections in sync
    // Only create edges after labels are positioned and visible
    useEffect(() => {
      if (nodes.length > 0) {
        // Check if all label nodes are visible (positioned correctly)
        const labelNodes = getLabelNodes(nodes);
        const visibleLabelNodes = labelNodes.filter(
          (node) => !node.style || node.style.opacity !== 0
        );

        // Only create edges if all labels are visible or there are no labels
        if (
          labelNodes.length === 0 ||
          visibleLabelNodes.length === labelNodes.length
        ) {
          const computedEdges = createLabelVariableEdges(nodes);

          // Preserve existing step edges (they are managed separately by addstepNodes)
          const existingStepEdges = edges.filter((edge) =>
            edge.id.startsWith("edge-step-")
          );

          // Preserve object identity for unchanged edges to avoid re-renders
          const nextLabelEdges = computedEdges
            .map((edge) => {
              const prev = edges.find((e) => e.id === edge.id);
              if (
                prev &&
                prev.source === edge.source &&
                prev.target === edge.target &&
                prev.sourceHandle === edge.sourceHandle &&
                prev.targetHandle === edge.targetHandle &&
                prev.type === edge.type
              ) {
                return prev; // reuse previous edge object
              }
              return edge;
            })
            .sort((a, b) => a.id.localeCompare(b.id));

          // Combine label edges with preserved step edges
          const nextEdges = [...nextLabelEdges, ...existingStepEdges];

          // Shallow reference equality check to skip unnecessary setEdges
          const sameByRef =
            nextEdges.length === edges.length &&
            nextEdges.every((e, i) => e === edges[i]);
          if (!sameByRef) {
            setEdges(nextEdges);
          }
        } else {
          // Keep only step edges while labels are being positioned
          const stepEdges = edges.filter((edge) =>
            edge.id.startsWith("edge-step-")
          );
          if (stepEdges.length !== edges.length) {
            setEdges(stepEdges);
          }
        }
      } else {
        setEdges([]);
      }
    }, [nodes, edges, createLabelVariableEdges, setEdges]);

    // Update labels when step mode or active variables change, or when a
    // formula finishes rendering and its variables may have moved
    useEffect(() => {
      const disposer = reaction(
        () => ({
          isStepMode: computationStore.isStepMode(),
          // Track activeVariables by serializing the Map to detect changes
          // This is what determines which labels to show
          activeVariables: Array.from(
            computationStore.getActiveVariables().entries()
          ).map(([formulaId, varSet]) => [formulaId, Array.from(varSet)]),
          currentStep: computationStore.currentStep,
          stepIndex: computationStore.currentStepIndex,
          formulaRenderCount: computationStore.formulaRenderCount,
        }),
        () => {
          // Once the first labels are added, handle every step even while
          // some nodes are unmeasured. A label added for one step renders
          // nothing, so it is never measured, if the reader moves on to a
          // step where its variable is inactive. Only this pass removes it,
          // so waiting for every node to be measured would freeze the
          // walkthrough.
          if (
            (nodesInitialized || labelsBootstrapped) &&
            bootstrapCompleteRef.current
          ) {
            // Cancel any pending animation frames
            if (labelUpdateFrameRef.current) {
              cancelAnimationFrame(labelUpdateFrameRef.current);
            }
            if (labelRebuildFrameRef.current) {
              cancelAnimationFrame(labelRebuildFrameRef.current);
            }

            labelUpdateFrameRef.current = window.requestAnimationFrame(() => {
              // Variable dimensions must update first so label/expression bounds use
              // the latest geometry when the current step changes.
              updateVariableNodes();
              stepNodeRepositionedRef.current = false;
              labelRebuildFrameRef.current = window.requestAnimationFrame(() => {
                // Only clear label edges if the label set itself changed.
                const labelSetChanged = updateLabelNodes();
                if (labelSetChanged) {
                  setEdges((currentEdges) =>
                    currentEdges.filter((edge) =>
                      edge.id.startsWith("edge-step-")
                    )
                  );
                }
                // Update labels in place (no flicker) and add/update step nodes
                addstepNodes();
              });
            });
          }
        },
        { fireImmediately: true } // Fire immediately to handle initial state
      );

      return () => {
        disposer();
        if (labelUpdateFrameRef.current) {
          cancelAnimationFrame(labelUpdateFrameRef.current);
        }
        if (labelRebuildFrameRef.current) {
          cancelAnimationFrame(labelRebuildFrameRef.current);
        }
      };
    }, [
      nodesInitialized,
      labelsBootstrapped,
      updateLabelNodes,
      addstepNodes,
      updateVariableNodes,
      setEdges,
      computationStore,
    ]);

    // Adjust label and view node positions after they're rendered and measured
    useEffect(() => {
      if (!nodesInitialized || !bootstrapCompleteRef.current) return;
      // Check if all nodes are ready for positioning
      const { labelNodes, stepNodes, allReady } = checkAllNodesMeasured(nodes);

      // Check if there are step nodes that need to be positioned (have opacity 0)
      const stepNodesNeedPositioning = stepNodes.some(
        (node) => node.style?.opacity === 0
      );
      // Check if there are label nodes that need to be positioned (have opacity 0)
      const labelNodesNeedPositioning = labelNodes.some(
        (node) => node.style?.opacity === 0
      );

      // If no labels and no step nodes exist, nothing to do
      if (labelNodes.length === 0 && stepNodes.length === 0) {
        return;
      }

      // Skip if no nodes need positioning
      if (!stepNodesNeedPositioning && !labelNodesNeedPositioning) {
        return;
      }

      if (allReady) {
        const layoutFrameId = requestAnimationFrame(() => {
          // Adjust label positions first
          if (labelNodes.length > 0) {
            adjustLabelPositions();
          }

          // Position step nodes to avoid label collisions, then make them visible
          if (
            stepNodes.length > 0 &&
            computationStore.currentStep &&
            !stepNodeRepositionedRef.current
          ) {
            stepNodeRepositionedRef.current = true;

            // Find the first formula node
            const formulaNodes = getFormulaNodes(nodes);
            const formulaNode = formulaNodes[0];

            if (formulaNode) {
              setNodes((currentNodes) =>
                positionAndShowstepNodes(
                  currentNodes,
                  formulaNode,
                  (formulaNodeId) =>
                    reservedExtentsRef.current.get(formulaNodeId)?.top
                )
              );
            }
          }
        });

        return () => {
          cancelAnimationFrame(layoutFrameId);
        };
      }
    }, [nodes, nodesInitialized, adjustLabelPositions, setNodes]);

    const fitViewOptions = useMemo(
      () => ({
        padding: 0.2,
        minZoom: 0.5,
        maxZoom: 1.0,
      }),
      []
    );

    const defaultViewport = useMemo(() => ({ x: 0, y: 0, zoom: 1 }), []);

    const proOptions = useMemo(() => ({ hideAttribution: true }), []);

    return (
      <div ref={canvasContainerRef} className={`w-full h-full min-h-[500px] ${showGrips ? "show-grips" : ""}`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={defaultNodeTypes}
          fitView
          fitViewOptions={fitViewOptions}
          className="bg-white"
          defaultViewport={defaultViewport}
          minZoom={0.3}
          maxZoom={2}
          zoomOnScroll={false}
          panOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={false}
          panOnDrag={false}
          selectNodesOnDrag={false}
          preventScrolling={false}
          autoPanOnNodeDrag={false}
          proOptions={proOptions}
        >
          <CanvasControls showGrips={showGrips} onToggleGrips={toggleGrips} />
        </ReactFlow>
      </div>
    );
  }
);

// Main Canvas component with ReactFlowProvider
// Note: FormulizeContext.Provider should be provided by the parent component
const Canvas = observer((props: CanvasProps) => {
  return (
    <ReactFlowProvider>
      <CanvasFlow {...props} />
    </ReactFlowProvider>
  );
});

export type { CanvasProps };
export default Canvas;
