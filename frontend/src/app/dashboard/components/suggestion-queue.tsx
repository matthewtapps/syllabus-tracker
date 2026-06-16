/**
 * Technique-suggestion queue for the coach dashboard.
 *
 * Renders a card listing all pending student suggestions. Each row lets the
 * coach Approve (pick a camp), Replace (pick camp + technique), or Dismiss.
 * Approve and Replace require a camp picker for that specific student.
 */
import { useState } from 'react';
import { Lightbulb, Check, X, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { usePendingSuggestions } from '@/lib/queries';
import { useCampsForStudent } from '@/lib/queries';
import { useLibraryTechniques } from '@/lib/queries';
import { useDecideSuggestion } from '@/lib/mutations';
import type { PendingSuggestion } from '@/lib/api';

export function SuggestionQueue() {
  const { data: suggestions, isLoading } = usePendingSuggestions();

  if (isLoading) return null;
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-status-amber/30 bg-card">
      <header className="flex items-center gap-2.5 border-b border-status-amber/30 bg-status-amber-bg px-3 py-2">
        <Lightbulb className="h-4 w-4 text-status-amber" aria-hidden />
        <h3 className="text-sm font-semibold">Technique suggestions</h3>
      </header>
      <ul className="divide-y divide-border">
        {suggestions.map((s) => (
          <SuggestionRow key={s.id} suggestion={s} />
        ))}
      </ul>
    </div>
  );
}

interface SuggestionRowProps {
  suggestion: PendingSuggestion;
}

type ActionMode = 'idle' | 'approve' | 'replace';

function SuggestionRow({ suggestion }: SuggestionRowProps) {
  const [mode, setMode] = useState<ActionMode>('idle');
  const [selectedCampId, setSelectedCampId] = useState<number | ''>('');
  const [selectedTechId, setSelectedTechId] = useState<number | ''>('');
  const decideMutation = useDecideSuggestion();

  const campsQuery = useCampsForStudent(
    mode !== 'idle' ? suggestion.student_id : undefined,
  );
  const techQuery = useLibraryTechniques();

  async function handleDismiss() {
    try {
      await decideMutation.mutateAsync({ id: suggestion.id, body: { decision: 'dismiss' } });
      toast.success('Suggestion dismissed');
    } catch {
      toast.error('Failed to dismiss suggestion');
    }
  }

  async function handleConfirm() {
    if (mode === 'approve') {
      if (!selectedCampId) {
        toast.error('Pick a camp first');
        return;
      }
      try {
        await decideMutation.mutateAsync({
          id: suggestion.id,
          campId: Number(selectedCampId),
          body: { decision: 'approve', camp_id: Number(selectedCampId) },
        });
        toast.success('Technique added to camp');
        setMode('idle');
        setSelectedCampId('');
      } catch {
        toast.error('Failed to approve suggestion');
      }
    } else if (mode === 'replace') {
      if (!selectedCampId || !selectedTechId) {
        toast.error('Pick a camp and replacement technique');
        return;
      }
      try {
        await decideMutation.mutateAsync({
          id: suggestion.id,
          campId: Number(selectedCampId),
          body: {
            decision: 'replace',
            camp_id: Number(selectedCampId),
            replacement_technique_id: Number(selectedTechId),
          },
        });
        toast.success('Replacement technique added to camp');
        setMode('idle');
        setSelectedCampId('');
        setSelectedTechId('');
      } catch {
        toast.error('Failed to apply replacement');
      }
    }
  }

  const camps = campsQuery.data ?? [];
  const techniques = techQuery.data ?? [];
  const busy = decideMutation.isPending;

  return (
    <li className="px-3 py-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {suggestion.technique_name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {suggestion.student_name ?? 'Unknown student'}
            {suggestion.anchor_video_title && (
              <> &middot; from &ldquo;{suggestion.anchor_video_title}&rdquo;
                {suggestion.anchor_seconds !== null && (
                  <> at {formatSeconds(suggestion.anchor_seconds)}</>
                )}
              </>
            )}
          </p>
        </div>

        {mode === 'idle' && (
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMode('approve')}
              disabled={busy}
            >
              <Check className="mr-1 h-3 w-3" aria-hidden />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMode('replace')}
              disabled={busy}
            >
              <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
              Replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              disabled={busy}
              aria-label="Dismiss suggestion"
            >
              <X className="h-3 w-3" aria-hidden />
            </Button>
          </div>
        )}
      </div>

      {mode !== 'idle' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Camp picker */}
          <select
            className="h-8 rounded border border-border bg-background px-2 text-xs"
            value={selectedCampId}
            onChange={(e) =>
              setSelectedCampId(e.target.value === '' ? '' : Number(e.target.value))
            }
            aria-label="Select camp"
          >
            <option value="">Pick camp...</option>
            {camps
              .filter((c) => !c.archived_at)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>

          {/* Technique picker (replace only) */}
          {mode === 'replace' && (
            <select
              className="h-8 rounded border border-border bg-background px-2 text-xs"
              value={selectedTechId}
              onChange={(e) =>
                setSelectedTechId(e.target.value === '' ? '' : Number(e.target.value))
              }
              aria-label="Select replacement technique"
            >
              <option value="">Pick technique...</option>
              {techniques.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}

          <Button size="sm" onClick={handleConfirm} disabled={busy}>
            Confirm
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setMode('idle');
              setSelectedCampId('');
              setSelectedTechId('');
            }}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      )}
    </li>
  );
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
