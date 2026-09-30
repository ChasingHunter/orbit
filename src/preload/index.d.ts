import type { OrbitApi } from '../shared/types'

declare global {
  interface Window {
    orbit: OrbitApi
  }
}
