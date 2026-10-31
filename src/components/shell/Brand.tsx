import Link from "next/link";
import Image from "next/image";

// The 1690 OrbitParts mark: heads the left panel, and the top bar while that panel is hidden.
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/?home" className="press flex shrink-0 items-center gap-2.5 text-white" aria-label="OrbitParts home">
      <Image src="/orbit-logo.png" alt="" width={34} height={34} className="h-[34px] w-[34px] shrink-0 object-contain" priority />
      <span className={`items-center gap-2.5 ${compact ? "hidden sm:flex" : "flex"}`}>
        <span className="display text-[26px] leading-none">1690</span>
        <span className="leading-tight">
          <span className="block text-[13px] font-semibold tracking-[0.12em]">ORBIT</span>
          <span className="block text-[11px] tracking-[0.12em] text-white/75">PARTS</span>
        </span>
      </span>
    </Link>
  );
}
