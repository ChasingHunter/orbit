import type { OrbitTool } from '../types'
import { getContext, notify } from './local'
import { spawnAgents, startBackgroundTask } from './agents'
import { listIntegrations } from './integrations'
import { forget, recall, remember } from './memory'
import { cancelReminder, listReminders, setReminder } from './reminders'
import { createWorkflow, deleteWorkflow, listWorkflows, runWorkflow } from './workflows'
import { webFetch, webSearch } from './web'

export const builtinTools = [webSearch, webFetch, notify, getContext, remember, recall, forget, listIntegrations, startBackgroundTask, spawnAgents, setReminder, listReminders, cancelReminder, createWorkflow, listWorkflows, runWorkflow, deleteWorkflow] as unknown as OrbitTool[]
