// Explicit local browser session for HTTP integration fixtures; never patches fetch.
export async function browserOwner(url) {
  const response = await fetch(url + '/api/session');
  const {csrf} = await response.json();
  if (!response.ok || !csrf) throw new Error('Browser session unavailable');
  return {Cookie: response.headers.get('set-cookie').split(';')[0], 'X-Forge-CSRF': csrf};
}
