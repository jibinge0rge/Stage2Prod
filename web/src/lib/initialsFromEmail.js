/** jibin.george@work.com → JG; a single local-part falls back to its first two letters. */
export function initialsFromEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const at = email.indexOf('@');
  if (at < 1) return '';
  const parts = email
    .slice(0, at)
    .trim()
    .split(/[._+\-]+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return '';
}
