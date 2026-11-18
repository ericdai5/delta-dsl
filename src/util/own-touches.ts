/**
 * Keeps an element's touches to itself.
 *
 * On a canvas that pans with a finger, a touch that starts on a slider or a
 * 3D plot would move the canvas as well as the control. Stopping the touch
 * at the element, before it reaches the canvas, leaves it to the control.
 */

const stopTouch = (event: TouchEvent) => event.stopPropagation();

/**
 * Stop touches that start on the element from reaching its ancestors.
 * Safe to call again with the same element, and usable as a React ref.
 */
export const ownTouches = (element: HTMLElement | null) => {
  element?.addEventListener("touchstart", stopTouch, { passive: true });
};
