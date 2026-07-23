const GULU_ORIGIN = "http://121.43.105.7";

export function safeGuluCandidateUrl(
  value?: string | null,
  guluId?: string | null,
): string | null {
  if (!value && guluId) {
    const id = guluId.trim();
    return id
      ? `${GULU_ORIGIN}/crm#candidate/detail?id=${encodeURIComponent(id)}`
      : null;
  }
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "121.43.105.7" ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/crm"
    )
      return null;
    const route = url.hash.slice(1);
    const queryAt = route.indexOf("?");
    if (queryAt < 0 || route.slice(0, queryAt) !== "candidate/detail")
      return null;
    const id = new URLSearchParams(route.slice(queryAt + 1)).get("id")?.trim();
    return id
      ? `${GULU_ORIGIN}/crm#candidate/detail?id=${encodeURIComponent(id)}`
      : null;
  } catch {
    return null;
  }
}
