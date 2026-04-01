/**
 * @file renderer/src/window.d.ts
 * @description TypeScript global types for the window.api preload bridge.
 * This re-exports the Api type from the preload script so the renderer has
 * full IntelliSense on every API call.
 */

import type { Api } from '../../preload/index'

declare global {
  interface Window {
    api: Api
  }
}
