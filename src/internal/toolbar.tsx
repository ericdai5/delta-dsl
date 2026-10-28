import { Braces, Footprints, ListTree, SquareStack } from "lucide-react";

import IconButton from "../ui/icon-button";

interface ToolbarProps {
  onToggleNodeVisibility: () => void;
  onToggleTreeInspector: () => void;
  onToggleInterpreter: () => void;
  onToggleVariables: () => void;
  isNodeVisibilityOpen?: boolean;
  isTreeInspectorOpen?: boolean;
  isInterpreterOpen?: boolean;
  isVariablesOpen?: boolean;
  showInterpreterButton?: boolean;
}

const Toolbar = ({
  onToggleNodeVisibility,
  onToggleTreeInspector,
  onToggleInterpreter,
  onToggleVariables,
  isNodeVisibilityOpen = false,
  isTreeInspectorOpen = false,
  isInterpreterOpen = false,
  isVariablesOpen = false,
  showInterpreterButton = false,
}: ToolbarProps) => {
  // Every button opens a debugging view, so the toolbar stays in local
  // development only.
  if (!import.meta.env.DEV) return null;

  return (
    <div className="absolute right-4 top-4 z-20 flex flex-col gap-2">
      <IconButton
        size="lg"
        icon={SquareStack}
        alt="Node Visibility"
        onClick={onToggleNodeVisibility}
        title="Node Visibility"
        isActive={isNodeVisibilityOpen}
      />
      <IconButton
        size="lg"
        icon={ListTree}
        alt="Latex Tree"
        onClick={onToggleTreeInspector}
        title="Latex Tree"
        isActive={isTreeInspectorOpen}
      />
      <IconButton
        size="lg"
        icon={Braces}
        alt="Variable Editor"
        onClick={onToggleVariables}
        title="Variable Editor"
        isActive={isVariablesOpen}
      />
      {showInterpreterButton && (
        <IconButton
          size="lg"
          icon={Footprints}
          alt="Interpreter"
          onClick={onToggleInterpreter}
          title="Interpreter"
          isActive={isInterpreterOpen}
        />
      )}
    </div>
  );
};

export default Toolbar;
