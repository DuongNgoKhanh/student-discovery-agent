import { NextResponse } from 'next/server';
import { clearAuthCookies } from '@/server/auth/cookies';

export async function POST() {
  await clearAuthCookies();
  return NextResponse.json({ success: true, data: { ok: true } });
}
