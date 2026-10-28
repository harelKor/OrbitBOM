// The part's note as a comic-book thought cloud over the thumbnail, in bold on yellow so it is hard
// to miss; the part's (or inventory item's) details window edits it.
export function NoteCloud({ note, raised = false }: { note: string; raised?: boolean }) {
  return (
    <div className={`pointer-events-none absolute left-3 max-w-[80%] ${raised ? "bottom-14" : "bottom-4"}`}>
      <div className="relative rounded-[1.6rem] border-[3px] border-[#111318] bg-[#fff59d] px-3.5 py-2 text-sm leading-snug font-bold text-[#111318] shadow-[3px_4px_0_0_rgba(17,19,24,0.9)]">
        <span className="line-clamp-4 break-words whitespace-pre-line">{note}</span>
      </div>
      {/* The cloud's trailing puffs. */}
      <span className="absolute -bottom-2.5 left-5 h-3 w-3 rounded-full border-[3px] border-[#111318] bg-[#fff59d]" />
      <span className="absolute -bottom-4 left-2 h-2 w-2 rounded-full border-2 border-[#111318] bg-[#fff59d]" />
    </div>
  );
}
