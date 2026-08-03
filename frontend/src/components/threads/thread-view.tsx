import { useEffect, useMemo, useRef, useState } from "react";
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
import { VideoPlayerPanel } from "@/components/videos/video-player-panel";
import {
  PlayerControllerProvider,
  usePlayerController,
  usePlayerRegistration,
} from "@/components/videos/player-context";
import { MomentOverlay } from "@/components/videos/review/moment-overlay";
import { ScrubberPins } from "@/components/videos/review/scrubber-pins";
import type { TimestampedEntry } from "@/components/videos/review/timestamped-entry";
import type { PlayerEvents } from "@/components/videos/player-events";
import { useUser } from "@/lib/current-user-context";
import { useCreateComment, useDeleteThread } from "@/lib/mutations";
import { CommentItem } from "./comment-item";
import { ReplyComposer, type VideoAttachment } from "./reply-composer";
import type { ThreadView as ThreadViewModel } from "@/lib/api";
import { cn } from "@/lib/utils";

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

  const comments = useMemo(
    () => [...thread.comments].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [thread.comments],
  );

  const authorName = thread.author_name;
  const canDelete =
    thread.author_id === user.id || user.role !== "student";

  async function handleReply(body: string, attachment: VideoAttachment | null, videoTsSeconds: number | null) {
    // Throw on failure so the composer surfaces it (and keeps the draft).
    await createComment.mutateAsync({
      threadId: thread.id,
      body,
      videoId: attachment?.videoId ?? null,
      videoIsReference: attachment?.isReference ?? null,
      videoTitle: attachment?.title ?? null,
      authorId: user.id,
      authorName: user.display_name,
      videoTsSeconds: videoTsSeconds ?? null,
    });
  }

  async function handleDeleteThread() {
    try {
      await deleteThread.mutateAsync(thread.id);
    } catch {
      toast.error("Failed to delete thread. Please try again.");
    }
  }

  const deleteControl = canDelete ? (
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
  ) : null;

  if (thread.video) {
    return (
      <PlayerControllerProvider>
        <VideoPostBody
          thread={thread}
          comments={comments}
          authorName={authorName}
          deleteControl={deleteControl}
          anchorKind={anchorKind}
          anchorId={anchorId}
          campId={campId}
          pending={createComment.isPending}
          onReply={handleReply}
        />
      </PlayerControllerProvider>
    );
  }

  return (
    <div className="space-y-3">
      {/* Root post */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <StudentAvatar id={thread.author_id} name={authorName} size="sm" />
            <span className="text-sm font-medium">{authorName}</span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeShort(thread.created_at)}
            </span>
          </div>
          {deleteControl}
        </div>
        {thread.body === null ? (
          <p className="text-sm italic text-muted-foreground">
            thread removed
          </p>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{thread.body}</p>
        )}
      </div>

      {/* Replies */}
      {comments.length > 0 && (
        <div className="space-y-3 border-l-2 border-border pl-3">
          {comments.map((c) => (
            <CommentItem key={`c${c.id}`} comment={c} authorName={c.author_name} />
          ))}
        </div>
      )}

      {/* Reply composer */}
      <ReplyComposer
        anchorKind={anchorKind}
        anchorId={anchorId}
        campId={campId}
        pending={createComment.isPending}
        onSubmit={handleReply}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// VideoPostBody — rendered inside PlayerControllerProvider when thread.video
// ---------------------------------------------------------------------------

interface VideoPostBodyProps {
  thread: ThreadViewModel;
  comments: ThreadViewModel["comments"];
  authorName: string;
  deleteControl: React.ReactNode;
  anchorKind: string;
  anchorId: number;
  campId?: number;
  pending: boolean;
  onReply: (body: string, attachment: VideoAttachment | null, videoTsSeconds: number | null) => Promise<void>;
}

function VideoPostBody({
  thread,
  comments,
  authorName,
  deleteControl,
  anchorKind,
  anchorId,
  campId,
  pending,
  onReply,
}: VideoPostBodyProps) {
  const controller = usePlayerController();
  const registration = usePlayerRegistration();

  const [pinnedComment, setPinnedComment] = useState<TimestampedEntry | null>(null);
  const [highlightCommentId, setHighlightCommentId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  // Clear both timers on unmount to prevent setState-after-unmount warnings.
  useEffect(() => {
    return () => {
      if (pinTimerRef.current) window.clearTimeout(pinTimerRef.current);
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const tsComments = useMemo<TimestampedEntry[]>(
    () =>
      comments.map((c) => ({
        id: c.id,
        author_id: c.author_id,
        author_name: c.author_name,
        body: c.body,
        video_ts_seconds: c.video_ts_seconds,
      })),
    [comments],
  );

  // Bridge player events -> controller registration.
  // Stable reference (registration is a stable useMemo from the provider).
  const playerEvents = useMemo<PlayerEvents>(() => ({
    onProgress: (t, d) => registration?.reportProgress(t, d),
    onPaused: (p) => registration?.reportPaused(p),
    registerSeek: (fn) => registration?.registerSeek(fn),
    registerEnterFullscreen: (fn) => registration?.registerEnterFullscreen(fn),
    registerExitFullscreen: (fn) => registration?.registerExitFullscreen(fn),
    onFullscreenChange: (f) => registration?.reportFullscreen(f),
  }), [registration]);

  function highlightComment(commentId: number) {
    setHighlightCommentId(commentId);
    const el = listRef.current?.querySelector<HTMLElement>(`[data-comment-id="${commentId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightCommentId(null), 2200);
  }

  function handlePinClick(entry: TimestampedEntry) {
    if (pinnedComment?.id === entry.id) {
      setPinnedComment(null);
      if (pinTimerRef.current) {
        window.clearTimeout(pinTimerRef.current);
        pinTimerRef.current = null;
      }
      return;
    }
    setPinnedComment(entry);
    if (entry.video_ts_seconds != null) controller.seekTo(entry.video_ts_seconds);
    highlightComment(entry.id);
    // Auto-clear the overlay pin after 6 s. Clear any prior handle first.
    if (pinTimerRef.current) window.clearTimeout(pinTimerRef.current);
    pinTimerRef.current = window.setTimeout(
      () => setPinnedComment((cur) => (cur?.id === entry.id ? null : cur)),
      6000,
    );
  }

  function handleSeekChip(commentId: number, seconds: number) {
    controller.seekTo(seconds);
    highlightComment(commentId);
  }

  return (
    <div className="space-y-3">
      {/* Root post */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <StudentAvatar id={thread.author_id} name={authorName} size="sm" />
            <span className="text-sm font-medium">{authorName}</span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeShort(thread.created_at)}
            </span>
          </div>
          {deleteControl}
        </div>
        {thread.body != null && (
          <p className="whitespace-pre-wrap text-sm">{thread.body}</p>
        )}
        <div className="mt-2">
          <VideoPlayerPanel
            video={thread.video!}
            events={playerEvents}
            overlay={
              controller.canReadTime ? (
                <MomentOverlay
                  threads={tsComments}
                  currentTime={controller.currentTime}
                  pinnedThread={pinnedComment}
                  onOpen={handlePinClick}
                />
              ) : undefined
            }
            sliderMarkers={
              controller.canReadTime ? (
                <ScrubberPins
                  threads={tsComments}
                  duration={controller.duration}
                  activeThreadId={pinnedComment?.id ?? null}
                  onPinClick={handlePinClick}
                  onClusterClick={(ts) => handlePinClick(ts[0])}
                />
              ) : undefined
            }
          />
        </div>
      </div>

      {/* Replies */}
      {comments.length > 0 && (
        <div ref={listRef} className="space-y-3 border-l-2 border-border pl-3">
          {comments.map((c) => (
            <div
              key={`c${c.id}`}
              data-comment-id={c.id}
              className={cn(
                "rounded-md transition-colors",
                highlightCommentId === c.id && "bg-muted/60 ring-2 ring-ring/50",
              )}
            >
              <CommentItem
                comment={c}
                authorName={c.author_name}
                onSeek={
                  c.video_ts_seconds != null && controller.canSeek
                    ? (s) => handleSeekChip(c.id, s)
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      )}

      {/* Reply composer with timestamp stamping */}
      <ReplyComposer
        anchorKind={anchorKind}
        anchorId={anchorId}
        campId={campId}
        pending={pending}
        stampable={{ currentTime: controller.currentTime, canStamp: controller.canReadTime }}
        onSubmit={onReply}
      />
    </div>
  );
}
