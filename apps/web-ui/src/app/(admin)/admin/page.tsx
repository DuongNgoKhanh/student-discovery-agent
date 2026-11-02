import { redirect } from 'next/navigation';

// "Người dùng" is hidden for the MVP (students chat anonymously); the Studio starts at the agent.
export default function AdminHome() {
  redirect('/admin/agent');
}
