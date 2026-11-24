export type Lang = 'th' | 'en';
export type Page = 'home' | 'docs' | 'install' | 'download' | 'changelog' | 'github' | '404';
export const pages: Page[] = ['home', 'docs', 'install', 'download', 'changelog', 'github'];
export const repo = 'https://github.com/siriponsri/forge-agents';
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
