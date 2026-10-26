import { useEffect, useRef, useState } from "react";

import { observer } from "mobx-react-lite";

import { useStore } from "../core/hooks";
import { Config } from "../index.ts";
import { debugStore } from "../store/debug";
import Canvas from "./canvas.tsx";
import DebugModal from "./interpreter";
import NodeVisibilitySidebar from "./node-visibility-sidebar";
import Toolbar from "./toolbar";
import TreeInspectorSidebar from "./tree-inspector-sidebar";
import VariablesSidebar from "./variables-sidebar";

/**
 * PlaygroundCanvas component that renders the canvas and debug tools.
 * Must be used within a Provider.
 */
const PlaygroundCanvas = observer(() => {
  const context = useStore();
  const [showNodeVisibilitySidebar, setShowNodeVisibilitySidebar] =
    useState<boolean>(false);
  const [showTreeInspectorSidebar, setShowTreeInspectorSidebar] =
    useState<boolean>(false);
  const [showVariablesSidebar, setShowVariablesSidebar] =
    useState<boolean>(false);
  const [showDebugModal, setShowDebugModal] = useState<boolean>(false);
  const [configKey, setConfigKey] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevConfigRef = useRef<Config | null>(null);
  const computationStore = context?.computationStore;
  const currentConfig = context?.config;

  // Update configKey when config changes to force re-render of Canvas
  useEffect(() => {
    if (currentConfig && currentConfig !== prevConfigRef.current) {
      prevConfigRef.current = currentConfig;
      setConfigKey((prev) => prev + 1);
    }
  }, [currentConfig]);

  // Check if step mode is available (for interpreter button)
  const isStepMode = computationStore?.isStepMode() ?? false;

  // Close debug modal when step mode is no longer available
  useEffect(() => {
    if (showDebugModal && !isStepMode) {
      setShowDebugModal(false);
    }
  }, [showDebugModal, isStepMode]);

  // Guard: context must be available
  if (!context || !computationStore) {
    return (
      <div className="formula-renderer overflow-hidden w-full h-full flex items-center justify-center">
        <div className="text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="formula-renderer overflow-hidden w-full h-full">
      <div className="flex flex-row w-full h-full">
        {/* Main content area */}
        <div className="flex-1 flex flex-col h-full relative min-w-0">
          <Toolbar
            onToggleNodeVisibility={() =>
              setShowNodeVisibilitySidebar((prev) => !prev)
            }
            onToggleTreeInspector={() =>
              setShowTreeInspectorSidebar((prev) => !prev)
            }
            onToggleVariables={() => setShowVariablesSidebar((prev) => !prev)}
            onToggleInterpreter={() => setShowDebugModal((prev) => !prev)}
            isNodeVisibilityOpen={showNodeVisibilitySidebar}
            isTreeInspectorOpen={showTreeInspectorSidebar}
            isVariablesOpen={showVariablesSidebar}
            isInterpreterOpen={showDebugModal}
            showInterpreterButton={isStepMode}
          />
          <div
            ref={containerRef}
            className="interactive-formula-container w-full h-full overflow-auto"
          >
            <div className="min-w-0 w-full h-full overflow-auto bg-slate-50 text-center">
              <Canvas
                key={configKey}
                controls={currentConfig?.controls}
                environment={computationStore.environment || undefined}
                computationStore={computationStore}
              />
            </div>
          </div>
        </div>
        {/* Node visibility sidebar */}
        <NodeVisibilitySidebar
          isOpen={showNodeVisibilitySidebar}
          onClose={() => setShowNodeVisibilitySidebar(false)}
          onToggleVariableBorders={() =>
            (debugStore.showVariableBorders = !debugStore.showVariableBorders)
          }
          onToggleFormulaNodeBorders={() =>
            (debugStore.showFormulaBorders = !debugStore.showFormulaBorders)
          }
          onToggleLabelNodeBorders={() =>
            (debugStore.showLabelBorders = !debugStore.showLabelBorders)
          }
          onToggleExpressionBorders={() =>
            (debugStore.showExpressionBorders =
              !debugStore.showExpressionBorders)
          }
          onToggleStepBorders={() =>
            (debugStore.showStepBorders = !debugStore.showStepBorders)
          }
          onToggleFormulaNodeShadow={() =>
            (debugStore.showFormulaShadow = !debugStore.showFormulaShadow)
          }
          onToggleLabelNodeShadow={() =>
            (debugStore.showLabelShadow = !debugStore.showLabelShadow)
          }
          onToggleVariableShadow={() =>
            (debugStore.showVariableShadow = !debugStore.showVariableShadow)
          }
          onToggleExpressionShadow={() =>
            (debugStore.showExpressionShadow = !debugStore.showExpressionShadow)
          }
          onToggleStepShadow={() =>
            (debugStore.showStepShadow = !debugStore.showStepShadow)
          }
          showFormulaBorders={debugStore.showFormulaBorders}
          showLabelBorders={debugStore.showLabelBorders}
          showVariableBorders={debugStore.showVariableBorders}
          showExpressionBorders={debugStore.showExpressionBorders}
          showStepBorders={debugStore.showStepBorders}
          showFormulaShadow={debugStore.showFormulaShadow}
          showLabelShadow={debugStore.showLabelShadow}
          showVariableShadow={debugStore.showVariableShadow}
          showExpressionShadow={debugStore.showExpressionShadow}
          showStepShadow={debugStore.showStepShadow}
        />
        {/* Latex tree inspector sidebar */}
        <TreeInspectorSidebar
          isOpen={showTreeInspectorSidebar}
          onClose={() => setShowTreeInspectorSidebar(false)}
          config={currentConfig ?? null}
        />
        {/* Variables store sidebar */}
        <VariablesSidebar
          isOpen={showVariablesSidebar}
          onClose={() => setShowVariablesSidebar(false)}
        />
        {/* Interpreter sidebar */}
        <DebugModal
          isOpen={showDebugModal}
          onClose={() => setShowDebugModal(false)}
        />
      </div>
    </div>
  );
});

export default PlaygroundCanvas;
