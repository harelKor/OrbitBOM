import { ScanTest } from "@/components/inventory/scan/ScanTest";
import { requireMember } from "@/lib/auth";
import { geminiConfigured } from "@/lib/recognize/gemini";

// Phase 0 of plan/item-recognition.md: try the scan on real shop parts before it replaces the
// Scan button. Not linked from anywhere; open /inventory/scan-test on a phone.
export default async function ScanTestPage() {
  await requireMember();
  return (
    <div className="space-y-4">
      <h1 className="display text-3xl text-accent">Scan test</h1>
      <ScanTest configured={geminiConfigured()} />
    </div>
  );
}
