import { createContext, useContext } from 'react'

export const GlassContext = createContext(true)
export const SurfaceContext = createContext(false)
export function useLiquidGlassEnabled() { return useContext(GlassContext) }
