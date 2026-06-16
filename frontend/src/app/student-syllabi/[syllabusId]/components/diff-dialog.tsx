import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { GitCompare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAssignmentDiff } from '@/lib/queries';
import { useApplyAssignmentDiff } from '@/lib/mutations';
import type {
  GhostActionKind,
  MissingActionKind,
  VideoActionKind,
} from '@/lib/api';

interface DiffDialogProps {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  studentId: number;
  syllabusId: number;
  studentName?: string;
}

export function DiffDialog({
  open,
  onOpenChange,
  studentId,
  syllabusId,
  studentName,
}: DiffDialogProps) {
  const diffQuery = useAssignmentDiff(
    open ? studentId : undefined,
    open ? syllabusId : undefined,
  );
  const applyMutation = useApplyAssignmentDiff();
  const [ghostActions, setGhostActions] = useState<
    Map<number, GhostActionKind>
  >(new Map());
  const [missingActions, setMissingActions] = useState<
    Map<number, MissingActionKind>
  >(new Map());
  const [videoActions, setVideoActions] = useState<
    Map<number, VideoActionKind>
  >(new Map());

  const diff = diffQuery.data;
  const stagedCount = useMemo(() => {
    let n = 0;
    ghostActions.forEach((v) => {
      if (v !== 'ignore') n += 1;
    });
    missingActions.forEach((v) => {
      if (v !== 'ignore') n += 1;
    });
    videoActions.forEach((v) => {
      if (v !== 'ignore') n += 1;
    });
    return n;
  }, [ghostActions, missingActions, videoActions]);

  function setGhost(sstId: number, action: GhostActionKind) {
    setGhostActions((prev) => {
      const next = new Map(prev);
      next.set(sstId, action);
      return next;
    });
  }
  function setMissing(techniqueId: number, action: MissingActionKind) {
    setMissingActions((prev) => {
      const next = new Map(prev);
      next.set(techniqueId, action);
      return next;
    });
  }
  function setVideo(videoId: number, action: VideoActionKind) {
    setVideoActions((prev) => {
      const next = new Map(prev);
      next.set(videoId, action);
      return next;
    });
  }

  async function handleApply() {
    if (!diff) return;
    const ghosts = diff.ghosts
      .map((g) => ({
        sst_id: g.sst_id,
        technique_id: g.technique_id,
        action: ghostActions.get(g.sst_id) ?? ('ignore' as const),
      }))
      .filter((g) => g.action !== 'ignore');
    const missing = diff.missing
      .map((m) => ({
        technique_id: m.technique_id,
        action: missingActions.get(m.technique_id) ?? ('ignore' as const),
      }))
      .filter((m) => m.action !== 'ignore');
    const videos = diff.videos
      .map((v) => ({
        video_id: v.video_id,
        action: videoActions.get(v.video_id) ?? ('ignore' as const),
      }))
      .filter((v) => v.action !== 'ignore');
    try {
      const { applied } = await applyMutation.mutateAsync({
        studentId,
        syllabusId,
        ghost_actions: ghosts,
        missing_actions: missing,
        video_actions: videos,
      });
      toast.success(
        applied === 1
          ? 'Applied 1 change'
          : `Applied ${applied} changes`,
      );
      setGhostActions(new Map());
      setMissingActions(new Map());
      setVideoActions(new Map());
      onOpenChange(false);
    } catch {
      toast.error('Failed to apply changes');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-3 sm:h-auto"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-4 w-4" aria-hidden />
            Sync{studentName ? ` ${studentName}'s` : ''} syllabus
          </DialogTitle>
        </DialogHeader>

        {diffQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !diff ||
          (diff.ghosts.length === 0 &&
            diff.missing.length === 0 &&
            diff.videos.length === 0) ? (
          <p className="text-sm text-muted-foreground">
            Up to date. The student's syllabus matches the current syllabus.
          </p>
        ) : (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            {diff.ghosts.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Out of sync ({diff.ghosts.length})
                </h3>
                <p className="text-xs text-muted-foreground">
                  These techniques are on this student's syllabus but not in
                  the syllabus's current shape.
                </p>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {diff.ghosts.map((g) => (
                    <li
                      key={g.sst_id}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="truncate text-sm">
                        {g.technique_name}
                      </span>
                      <Select
                        value={ghostActions.get(g.sst_id) ?? 'ignore'}
                        onValueChange={(v) => setGhost(g.sst_id, v as GhostActionKind)}
                      >
                        <SelectTrigger size="sm" className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ignore">Leave alone</SelectItem>
                          <SelectItem value="readd_globally">
                            Add back to syllabus
                          </SelectItem>
                          <SelectItem value="hide_locally">
                            Hide for this student
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {diff.missing.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Missing ({diff.missing.length})
                </h3>
                <p className="text-xs text-muted-foreground">
                  These techniques are in the syllabus but this student is not
                  actively progressing on them.
                </p>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {diff.missing.map((m) => (
                    <li
                      key={m.technique_id}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="truncate text-sm">
                        {m.technique_name}
                      </span>
                      <Select
                        value={missingActions.get(m.technique_id) ?? 'ignore'}
                        onValueChange={(v) =>
                          setMissing(m.technique_id, v as MissingActionKind)
                        }
                      >
                        <SelectTrigger size="sm" className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ignore">Leave alone</SelectItem>
                          <SelectItem value="add_to_student">
                            Add to this student
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {diff.videos.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Videos ({diff.videos.length})
                </h3>
                <p className="text-xs text-muted-foreground">
                  These videos differ between this student's syllabus and the
                  library.
                </p>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {diff.videos.map((v) => (
                    <li
                      key={v.video_id}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm">
                        {v.video_title}
                        <span className="block truncate text-xs text-muted-foreground">
                          {v.technique_name} ·{' '}
                          {v.kind === 'hidden_for_student'
                            ? 'Hidden for this student'
                            : "Only on this student's syllabus"}
                        </span>
                      </span>
                      <Select
                        value={videoActions.get(v.video_id) ?? 'ignore'}
                        onValueChange={(val) =>
                          setVideo(v.video_id, val as VideoActionKind)
                        }
                      >
                        <SelectTrigger size="sm" className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {v.kind === 'hidden_for_student' ? (
                            <>
                              <SelectItem value="ignore">Leave alone</SelectItem>
                              <SelectItem value="restore">Restore</SelectItem>
                            </>
                          ) : (
                            <>
                              <SelectItem value="ignore">Leave alone</SelectItem>
                              <SelectItem value="promote_to_global">
                                Add to library
                              </SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        <DialogFooter className="grid grid-cols-2 gap-2 sm:flex-none sm:justify-stretch">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={applyMutation.isPending}
            className="w-full"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={stagedCount === 0 || applyMutation.isPending}
            className="w-full"
          >
            {applyMutation.isPending
              ? 'Applying...'
              : stagedCount === 0
                ? 'Apply'
                : stagedCount === 1
                  ? 'Apply 1 change'
                  : `Apply ${stagedCount} changes`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
