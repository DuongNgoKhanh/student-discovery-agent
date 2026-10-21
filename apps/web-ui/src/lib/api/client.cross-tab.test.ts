import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const ok = () => Response.json({success:true,data:{}});
it('two isolated tabs serialize cookie rotation and preserve the shared session family', async () => {
 let tail: Promise<unknown> = Promise.resolve();
 vi.stubGlobal('navigator', { locks: { request: (_name: string, callback: () => Promise<unknown>) => {
   const next = tail.then(callback); tail = next.catch(() => {}); return next;
 } } });
 let cookie = 'initial'; let familyActive = true; const consumed = new Set<string>(); let active=0; let maxActive=0;
 vi.spyOn(globalThis,'fetch').mockImplementation(async () => {
   const sent = cookie; active++; maxActive=Math.max(maxActive,active);
   await new Promise(resolve=>setTimeout(resolve,5));
   if (consumed.has(sent)) { familyActive=false; active--; return new Response(null,{status:401}); }
   consumed.add(sent); cookie=`rotated-${consumed.size}`; active--; return ok();
 });
 vi.resetModules(); const tabOne = await import('./client');
 vi.resetModules(); const tabTwo = await import('./client');
 expect(await Promise.all([tabOne.refreshSession(),tabTwo.refreshSession()])).toEqual([true,true]);
 expect(maxActive).toBe(1); expect(familyActive).toBe(true); expect(cookie).toBe('rotated-2');
});
it('unsupported cross-tab locking fails closed without sending an uncoordinated refresh', async () => {
 vi.stubGlobal('navigator', {}); const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(ok());
 vi.resetModules(); const tab = await import('./client');
 expect(await tab.refreshSession()).toBe(false); expect(fetch).not.toHaveBeenCalled();
});
