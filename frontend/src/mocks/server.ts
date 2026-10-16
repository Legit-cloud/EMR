import { setupServer } from "msw/node";

import { handlers } from "./handlers";

/** Mock server for Vitest (Node). */
export const server = setupServer(...handlers);
