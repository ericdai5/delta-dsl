interface ICanvasLoaderProps {
  active: boolean;
}

/**
 * A loading animation centered over the playground canvas. It fades in only
 * once loading has taken a moment, so quick rebuilds don't flicker, and fades
 * out when the canvas is ready.
 */
const CanvasLoader = ({ active }: ICanvasLoaderProps) => (
  <div
    role="status"
    aria-label="Loading"
    aria-hidden={!active}
    className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center transition-opacity ease-out ${
      active ? "opacity-100 delay-150 duration-200" : "opacity-0 duration-150"
    }`}
  >
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500" />
  </div>
);

export default CanvasLoader;
