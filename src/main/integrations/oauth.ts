import { createServer, type Server } from 'node:http'
import { shell } from 'electron'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { deleteSecret, getSecret, setSecret } from '../secrets'

// OAuth for remote MCP servers: dynamic client registration + PKCE, with the
// browser redirecting back to a loopback port. Tokens are kept in the DPAPI store.

const PORT = 47813
const REDIRECT = `http://127.0.0.1:${PORT}/callback`

let server: Server | undefined
let pending: { state: string; resolve: (code: string) => void; reject: (e: Error) => void } | undefined

function page(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Orbit</title><body style="font:15px system-ui;padding:40px;background:#18181b;color:#e4e4e7">${message}</body>`
}

function ensureServer(): void {
  if (server) return
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', REDIRECT)
    if (url.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    const ok = !!code && !!pending && url.searchParams.get('state') === pending.state
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(page(ok ? 'Connected. You can close this tab and go back to Orbit.' : `Couldn't connect: ${error ?? 'unexpected response'}.`))
    if (!pending) return
    if (ok) pending.resolve(code!)
    else pending.reject(new Error(error ?? 'Authorization failed'))
    pending = undefined
  })
  server.listen(PORT, '127.0.0.1')
  server.on('error', (err) => console.error('[oauth] callback server error', err))
}

export class OrbitOAuthProvider implements OAuthClientProvider {
  private verifier = ''
  private stateValue = crypto.randomUUID()
  /** Resolves with the authorization code once the user approves in the browser. */
  codePromise: Promise<string> | undefined

  constructor(
    private id: string,
    private interactive: boolean
  ) {}

  get redirectUrl(): string {
    return REDIRECT
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Orbit',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }

  state(): string {
    return this.stateValue
  }

  private read<T>(key: string): T | undefined {
    const v = getSecret(`mcp.${this.id}.${key}`)
    return v ? (JSON.parse(v) as T) : undefined
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.read('client')
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    setSecret(`mcp.${this.id}.client`, JSON.stringify(info))
  }

  tokens(): OAuthTokens | undefined {
    return this.read('tokens')
  }

  saveTokens(tokens: OAuthTokens): void {
    setSecret(`mcp.${this.id}.tokens`, JSON.stringify(tokens))
  }

  saveCodeVerifier(v: string): void {
    this.verifier = v
  }

  codeVerifier(): string {
    return this.verifier
  }

  redirectToAuthorization(url: URL): void {
    // At startup we only note that sign-in is needed; the browser opens when the user clicks Connect.
    if (!this.interactive) return
    ensureServer()
    pending?.reject(new Error('Superseded by a new sign-in'))
    this.codePromise = new Promise<string>((resolve, reject) => {
      pending = { state: this.stateValue, resolve, reject }
      setTimeout(() => reject(new Error('Sign-in timed out')), 5 * 60_000)
    })
    void shell.openExternal(url.toString())
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all' || scope === 'client') deleteSecret(`mcp.${this.id}.client`)
    if (scope === 'all' || scope === 'tokens') deleteSecret(`mcp.${this.id}.tokens`)
  }
}

export function forgetOAuth(id: string): void {
  deleteSecret(`mcp.${id}.client`)
  deleteSecret(`mcp.${id}.tokens`)
}
