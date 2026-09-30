import type { OrbitTool } from '../types'
import { getContext, notify } from './local'
import { forget, recall, remember } from './memory'
import { webFetch, webSearch } from './web'

export const builtinTools = [webSearch, webFetch, notify, getContext, remember, recall, forget] as unknown as OrbitTool[]
