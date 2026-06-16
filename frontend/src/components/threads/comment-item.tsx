import { StudentAvatar } from "@/components/student-avatar";
import { formatRelativeShort } from "@/lib/dates";
import type { CommentView } from "@/lib/api";

export function CommentItem({
  comment,
  authorName,
}: {
  comment: CommentView;
  authorName: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <StudentAvatar id={comment.author_id} name={authorName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{authorName}</span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeShort(comment.created_at)}
          </span>
        </div>
        {comment.body === null ? (
          <p className="text-sm italic text-muted-foreground">comment removed</p>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
        )}
      </div>
    </div>
  );
}
