import Link from "next/link";
import { NewRobotForm } from "./NewRobotForm";

export default function NewRobotPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted hover:text-fg">
          ← Robots
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">New robot</h1>
      </div>
      <NewRobotForm />
    </div>
  );
}
