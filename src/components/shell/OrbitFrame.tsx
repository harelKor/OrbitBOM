// A page with no app around it (not found, the app failing to load): the blue bar with the 1690
// mark, then a short message and its buttons in the middle of the page.
export function OrbitFrame({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-ink text-fg">
      <header className="flex min-h-11 items-center gap-2.5 bg-bar px-4 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- also used by global-error, outside Next's image setup */}
        <img src="/orbit-logo.png" alt="" width={34} height={34} className="h-[2.125rem] w-[2.125rem] object-contain" />
        <span className="leading-tight">
          <span className="block text-[0.8125rem] font-semibold tracking-[0.12em]">ORBIT</span>
          <span className="block text-[0.6875rem] tracking-[0.12em] text-white/75">PARTS</span>
        </span>
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="panel w-full max-w-md p-8 text-center">
          <h1 className="display text-2xl text-accent">{title}</h1>
          <p className="mt-2 text-sm text-muted">{text}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>
        </div>
      </main>
    </div>
  );
}
