import { observer } from "mobx-react-lite";

import { debugStore } from "../../store/debug";
import { buildDebugStyles } from "../../util/debug-styles";
import { formatInlineLatex, toLatexText } from "../../util/latex-inline";
import LatexLabel from "../latex";

export interface StepNodeData {
  description: string;
}

interface IStepNodeProps {
  data: StepNodeData;
  // From React Flow: whether the node can be dragged right now
  draggable?: boolean;
}

function formatDescriptionLatex(description: string): string {
  // Descriptions may contain mixed text + "$$...$$" math fragments.
  return formatInlineLatex(description) ?? toLatexText(description);
}

const StepNode = observer(({ data, draggable }: IStepNodeProps) => {
  const { description } = data;
  const latexDescription = formatDescriptionLatex(description);

  // Build debug styles from store settings
  const debugStyles = buildDebugStyles(
    debugStore.showStepBorders,
    debugStore.showStepShadow
  );

  return (
    <div
      className="view-flow-node text-base text-black font-regular text-center"
      style={{
        pointerEvents: "auto",
        width: "auto",
        height: "auto",
        position: "relative",
        cursor: draggable ? "grab" : "default",
        ...debugStyles,
      }}
      title="Step description"
    >
      <LatexLabel latex={latexDescription} />
    </div>
  );
});

export default StepNode;
