import { sectionNumber } from "../uiRegistry";

// A tiny, unobtrusive badge showing a section's stable 3-digit id (from the
// uiRegistry). Drop <SectionId id="metrics.capacity" /> beside a card's heading;
// use corner for sections without a heading (pins to a position:relative parent's
// top-right). The number is selectable so it's easy to copy into a message.
export function SectionId({ id, corner = false }: { id: string; corner?: boolean }) {
  const n = sectionNumber(id);
  if (!n) return null;
  return (
    <span className={`section-id${corner ? " section-id--corner" : ""}`} title={`Section ${n} · ${id}`}>
      {n}
    </span>
  );
}
