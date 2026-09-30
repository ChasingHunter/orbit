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
