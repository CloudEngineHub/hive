/**
 * Shared routing constants.
 *
 * Kept in its own module (not in `pages/queen-routing.tsx`) so that
 * `pages/home.tsx` can reference the key without statically importing the
 * whole queen-routing page — which would defeat that page's lazy-loaded
 * route chunk and drag it back into the startup bundle.
 */

/** sessionStorage key holding the prompt the user typed on Home, handed
 *  off to the queen-routing page to classify on arrival. */
export const PENDING_CLASSIFY_KEY = "pendingClassifyMessage";
