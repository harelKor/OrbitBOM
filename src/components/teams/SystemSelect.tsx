"use client";

export type TeamSystemOption = { id: string; name: string; robotName: string };

// A dropdown of active robots' systems, grouped by robot.
export function SystemSelect({
  value,
  systems,
  onChange,
  disabled,
  className = "",
}: {
  value: string | null;
  systems: TeamSystemOption[];
  onChange: (systemId: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const robots = [...new Set(systems.map((s) => s.robotName))];
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label="Subsystem"
      className={`input ${className}`}
    >
      <option value="">No subsystem</option>
      {robots.map((r) => (
        <optgroup key={r} label={r}>
          {systems.filter((s) => s.robotName === r).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
