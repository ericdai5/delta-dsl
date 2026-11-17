import React from "react";

import { observer } from "mobx-react-lite";

import { useStore } from "../../core/hooks";
import LatexLabel from "../../internal/latex";
import { type AxisLabelInfo } from "./axes";

interface AxisLabelsProps {
  labelInfo: AxisLabelInfo;
  xAxisHovered?: boolean;
  yAxisHovered?: boolean;
}

// A hovered label grows through --var-scale (see index.css), not by
// animating transform, which would blur the canvas's math in Safari
const hoverScale = (hovered: boolean) =>
  ({ "--var-scale": hovered ? 1.08 : 1 }) as React.CSSProperties;
const HOVER_TRANSITION = "--var-scale 0.2s ease, color 0.2s ease";

export const AxisLabels: React.FC<AxisLabelsProps> = observer(
  ({ labelInfo, xAxisHovered = false, yAxisHovered = false }) => {
    const context = useStore();
    const computationStore = context?.computationStore;

    if (!computationStore) {
      return null;
    }
    // Use the labelFontSize for axis labels
    const fontSize = computationStore.environment?.labelFontSize ?? 1.5;

    const handleXLabelMouseEnter = () => {
      if (labelInfo.xLabel?.xAxis) {
        computationStore.setVariableHover(labelInfo.xLabel.xAxis, true);
      }
      labelInfo.xLabel?.allXVariables.forEach((varId) => {
        computationStore.setVariableHover(varId, true);
      });
    };

    const handleXLabelMouseLeave = () => {
      if (labelInfo.xLabel?.xAxis) {
        computationStore.setVariableHover(labelInfo.xLabel.xAxis, false);
      }
      labelInfo.xLabel?.allXVariables.forEach((varId) => {
        computationStore.setVariableHover(varId, false);
      });
    };

    const handleYLabelMouseEnter = () => {
      if (labelInfo.yLabel?.yAxis) {
        computationStore.setVariableHover(labelInfo.yLabel.yAxis, true);
      }
      labelInfo.yLabel?.allYVariables.forEach((varId) => {
        computationStore.setVariableHover(varId, true);
      });
    };

    const handleYLabelMouseLeave = () => {
      if (labelInfo.yLabel?.yAxis) {
        computationStore.setVariableHover(labelInfo.yLabel.yAxis, false);
      }
      labelInfo.yLabel?.allYVariables.forEach((varId) => {
        computationStore.setVariableHover(varId, false);
      });
    };

    return (
      <>
        {labelInfo.xLabel && (
          <div
            style={{
              position: "absolute",
              left: `${labelInfo.xLabel.x}px`,
              top: `${labelInfo.xLabel.y}px`,
              ...hoverScale(xAxisHovered),
              transform: "translate(-50%, -50%) scale(var(--var-scale, 1))",
              cursor: "pointer",
              padding: "4px",
              color: xAxisHovered ? "#2563eb" : "#111827",
              transition: HOVER_TRANSITION,
              transformOrigin: "center center",
            }}
            onMouseEnter={handleXLabelMouseEnter}
            onMouseLeave={handleXLabelMouseLeave}
          >
            <LatexLabel latex={labelInfo.xLabel.text} fontSize={fontSize} />
          </div>
        )}
        {labelInfo.yLabel && (
          <div
            style={{
              position: "absolute",
              left: `${labelInfo.yLabel.x}px`,
              top: `${labelInfo.yLabel.y}px`,
              ...hoverScale(yAxisHovered),
              transform: `translate(-50%, -50%) rotate(${labelInfo.yLabel.rotation}deg) scale(var(--var-scale, 1))`,
              cursor: "pointer",
              padding: "4px",
              color: yAxisHovered ? "#2563eb" : "#111827",
              transition: HOVER_TRANSITION,
              transformOrigin: "center center",
            }}
            onMouseEnter={handleYLabelMouseEnter}
            onMouseLeave={handleYLabelMouseLeave}
          >
            <LatexLabel latex={labelInfo.yLabel.text} fontSize={fontSize} />
          </div>
        )}
      </>
    );
  }
);

AxisLabels.displayName = "AxisLabels";
