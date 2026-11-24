import manifest from '../public/releases.json';
// This is build-time public metadata. The browser never calls the private runtime.
export type Download = {platform:string; name:string; url:string; bytes:number; sha256:string};
export type Release = {tag:string; url:string; publishedAt:string; prerelease:boolean; downloads:Download[]};
export const releases = manifest as {
  schemaVersion:number; repository:string; checkedAt:string; state:string; httpStatus:number|null;
  note:string; releases:Release[];
};
export const windows = releases.releases.flatMap(r => r.downloads.map(d => ({...d,release:r}))).find(d => d.platform === 'windows');
