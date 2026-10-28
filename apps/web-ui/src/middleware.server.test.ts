import { expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
function token(payload: unknown) { return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`; }
it('lets expired user access reach verified layout for browser refresh recovery', () => {
 const req = new NextRequest('http://localhost/dashboard', { headers:{cookie:`sda_access=${token({sub:'7',type:'access',exp:1})}`} });
 expect(middleware(req).headers.get('x-middleware-next')).toBe('1');
});
it('continues redirecting expired administrators to admin login', () => {
 const req = new NextRequest('http://localhost/admin', {headers:{cookie:`sda_access=${token({sub:'admin',admin:true,type:'access',exp:1})}`}});
 expect(middleware(req).headers.get('location')).toBe('http://localhost/admin/login');
});
it('keeps the requested admin page as next when redirecting to admin login', () => {
 const req = new NextRequest('http://localhost/admin/knowledge/kb-1');
 expect(middleware(req).headers.get('location')).toBe('http://localhost/admin/login?next=%2Fadmin%2Fknowledge%2Fkb-1');
});
it('sends a signed-in administrator past the admin login form', () => {
 const req = new NextRequest('http://localhost/admin/login', {headers:{cookie:`sda_access=${token({sub:'admin',admin:true,type:'access',exp:9999999999})}`}});
 expect(middleware(req).headers.get('location')).toBe('http://localhost/admin/agent');
});
it('shows admin login to a signed-in student', () => {
 const req = new NextRequest('http://localhost/admin/login', {headers:{cookie:`sda_access=${token({sub:'7',type:'access',exp:9999999999})}`}});
 expect(middleware(req).headers.get('x-middleware-next')).toBe('1');
});
