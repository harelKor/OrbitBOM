export function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button type="submit" className={`text-sm text-muted hover:text-fg ${className}`}>
        Sign out
      </button>
    </form>
  );
}
