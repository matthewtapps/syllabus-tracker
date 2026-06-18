import {
  Activity,
  CircleDot,
  ClipboardList,
  Dumbbell,
  Eye,
  GraduationCap,
  MessageSquare,
  Minus,
  NotebookPen,
  Pencil,
  Pin,
  PlayCircle,
  Plus,
  Video,
  type LucideIcon,
} from "lucide-react";

/** Icon + accent colour for an activity verb. Shared by the compact feed list
 *  and the social tile header so the two surfaces stay visually consistent. */
export function verbIconMeta(verb: string): { Icon: LucideIcon; colorClass: string } {
  switch (verb) {
    case "attempt_logged":
    case "attempt_edited":
    case "attempt_deleted":
      return { Icon: Dumbbell, colorClass: "text-amber-500" };
    case "video_watched":
      return { Icon: PlayCircle, colorClass: "text-sky-500" };
    case "video_added":
    case "video_visibility_set":
      return { Icon: Video, colorClass: "text-sky-500" };
    case "sst_status_changed":
      return { Icon: CircleDot, colorClass: "text-emerald-500" };
    case "sst_student_notes_edited":
    case "sst_coach_notes_edited":
      return { Icon: NotebookPen, colorClass: "text-violet-500" };
    case "technique_pinned":
    case "technique_unpinned":
      return { Icon: Pin, colorClass: "text-rose-500" };
    case "syllabus_assigned":
    case "syllabus_unassigned":
      return { Icon: ClipboardList, colorClass: "text-indigo-500" };
    case "syllabus_graduated":
      return { Icon: GraduationCap, colorClass: "text-emerald-600" };
    case "syllabus_technique_added":
    case "sst_added":
      return { Icon: Plus, colorClass: "text-indigo-500" };
    case "syllabus_technique_removed":
    case "sst_hidden":
      return { Icon: Minus, colorClass: "text-indigo-500" };
    case "sst_unhidden":
      return { Icon: Eye, colorClass: "text-indigo-500" };
    case "technique_edited":
      return { Icon: Pencil, colorClass: "text-muted-foreground" };
    case "thread_comment_posted":
      return { Icon: MessageSquare, colorClass: "text-violet-500" };
    default:
      return { Icon: Activity, colorClass: "text-muted-foreground" };
  }
}
