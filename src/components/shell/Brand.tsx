import Link from "next/link";
import Image from "next/image";

// The 1690 OrbitParts mark: heads the left panel, and the top bar while that panel is hidden.
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/?home" className="press flex shrink-0 items-center gap-2.5 text-white" aria-label="OrbitParts home">
      <Image src="/orbit-logo.png" alt="" width={34} height={34} className="h-[34px] w-[34px] shrink-0 object-contain" priority />
      <span className={`items-center gap-2.5 ${compact ? "hidden sm:flex" : "flex"}`}>
        {/* Set in the display face (Jost black italic) rather than a traced path, so it stays sharp at any size. */}
        <span className="display text-[1.65rem] font-black italic tracking-tight leading-none text-white tabular-nums">1690</span>
        <span className="leading-tight">
          <span className="block text-[13px] font-semibold tracking-[0.12em]">ORBIT</span>
          <span className="block text-[11px] tracking-[0.12em] text-white/75">PARTS</span>
        </span>
      </span>
    </Link>
  );
}
