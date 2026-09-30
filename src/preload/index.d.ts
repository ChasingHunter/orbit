import type { OrbitApi } from '../shared/types'
import type { DashApi } from '../shared/dash'

declare global {
  interface Window {
    orbit: OrbitApi & { dash: DashApi }
  }
}
