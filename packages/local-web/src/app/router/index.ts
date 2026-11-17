import { createRouter } from '@tanstack/react-router';
import { routeTree } from '@web/routeTree.gen';

// Route changes crossfade through the View Transitions API (no-op where
// unsupported); timing lives in web-core's styles.
export const router = createRouter({ routeTree, defaultViewTransition: true });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
