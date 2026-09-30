import dailyTechDigest from './templates/daily-tech-digest.yaml?raw'
import { parseWorkflow } from './store'

// Ready-made workflows the user can add from the dashboard or by asking.

export type Template = { id: string; title: string; summary: string; needs: string[]; yaml: string }

export const TEMPLATES: Template[] = [
  {
    id: 'daily-tech-digest',
    title: 'Daily tech digest',
    summary: 'Every morning at 8:30: big tech, AI, startups and the best new products, from Hacker News, Google News, TechCrunch and Product Hunt. Saved to files/digests.',
    needs: [],
    yaml: dailyTechDigest
  }
]

// Fail at startup, not at click time, if a bundled template is broken.
for (const t of TEMPLATES) parseWorkflow(t.yaml)
