export function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button type="submit" className={`text-sm text-slate-500 hover:text-slate-800 ${className}`}>
        Sign out
      </button>
    </form>
  );
}
