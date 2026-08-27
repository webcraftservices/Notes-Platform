import { NOTE_BLOCK_KIND_LABELS, NOTE_BLOCK_KIND_ORDER } from "@/lib/note-block-style";

export function BlockKindSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-sm border-0 bg-transparent py-0.5 pl-0 pr-5 font-mono text-[11px] font-medium uppercase tracking-wide text-accent-strong outline-none"
    >
      {NOTE_BLOCK_KIND_ORDER.map((kind) => (
        <option key={kind} value={kind}>
          {NOTE_BLOCK_KIND_LABELS[kind]}
        </option>
      ))}
    </select>
  );
}
