import { describe, it, expect } from 'vitest';
import { decodeJwt, isExpired } from './jwt-decode';

// header.payload.sig — payload = {"sub":"7","admin":true,"exp":9999999999}
const TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI3IiwiYWRtaW4iOnRydWUsImV4cCI6OTk5OTk5OTk5OX0.sig';

describe('decodeJwt', () => {
  it('đọc payload', () => {
    expect(decodeJwt(TOKEN)).toMatchObject({ sub: '7', admin: true });
  });
  it('trả null với token rác', () => {
    expect(decodeJwt('rác')).toBeNull();
  });
});

describe('isExpired', () => {
  it('token exp lớn thì chưa hết hạn', () => {
    expect(isExpired({ exp: 9999999999 })).toBe(false);
  });
  it('token thiếu exp thì coi như hết hạn', () => {
    expect(isExpired({})).toBe(true);
  });
});
