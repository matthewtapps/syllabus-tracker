import type { CampComponent } from "@/lib/api";

/** `${kind}:${id}`, stable across pages. The camp page's anchors scroll to it. */
export function campComponentKey(
  kind: CampComponent["kind"],
  id: number,
): string {
  return `${kind}:${id}`;
}

export function componentKey(component: CampComponent): string {
  return campComponentKey(component.kind, component.id);
}
