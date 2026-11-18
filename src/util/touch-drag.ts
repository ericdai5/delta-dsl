/**
 * Lets a finger drag what the mouse can drag.
 *
 * Delta's drags are written for the mouse: a mousedown on an element starts
 * one, and mousemove and mouseup on the document carry it on. A finger sends
 * none of those while it moves, so each touch that starts on the element is
 * replayed here as that same sequence of mouse events.
 *
 * A drag is one finger. Two fingers are a pinch, which belongs to the page
 * or to a canvas that zooms, so a second finger never drags and takes the
 * drag away from the first.
 */

type TouchDragElement = HTMLElement | SVGElement;

interface TouchDragOptions {
  // Decides, as a touch starts, whether it drags. Other touches are left to
  // the browser, so they can still scroll the page. Without this, every
  // touch on the element drags.
  when?: (touch: Touch) => boolean;
}

// Where a touch is, kept apart from the Touch itself, which a browser may
// change as the finger moves
interface TouchPoint {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
}

// How far a finger moves before its drag begins. A pinch's second finger
// lands within this, so the first finger hasn't dragged anything by then.
const DRAG_START_DISTANCE = 6;

// Elements already set up, with the function that undoes each
const enabledElements = new WeakMap<TouchDragElement, () => void>();

const sendMouseEvent = (
  type: string,
  point: TouchPoint,
  target: EventTarget
) => {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: point.clientX,
      clientY: point.clientY,
      screenX: point.screenX,
      screenY: point.screenY,
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
    // With a finger already down, this one is the second of a pinch
    if (event.touches.length > 1) return;
    const touch = event.changedTouches[0];
    const target = event.target;
    if (!touch || !target) return;
    if (when && !when(touch)) return;
    activeTouchId = touch.identifier;

    // Keep the browser from scrolling with this touch, and from sending its
    // own mouse events once the finger lifts
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();

    const start: TouchPoint = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      screenX: touch.screenX,
      screenY: touch.screenY,
    };
    // Whether the mouse press has been sent, and whether a second finger
    // has since taken the drag away
    let pressed = false;
    let givenUp = false;

    const press = () => {
      pressed = true;
      sendMouseEvent("mousedown", start, target);
    };

    const findTouch = (e: TouchEvent) =>
      Array.from(e.changedTouches).find((t) => t.identifier === activeTouchId);

    const stopListening = () => {
      target.removeEventListener("touchmove", handleTouchMove as EventListener);
      target.removeEventListener("touchend", handleTouchEnd as EventListener);
      target.removeEventListener(
        "touchcancel",
        handleTouchEnd as EventListener
      );
      document.removeEventListener(
        "touchstart",
        handleSecondFinger as EventListener,
        true
      );
      activeTouchId = null;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const moved = findTouch(e);
      if (!moved || givenUp) return;
      if (e.cancelable) e.preventDefault();
      if (!pressed) {
        const distance = Math.hypot(
          moved.clientX - start.clientX,
          moved.clientY - start.clientY
        );
        if (distance < DRAG_START_DISTANCE) return;
        press();
      }
      sendMouseEvent("mousemove", moved, document);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const lifted = findTouch(e);
      if (!lifted) return;
      stopListening();
      if (givenUp) {
        sendMouseEvent("mouseup", start, document);
        return;
      }
      if (!pressed) {
        // A touch the browser took back before it dragged is nothing
        if (e.type === "touchcancel") return;
        // A finger that never moved is a tap: a press and release in place
        press();
      }
      sendMouseEvent("mouseup", lifted, document);
    };

    // A second finger anywhere makes this a pinch. A drag that hasn't begun
    // is dropped. One that has is put back where it started, by moving the
    // mouse back there, and released when its finger lifts: releasing now
    // could redraw the element under the fingers, which would cut the pinch
    // off from a canvas listening above it.
    const handleSecondFinger = () => {
      if (!pressed) {
        stopListening();
        return;
      }
      if (givenUp) return;
      givenUp = true;
      sendMouseEvent("mousemove", start, document);
    };

    // A touch keeps reporting to the element it started on, even after a
    // re-render takes that element off the page, so the listeners go there
    target.addEventListener("touchmove", handleTouchMove as EventListener, {
      passive: false,
    });
    target.addEventListener("touchend", handleTouchEnd as EventListener);
    target.addEventListener("touchcancel", handleTouchEnd as EventListener);
    document.addEventListener(
      "touchstart",
      handleSecondFinger as EventListener,
      true
    );
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
