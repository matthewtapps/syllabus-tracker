export const STATUS_VALUES = ["red", "amber", "green"] as const;
export type Status = (typeof STATUS_VALUES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  red: "New",
  amber: "Doing",
  green: "Done",
};

export function statusToTextClass(status: Status): string {
  switch (status) {
    case "red":
      return "text-status-red";
    case "amber":
      return "text-status-amber";
    case "green":
      return "text-status-green";
  }
}

export function statusToBgClass(status: Status): string {
  switch (status) {
    case "red":
      return "bg-status-red-bg";
    case "amber":
      return "bg-status-amber-bg";
    case "green":
      return "bg-status-green-bg";
  }
}

export function statusToBorderClass(status: Status): string {
  switch (status) {
    case "red":
      return "border-status-red";
    case "amber":
      return "border-status-amber";
    case "green":
      return "border-status-green";
  }
}

export function statusToDotClass(status: Status): string {
  switch (status) {
    case "red":
      return "bg-status-red";
    case "amber":
      return "bg-status-amber";
    case "green":
      return "bg-status-green";
  }
}

export function nextStatus(current: Status): Status {
  const i = STATUS_VALUES.indexOf(current);
  return STATUS_VALUES[(i + 1) % STATUS_VALUES.length];
}
