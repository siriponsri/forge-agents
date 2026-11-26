export type Lang = 'th' | 'en';
export type Page = 'home' | 'docs' | 'install' | 'download' | 'changelog' | 'github' | '404';
export const pages: Page[] = ['home', 'docs', 'install', 'download', 'changelog', 'github'];
export const repo = 'https://github.com/siriponsri/forge-agents';
export const publicBaseline = `${repo}/tree/01ee779ffd049ba875ad85bd36f2c8accd274ca0`;
export const publicCheckpoint = `${repo}/tree/d928e9cc97d54abbd38f2f65afa1798ac8b5b6d5`;
export const currentCheckpoint = `${repo}/tree/f2387e866a2ae3808ad1989a0a7860ae437e9956`;
export const href = (lang: Lang, page: Page = 'home') => `/${lang}/${page === 'home' ? '' : page + '/'}`;
export function route(path: string): {lang: Lang; page: Page} {
  const parts = path.split('/').filter(Boolean);
  const lang: Lang = parts[0] === 'en' ? 'en' : 'th';
  if (!parts.length) return {lang, page: 'home'};
  if (!['th','en'].includes(parts[0]) || parts.length > 2) return {lang,page:'404'};
  const page = (parts[1] || 'home') as Page;
  return {lang, page: pages.includes(page) ? page : '404'};
}
export const titles: Record<Page,string> = {
  home:'One workspace. Every part of the work.', docs:'Documentation', install:'Installation guide',
  download:'Downloads & release status', changelog:'Changelog', github:'Source & development', '404':'Page not found',
};
