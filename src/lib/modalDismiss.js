// =============================================================================
// One rule for dismissing a modal by its backdrop.
//
// Nicholas, 2026-09-05, on the Send Proposal for Signature dialog: "when I
// click in and I highlight, and then when I click up, the dialog disappears...
// if I click just in it and then I use my keyboard to delete the existing text,
// it's fine."
//
// That is the classic overlay bug, and it was on FIFTEEN modals. A backdrop
// that closes on `onClick` closes on any click the browser RESOLVES to it — and
// a click resolves to the nearest common ancestor of where the mouse went down
// and where it came up. Drag-select text inside a field, release past the edge
// of the card, and that ancestor is the backdrop. The dialog vanishes and takes
// what you typed with it. `e.stopPropagation()` on the card does not help,
// because the click never fires on the card at all.
//
// The rule here is strict on purpose: the press AND the release must both
// happen on the backdrop itself. So
//   - a drag that starts in a field and ends on the backdrop does nothing;
//   - a press on the backdrop that ends inside the card does nothing either
//     (releasing over content is not a dismissal);
//   - only a deliberate click on the empty area closes.
//
// Never hand-roll `onClick={onClose}` on a backdrop again —
// scripts/modal-dismiss-fixture.mjs fails the build if one comes back.
// =============================================================================

const ARMED = 'leapBackdropPress'

/**
 * Props to spread onto a modal's backdrop element.
 *
 * @param {Function} onClose      called when the backdrop is genuinely clicked
 * @param {object}   [opts]
 * @param {boolean}  [opts.disabled]  true while the modal must not be dismissed
 *                                    (mid-save, for instance) — returns no
 *                                    handlers at all rather than a no-op, so a
 *                                    disabled backdrop cannot arm and then fire
 *                                    after the save finishes.
 */
export function backdropDismissProps(onClose, opts = {}) {
  if (opts.disabled || typeof onClose !== 'function') return {}
  return {
    onMouseDown(e) {
      if (e.target === e.currentTarget) e.currentTarget.dataset[ARMED] = '1'
      else delete e.currentTarget.dataset[ARMED]
    },
    onMouseUp(e) {
      const armed = e.currentTarget.dataset[ARMED] === '1'
      delete e.currentTarget.dataset[ARMED]
      if (armed && e.target === e.currentTarget) onClose()
    },
  }
}

/**
 * The same decision as a pure function, so it can be tested without a DOM and
 * so the fixture pins the behaviour rather than the wiring.
 *
 * @param {boolean} pressOnBackdrop    did the mouse go DOWN on the backdrop
 * @param {boolean} releaseOnBackdrop  did it come UP on the backdrop
 */
export function shouldDismissOnBackdrop(pressOnBackdrop, releaseOnBackdrop) {
  return pressOnBackdrop === true && releaseOnBackdrop === true
}
