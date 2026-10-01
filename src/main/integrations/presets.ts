import type { ServerConfig } from './config'

// Ready-made connections. Checked against each project's docs on 2026-09-30.

export type PresetField = {
  /** Name in the DPAPI secret store. */
  secret: string
  label: string
  placeholder?: string
  help?: string
}

export type Preset = {
  id: string
  name: string
  description: string
  /** Shown before connecting. Plain steps, in order. */
  steps: string[]
  fields: PresetField[]
  config: ServerConfig
}

/**
 * Hosted MCP servers you connect by signing in, with no app of your own to set up: each one lets
 * Orbit register itself (OAuth dynamic client registration). Checked on 2026-10-01 by probing each
 * URL. GitHub, Asana and Box don't allow that yet, so they aren't listed.
 */
const ONE_CLICK: { id: string; name: string; url: string; description: string }[] = [
  { id: 'linear', name: 'Linear', url: 'https://mcp.linear.app/mcp', description: 'Find, create and update issues, projects and comments.' },
  { id: 'atlassian', name: 'Jira & Confluence', url: 'https://mcp.atlassian.com/v1/mcp', description: 'Search and update Jira issues and Confluence pages.' },
  { id: 'todoist', name: 'Todoist', url: 'https://ai.todoist.net/mcp', description: 'Read and add tasks and projects.' },
  { id: 'clickup', name: 'ClickUp', url: 'https://mcp.clickup.com/mcp', description: 'Tasks, docs and comments in your workspace.' },
  { id: 'monday', name: 'monday.com', url: 'https://mcp.monday.com/mcp', description: 'Boards, items and updates.' },
  { id: 'airtable', name: 'Airtable', url: 'https://mcp.airtable.com/mcp', description: 'Read and edit bases, tables and records.' },
  { id: 'figma', name: 'Figma', url: 'https://mcp.figma.com/mcp', description: 'Read designs, components and comments.' },
  { id: 'canva', name: 'Canva', url: 'https://mcp.canva.com/mcp', description: 'Find and create designs.' },
  { id: 'webflow', name: 'Webflow', url: 'https://mcp.webflow.com/mcp', description: 'Sites, pages and CMS collections.' },
  { id: 'intercom', name: 'Intercom', url: 'https://mcp.intercom.com/mcp', description: 'Search conversations and contacts.' },
  { id: 'sentry', name: 'Sentry', url: 'https://mcp.sentry.dev/mcp', description: 'Look into errors, issues and releases.' },
  { id: 'vercel', name: 'Vercel', url: 'https://mcp.vercel.com', description: 'Projects, deployments and their logs.' },
  { id: 'netlify', name: 'Netlify', url: 'https://netlify-mcp.netlify.app/mcp', description: 'Sites, deploys and settings.' },
  { id: 'supabase', name: 'Supabase', url: 'https://mcp.supabase.com/mcp', description: 'Projects, tables and SQL.' },
  { id: 'cloudflare', name: 'Cloudflare', url: 'https://bindings.mcp.cloudflare.com/mcp', description: 'Workers, KV, R2 and D1 in your account.' },
  { id: 'stripe', name: 'Stripe', url: 'https://mcp.stripe.com', description: 'Customers, payments, invoices and products.' },
  { id: 'paypal', name: 'PayPal', url: 'https://mcp.paypal.com/mcp', description: 'Invoices, orders and transactions.' },
  { id: 'square', name: 'Square', url: 'https://mcp.squareup.com/mcp', description: 'Payments, orders, catalog and customers.' },
  { id: 'zapier', name: 'Zapier', url: 'https://mcp.zapier.com/api/mcp/mcp', description: 'Run the actions you set up in Zapier, across thousands of apps.' },
  { id: 'huggingface', name: 'Hugging Face', url: 'https://huggingface.co/mcp', description: 'Search models, datasets, papers and Spaces. No sign-in needed.' }
]

export const PRESETS: Preset[] = [
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search, read and create pages and databases in your workspace.',
    steps: ['Click Connect. Notion opens in your browser.', 'Pick the pages Orbit can see and approve.'],
    fields: [],
    config: { type: 'http', name: 'Notion', url: 'https://mcp.notion.com/mcp', enabled: true, secretHeaders: {} }
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read channels, threads and unreads, and search messages. Posting is off unless you turn it on.',
    steps: [
      'Go to api.slack.com/apps and click "Create New App", then "From a manifest".',
      'Pick your workspace and paste the manifest from github.com/korotovsky/slack-mcp-server (docs, authentication setup).',
      'Install the app to your workspace. Your admin may need to approve it.',
      'Open "OAuth & Permissions" and copy the User OAuth Token (starts with xoxp-).'
    ],
    fields: [{ secret: 'slack', label: 'User OAuth Token', placeholder: 'xoxp-...' }],
    config: {
      type: 'stdio',
      name: 'Slack',
      command: 'npx',
      args: ['-y', 'slack-mcp-server@latest', '--transport', 'stdio'],
      env: {},
      secretEnv: { SLACK_MCP_XOXP_TOKEN: 'slack' },
      enabled: true
    }
  },
  {
    id: 'google',
    name: 'Gmail & Calendar',
    description: 'Search and send email, read and manage calendar events.',
    steps: [
      'Open console.cloud.google.com and create a project (any name).',
      'Under "APIs & Services", enable the Gmail API and the Google Calendar API.',
      'Set up the OAuth consent screen as "External", in testing mode, and add your own Google address as a test user.',
      'Under Credentials, create an OAuth client ID of type "Desktop app" and copy its client ID and secret here.',
      'The first time Orbit uses Gmail or Calendar, Google asks you to sign in once in your browser.'
    ],
    fields: [
      { secret: 'google.client_id', label: 'OAuth client ID', placeholder: '1234-abc.apps.googleusercontent.com' },
      { secret: 'google.client_secret', label: 'OAuth client secret', placeholder: 'GOCSPX-...' }
    ],
    config: {
      type: 'stdio',
      name: 'Gmail & Calendar',
      command: 'uvx',
      args: ['workspace-mcp', '--tools', 'gmail', 'calendar', '--tool-tier', 'core'],
      env: {},
      secretEnv: { GOOGLE_OAUTH_CLIENT_ID: 'google.client_id', GOOGLE_OAUTH_CLIENT_SECRET: 'google.client_secret' },
      enabled: true
    }
  }
]

for (const c of ONE_CLICK) {
  PRESETS.push({
    id: c.id,
    name: c.name,
    description: c.description,
    steps: c.id === 'huggingface' ? ['Click Connect. That\'s it: public search needs no account.'] : [`Click Connect. ${c.name} opens in your browser.`, 'Sign in and approve Orbit.'],
    fields: [],
    config: { type: 'http', name: c.name, url: c.url, enabled: true, secretHeaders: {} }
  })
}
