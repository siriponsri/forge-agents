const repo = 'siriponsri/forge-agents';
export function selectReleases(input) {
  if (!Array.isArray(input)) throw new Error('Expected a GitHub releases array');
  return input.filter(r => r && !r.draft && typeof r.tag_name==='string' && /^https:\/\/github\.com\/siriponsri\/forge-agents\/releases\/tag\/[^\s]+$/.test(r.html_url) && typeof r.published_at==='string' && Number.isFinite(Date.parse(r.published_at))).map(r => ({
    tag:r.tag_name,url:r.html_url,publishedAt:r.published_at,prerelease:!!r.prerelease,
    downloads:(Array.isArray(r.assets)?r.assets:[]).filter(a => {
      if (!a || !/^FORGE-Windows(?:-[\w.]+)?\.zip$/.test(a.name) || !Number.isSafeInteger(a.size) || a.size<=0 || a.state!=='uploaded' || !/^sha256:[a-f0-9]{64}$/.test(a.digest)) return false;
      try {
        const u=new URL(a.browser_download_url);
        return u.origin==='https://github.com' && !u.search && !u.hash && !u.username && !u.password && u.pathname===`/${repo}/releases/download/${encodeURIComponent(r.tag_name)}/${encodeURIComponent(a.name)}`;
      } catch {return false}
    }).map(a=>({platform:'windows',name:a.name,url:a.browser_download_url,bytes:a.size,sha256:a.digest.slice(7)})),
  })).slice(0,20);
}
export function validateManifest(m) {
  if(m.schemaVersion!==1 || m.repository!==repo || !Array.isArray(m.releases))throw new Error('Invalid public release manifest');
  const projected=selectReleases(m.releases.map(r=>({tag_name:r.tag,html_url:r.url,published_at:r.publishedAt,prerelease:r.prerelease,assets:r.downloads.map(d=>({name:d.name,size:d.bytes,state:'uploaded',digest:`sha256:${d.sha256}`,browser_download_url:d.url}))})));
  if(JSON.stringify(projected)!==JSON.stringify(m.releases))throw new Error('Release manifest has unverified or unsafe download metadata');
  return m;
}
