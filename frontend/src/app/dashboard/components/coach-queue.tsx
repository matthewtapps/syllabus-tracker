import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { InviteResponse, User } from "@/lib/api";
import { useStudents } from "@/lib/queries";
import { useApproveUser, useResetUserClaim } from "@/lib/mutations";
import { qk } from "@/lib/query-keys";
import { QueuePanel } from "./queue-panel";
import { ClaimLinkPanel } from "@/components/claim-link-panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Coach action queue: pending account approvals and password-reset requests,
 * with the sign-in-link dialog. Self-contained (owns its data + mutations) so it
 * can sit at the top of the gym feed and on the classic dashboard without
 * duplicating the wiring. Renders nothing when both queues are empty.
 */
export function CoachQueue() {
  const queryClient = useQueryClient();
  const studentsQuery = useStudents("recent_update", false);
  const resetClaimMutation = useResetUserClaim();
  const approveMutation = useApproveUser();
  const [issuedClaimUrl, setIssuedClaimUrl] = useState<string | null>(null);

  const activeStudents = useMemo(
    () => (studentsQuery.data ?? []).filter((s) => !s.archived),
    [studentsQuery.data],
  );
  const pendingApprovals = useMemo(
    () => activeStudents.filter((s) => s.claimed_at && !s.approved_at),
    [activeStudents],
  );
  const resetRequests = useMemo(
    () => activeStudents.filter((s) => s.reset_requested_at),
    [activeStudents],
  );

  async function handleSendResetLink(studentId: number) {
    try {
      const response = await resetClaimMutation.mutateAsync(studentId);
      const invite: InviteResponse = await response.json();
      setIssuedClaimUrl(`${window.location.origin}${invite.claim_path}`);
      // Clear reset_requested_at locally so it drops out of the queue.
      queryClient.setQueryData<User[]>(qk.students("recent_update", false), (prev) =>
        prev?.map((s) =>
          s.id === studentId ? { ...s, reset_requested_at: null, claimed_at: null } : s,
        ),
      );
    } catch (err) {
      console.error(err);
      toast.error("Failed to create link");
    }
  }

  async function handleApprove(studentId: number) {
    try {
      await approveMutation.mutateAsync(studentId);
      toast.success("Approved");
    } catch (err) {
      console.error(err);
      toast.error("Failed to approve");
    }
  }

  if (pendingApprovals.length === 0 && resetRequests.length === 0) return null;

  return (
    <>
      <div className="space-y-3">
        <QueuePanel
          resetRequests={resetRequests}
          pendingApprovals={pendingApprovals}
          onSendResetLink={handleSendResetLink}
          onApprove={handleApprove}
        />
      </div>

      <Dialog
        open={!!issuedClaimUrl}
        onOpenChange={(next) => {
          if (!next) setIssuedClaimUrl(null);
        }}
      >
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Sign-in link ready</DialogTitle>
            <DialogDescription>
              Show this QR code to the student or send them the link. Valid for 7 days.
            </DialogDescription>
          </DialogHeader>
          {issuedClaimUrl && <ClaimLinkPanel url={issuedClaimUrl} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIssuedClaimUrl(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
