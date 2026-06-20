import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { StudentAvatar } from "@/components/student-avatar";
import { formatRelativeShort } from "@/lib/dates";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useUser } from "@/lib/current-user-context";
import { useCreateComment, useDeleteThread } from "@/lib/mutations";
import { CommentItem } from "./comment-item";
import { VideoReplyItem } from "./video-reply-item";
import { ReplyComposer } from "./reply-composer";
import type { CommentView, VideoReplyView, ThreadView as ThreadViewModel } from "@/lib/api";

interface ThreadViewProps {
  thread: ThreadViewModel;
  anchorKind: string;
  anchorId: number;
  /** Camp scope for camp_technique threads, so reply/delete invalidate the
   *  camp-scoped list rather than the global-library one. */
  campId?: number;
}

export function ThreadView({ thread, anchorKind, anchorId, campId }: ThreadViewProps) {
  const user = useUser();
  const createComment = useCreateComment(anchorKind, anchorId, campId);
  const deleteThread = useDeleteThread(anchorKind, anchorId, campId);
  const [deleteOpen, setDeleteOpen] = useState(false);

  type TimelineEntry =
    | { kind: "comment"; at: string; comment: CommentView }
    | { kind: "video"; at: string; reply: VideoReplyView };

  const entries: TimelineEntry[] = [
    ...thread.comments.map((c) => ({ kind: "comment" as const, at: c.created_at, comment: c })),
    ...thread.video_replies.map((r) => ({ kind: "video" as const, at: r.created_at, reply: r })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const authorName = thread.author_name;
  const canDelete =
    thread.author_id === user.id || user.role !== "student";

  async function handleReply(body: string) {
    try {
      await createComment.mutateAsync({ threadId: thread.id, body });
    } catch {
      toast.error("Failed to post reply. Please try again.");
    }
  }

  async function handleDeleteThread() {
    try {
      await deleteThread.mutateAsync(thread.id);
    } catch {
      toast.error("Failed to delete thread. Please try again.");
    }
  }

  return (
    <div className="space-y-3">
      {/* Root post */}
      <div className="flex items-start gap-2.5">
        <StudentAvatar id={thread.author_id} name={authorName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium">{authorName}</span>
              <span className="text-xs text-muted-foreground">
                {formatRelativeShort(thread.created_at)}
              </span>
            </div>
            {canDelete && (
              <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only">Delete thread</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent size="sm">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this thread?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The thread and all its replies will be removed. This
                      cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={handleDeleteThread}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          {thread.body === null ? (
            <p className="text-sm italic text-muted-foreground">
              thread removed
            </p>
          ) : (
            <p className="whitespace-pre-wrap text-sm">{thread.body}</p>
          )}
        </div>
      </div>

      {/* Replies */}
      {entries.length > 0 && (
        <div className="ml-4 space-y-3 border-l-2 border-border pl-3">
          {entries.map((e) =>
            e.kind === "comment" ? (
              <CommentItem
                key={`c${e.comment.id}`}
                comment={e.comment}
                authorName={e.comment.author_name}
              />
            ) : (
              <VideoReplyItem key={`v${e.reply.id}`} reply={e.reply} />
            ),
          )}
        </div>
      )}

      {/* Reply composer */}
      <div className="ml-4 pl-3">
        <ReplyComposer
          threadId={thread.id}
          anchorKind={anchorKind}
          anchorId={anchorId}
          campId={campId}
          pending={createComment.isPending}
          onSubmit={handleReply}
        />
      </div>
    </div>
  );
}
