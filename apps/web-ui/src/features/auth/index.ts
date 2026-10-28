// Public surface của feature auth. Các nơi khác chỉ import từ đây,
// không thò tay vào internals (api/hooks/schemas cụ thể).
export * from './schemas/auth';
export { login, register, adminLogin, logout } from './api/auth';
export { useLogin } from './hooks/use-login';
export { useRegister } from './hooks/use-register';
export { useLogout } from './hooks/use-logout';
export { AdminAccount } from './components/admin-account';
