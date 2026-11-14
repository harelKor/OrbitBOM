// Only same-site paths are allowed as a post-login destination. Browsers drop tabs and line
// breaks from URLs, so "/<tab>/evil.com" would become "//evil.com": control characters and
// backslashes are refused anywhere in it.
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\u0000-\u001f\u007f\\]/.test(next)) return "/";
  return next;
}
