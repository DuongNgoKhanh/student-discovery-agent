export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-4 font-bold">Khu vực Admin</header>
      {children}
    </div>
  );
}
