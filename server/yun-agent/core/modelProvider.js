// Re-export of the single model-provider adapter so the yun-agent core and
// MOSS share one implementation without MOSS being modified.

export { createModelProvider } from '../../agent/modelProvider.js'
