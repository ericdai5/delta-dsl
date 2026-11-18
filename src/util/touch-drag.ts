/**
 * Lets a finger drag what the mouse can drag.
 *
 * Delta's drags are written for the mouse: a mousedown on an element starts
 * one, and mousemove and mouseup on the document carry it on. A finger sends
 * none of those while it moves, so each touch that starts on the element is
 * replayed here as that same sequence of mouse events.
 */

type TouchDragElement = HTMLElement | SVGElement;

interface TouchDragOptions {
  // Decides, as a touch starts, whether it drags. Other touches are left to
  // the browser, so they can still scroll the page. Without this, every
  // touch on the element drags.
  when?: (touch: Touch) => boolean;
}

// Elements already set up, with the function that undoes each
const enabledElements = new WeakMap<TouchDragElement, () => void>();

const sendMouseEvent = (type: string, touch: Touch, target: EventTarget) => {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: touch.clientX,
      clientY: touch.clientY,
      screenX: touch.screenX,
      screenY: touch.screenY,
      button: 0,
      buttons: type === "mouseup" ? 0 : 1,
    })
  );
};

/**
 * Replay touches that start on the element as mouse events.
 * @returns A function that turns this off again
 */
export const enableTouchDrag = (
  element: TouchDragElement,
  { when }: TouchDragOptions = {}
): (() => void) => {
  const enabled = enabledElements.get(element);
  if (enabled) return enabled;

  // The finger that is dragging, so a second finger doesn't join in
  let activeTouchId: number | null = null;

  const handleTouchStart = (event: TouchEvent) => {
    if (activeTouchId !== null) return;
    const touch = event.changedTouches[0];
    const target = event.target;
    if (!touch || !target) return;
    if (when && !when(touch)) return;
    activeTouchId = touch.identifier;

    // Keep the browser from scrolling with this touch, and from sending its
    // own mouse events once the finger lifts
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();

    const findTouch = (e: TouchEvent) =>
      Array.from(e.changedTouches).find((t) => t.identifier === activeTouchId);

    const handleTouchMove = (e: TouchEvent) => {
      const moved = findTouch(e);
      if (!moved) return;
      if (e.cancelable) e.preventDefault();
      sendMouseEvent("mousemove", moved, document);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const lifted = findTouch(e);
      if (!lifted) return;
      target.removeEventListener("touchmove", handleTouchMove as EventListener);
      target.removeEventListener("touchend", handleTouchEnd as EventListener);
      target.removeEventListener(
        "touchcancel",
        handleTouchEnd as EventListener
      );
      activeTouchId = null;
      sendMouseEvent("mouseup", lifted, document);
    };

    // A touch keeps reporting to the element it started on, even after a
    // re-render takes that element off the page, so the listeners go there
    target.addEventListener("touchmove", handleTouchMove as EventListener, {
      passive: false,
    });
    target.addEventListener("touchend", handleTouchEnd as EventListener);
    target.addEventListener("touchcancel", handleTouchEnd as EventListener);

    sendMouseEvent("mousedown", touch, target);
  };

  // Where every touch drags, tell the browser up front not to scroll with one
  const previousTouchAction = element.style.touchAction;
  if (!when) element.style.touchAction = "none";
  element.addEventListener("touchstart", handleTouchStart as EventListener, {
    passive: false,
  });

  const disable = () => {
    element.removeEventListener(
      "touchstart",
      handleTouchStart as EventListener
    );
    element.style.touchAction = previousTouchAction;
    enabledElements.delete(element);
  };
  enabledElements.set(element, disable);
  return disable;
};
