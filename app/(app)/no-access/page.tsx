export default function NoAccessPage() {
  return (
    <div className="card max-w-md mx-auto mt-12 text-center">
      <h1 className="text-xl font-semibold mb-2">No pages available</h1>
      <p className="text-sm text-muted-fg">
        Your account hasn&apos;t been granted access to any pages yet. Ask an admin to grant you permissions.
      </p>
    </div>
  );
}
