import type { OrbitTool } from '../types'
import { getContext, notify } from './local'
import { webFetch, webSearch } from './web'

export const builtinTools = [webSearch, webFetch, notify, getContext] as unknown as OrbitTool[]
