import bcrypt from 'bcryptjs';

// 비밀번호는 되돌릴 수 없는 형태(해시)로만 저장한다.
// DB를 그대로 들여다봐도, 직원이라도 원래 글자를 알 수 없다.
const ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** 관리자가 직원 비밀번호를 리셋할 때 주는 임시 비밀번호 */
export function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
