import React from "react";

import { LucideIcon } from "lucide-react";

import Tooltip from "./tooltip";

interface IconButtonProps {
  icon?: LucideIcon;
  svgIcon?: string;
  alt: string;
  onClick: () => void;
  title?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  strokeWidth?: number;
  isActive?: boolean;
  tooltipPosition?: "top" | "bottom" | "left" | "right";
}

const IconButton: React.FC<IconButtonProps> = ({
  icon: Icon,
  svgIcon,
  alt,
  onClick,
  title,
  className = "",
  size = "md",
  strokeWidth = 2,
  isActive = false,
  tooltipPosition = "left",
}) => {
  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-9 w-9",
  };

  const iconSizeClasses = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
    lg: "w-4 h-4",
  };

  const button = (
    <button
      onClick={onClick}
      className={`${isActive ? "bg-slate-900 border-slate-900" : "bg-white border-slate-200"} border ${sizeClasses[size]} rounded flex items-center justify-center shadow-sm hover:shadow-md ${isActive ? "hover:bg-slate-800" : "hover:bg-slate-50"} hover:scale-105 transition-all duration-100 ${className}`}
      aria-label={alt}
    >
      {Icon ? (
        <Icon
          className={`${iconSizeClasses[size]} ${isActive ? "text-white" : "text-slate-700 hover:text-slate-950"} transition-colors duration-100`}
          strokeWidth={strokeWidth}
        />
      ) : svgIcon ? (
        <img
          src={svgIcon}
          alt={alt}
          className={`${iconSizeClasses[size]} ${isActive ? "brightness-0 invert" : ""} transition-all duration-100`}
        />
      ) : null}
    </button>
  );

  if (title) {
    return (
      <Tooltip content={title} position={tooltipPosition}>
        {button}
      </Tooltip>
    );
  }

  return button;
};

export default IconButton;
