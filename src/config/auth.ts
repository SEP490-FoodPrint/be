import "./env";

export interface AuthConfig {
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  secureCookies: boolean;
  clientOrigin: string;
}

function seconds(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < 60 || result > maximum) {
    throw new Error("Thời hạn token không hợp lệ");
  }
  return result;
}

export function readAuthConfig(
  source: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const accessTtlSeconds = seconds(source.AUTH_ACCESS_TTL_SECONDS, 900, 3600);
  const refreshTtlSeconds = seconds(
    source.AUTH_REFRESH_TTL_SECONDS,
    604800,
    2592000,
  );
  if (refreshTtlSeconds <= accessTtlSeconds)
    throw new Error("Refresh token phải sống lâu hơn access token");
  const client = new URL(source.CLIENT_URL || "http://localhost:3001");
  if (
    !["http:", "https:"].includes(client.protocol) ||
    client.username ||
    client.password ||
    client.pathname !== "/" ||
    client.search ||
    client.hash
  ) {
    throw new Error("CLIENT_URL phải là một HTTP(S) origin");
  }
  return {
    accessTtlSeconds,
    refreshTtlSeconds,
    secureCookies: source.NODE_ENV === "production",
    clientOrigin: client.origin,
  };
}
