/**
 * FRP Proxy configuration types
 * Based on: https://gofrp.org/zh-cn/docs/reference/proxy-config/
 */

/** Proxy type */
export type ProxyType = 'tcp' | 'udp' | 'http' | 'https' | 'tcpmux' | 'stcp' | 'xtcp' | 'sudp'

/** Load balancer strategy */
export type LoadBalancerStrategy = 'random' | 'round_robin'

/** Base proxy configuration */
export interface BaseProxyConfig {
  /** Proxy name (unique) */
  name: string
  /** Proxy type */
  type: ProxyType
  /** Local IP to bind */
  localIP?: string
  /** Local port */
  localPort?: number
  /** Additional metadata */
  annotations?: Record<string, string>
  /** Custom metadata passed to server plugins */
  metadatas?: Record<string, string>
  /** Load balancer settings */
  loadBalancer?: {
    /** Load balancing strategy */
    strategy?: LoadBalancerStrategy
    /** Health check configuration */
    healthCheck?: {
      /** Health check type */
      type?: 'tcp' | 'http'
      /** Health check timeout (seconds) */
      timeoutSeconds?: number
      /** Max failed checks before marking unhealthy */
      maxFailed?: number
      /** Check interval (seconds) */
      intervalSeconds?: number
      /** HTTP health check path */
      path?: string
    }
  }
  /** Enable bandwidth limit */
  transport?: {
    /** Bandwidth limit (KB/s) */
    bandwidthLimit?: string
    /** Bandwidth limit mode */
    bandwidthLimitMode?: 'client' | 'server'
  }
}

/** TCP proxy configuration */
export interface TCPProxyConfig extends BaseProxyConfig {
  type: 'tcp'
  /** Remote port on server */
  remotePort?: number
}

/** UDP proxy configuration */
export interface UDPProxyConfig extends BaseProxyConfig {
  type: 'udp'
  /** Remote port on server */
  remotePort?: number
}

/** HTTP proxy configuration */
export interface HTTPProxyConfig extends BaseProxyConfig {
  type: 'http'
  /** Custom domain names */
  customDomains?: string[]
  /** Subdomain under server's subdomain_host */
  subdomain?: string
  /** Locations to proxy */
  locations?: string[]
  /** Host header rewrite */
  hostHeaderRewrite?: string
  /** HTTP username for basic auth */
  httpUser?: string
  /** HTTP password for basic auth */
  httpPassword?: string
  /** Request headers to set */
  requestHeaders?: {
    set?: Record<string, string>
  }
  /** Response headers to set */
  responseHeaders?: {
    set?: Record<string, string>
  }
  /** Route by HTTP user */
  routeByHTTPUser?: string
}

/** HTTPS proxy configuration */
export interface HTTPSProxyConfig extends BaseProxyConfig {
  type: 'https'
  /** Custom domain names */
  customDomains?: string[]
  /** Subdomain under server's subdomain_host */
  subdomain?: string
}

/** TCPMUX proxy configuration */
export interface TCPMUXProxyConfig extends BaseProxyConfig {
  type: 'tcpmux'
  /** Multiplexer type */
  multiplexer?: 'httpconnect'
  /** Custom domain names */
  customDomains?: string[]
  /** Subdomain under server's subdomain_host */
  subdomain?: string
  /** Route by HTTP user */
  routeByHTTPUser?: string
  /** HTTP username */
  httpUser?: string
  /** HTTP password */
  httpPassword?: string
}

/** STCP proxy configuration */
export interface STCPProxyConfig extends BaseProxyConfig {
  type: 'stcp'
  /** Secret key shared with visitor */
  secretKey?: string
  /** Allowed visitor users */
  allowUsers?: string[]
}

/** XTCP proxy configuration */
export interface XTCPProxyConfig extends BaseProxyConfig {
  type: 'xtcp'
  /** Secret key shared with visitor */
  secretKey?: string
  /** Allowed visitor users */
  allowUsers?: string[]
}

/** SUDP proxy configuration */
export interface SUDPProxyConfig extends BaseProxyConfig {
  type: 'sudp'
  /** Secret key shared with visitor */
  secretKey?: string
  /** Allowed visitor users */
  allowUsers?: string[]
}

/** Union type of all proxy configurations */
export type ProxyConfig =
  | TCPProxyConfig
  | UDPProxyConfig
  | HTTPProxyConfig
  | HTTPSProxyConfig
  | TCPMUXProxyConfig
  | STCPProxyConfig
  | XTCPProxyConfig
  | SUDPProxyConfig

/** Visitor type */
export type VisitorType = 'stcp' | 'xtcp' | 'sudp'

/** Base visitor configuration */
export interface BaseVisitorConfig {
  /** Visitor name (unique) */
  name: string
  /** Visitor type */
  type: VisitorType
  /** Server name to connect to */
  serverName: string
  /** Secret key shared with proxy */
  secretKey?: string
  /** Local IP to bind */
  bindAddr?: string
  /** Local port to bind */
  bindPort?: number
}

/** STCP visitor configuration */
export interface STCPVisitorConfig extends BaseVisitorConfig {
  type: 'stcp'
}

/** XTCP visitor configuration */
export interface XTCPVisitorConfig extends BaseVisitorConfig {
  type: 'xtcp'
  /** Keep tunnel alive even when no connection */
  keepTunnelOpen?: boolean
  /** Max retries for establishing connection */
  maxRetriesAnHour?: number
  /** Min retry interval (seconds) */
  minRetryInterval?: number
  /** Fallback to STCP when XTCP fails */
  fallbackTo?: string
  /** Fallback timeout (seconds) */
  fallbackTimeoutMs?: number
}

/** SUDP visitor configuration */
export interface SUDPVisitorConfig extends BaseVisitorConfig {
  type: 'sudp'
}

/** Union type of all visitor configurations */
export type VisitorConfig = STCPVisitorConfig | XTCPVisitorConfig | SUDPVisitorConfig
