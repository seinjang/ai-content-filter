import { DEFAULT_API_BASE } from './service';

export async function getApiBase(): Promise<string> {
  const { apiBase } = await browser.storage.sync.get('apiBase');
  return typeof apiBase === 'string' && apiBase ? apiBase.replace(/\/+$/, '') : DEFAULT_API_BASE;
}

export async function setApiBase(value: string): Promise<void> {
  await browser.storage.sync.set({ apiBase: value.replace(/\/+$/, '') });
}
