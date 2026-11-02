import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Ký tự đặc biệt được backend chấp nhận (`PASSWORD_SPECIALS` trong studio-api). */
const PASSWORD_SPECIALS = '!@#$%^&*()-_+=[]{}|;:,.<>?/';

export const PASSWORD_POLICY_HINT =
  'Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt.';

/** Chính sách mật khẩu MỚI, khớp `passwordPolicyError` của backend; đăng nhập không áp dụng. */
const newPasswordSchema = z
  .string()
  .min(8, 'Mật khẩu tối thiểu 8 ký tự')
  .regex(/\p{Nd}/u, 'Mật khẩu cần ít nhất một chữ số')
  .regex(/\p{Lu}/u, 'Mật khẩu cần ít nhất một chữ hoa')
  .regex(/\p{Ll}/u, 'Mật khẩu cần ít nhất một chữ thường')
  .refine((value) => [...value].some((c) => PASSWORD_SPECIALS.includes(c)), {
    message: 'Mật khẩu cần ít nhất một ký tự đặc biệt',
  });

export const registerSchema = loginSchema.extend({
  name: z.string().min(1, 'Vui lòng nhập tên').optional(),
  password: newPasswordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const adminLoginSchema = z.object({
  username: z.string().min(1, 'Vui lòng nhập tên đăng nhập'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
