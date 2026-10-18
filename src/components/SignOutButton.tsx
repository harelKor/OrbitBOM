export function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button type="submit" className={`text-sm text-slate-400 hover:text-slate-100 ${className}`}>
        Sign out
      </button>
    </form>
  );
}
