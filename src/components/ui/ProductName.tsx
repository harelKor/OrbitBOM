// A window title's name: a link to the product page when there is one (new tab), plain text when
// not (Harel, 2026-11-25). Only http(s) links, so a typed "javascript:" never becomes clickable.

export function ProductName({ name, url }: { name: React.ReactNode; url?: string | null }) {
  if (!url || !/^https?:\/\//i.test(url)) return <span className="min-w-0 truncate">{name}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate decoration-sky-400/60 underline-offset-4 hover:text-accent hover:underline" title="Open the product page">
      {name}
    </a>
  );
}
