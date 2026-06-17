import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { useState } from "react";
import type { Video, VideoKind, VideoParentInput } from "@/lib/api";
import { linkVideo } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { StudentSyllabusScope } from "./add-video-button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { handleApiFormError, useFormWithValidation } from "@/components/hooks/useFormErrors";
import { TracedForm } from "@/components/traced-form";

interface LinkVideoFormProps {
  techniqueId: number;
  /** Present only in a student's syllabus context. Enables the "also add to
   *  global library" switch and the T3 (student syllabus technique) parent. */
  studentSyllabus?: StudentSyllabusScope;
  onCancel: () => void;
  onLinked: (video: Video) => void;
}

const schema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(120, "Title is too long"),
  description: z.string().max(2000, "Description is too long").optional(),
  url: z.string().url("Enter a full URL starting with http(s)://"),
});

type FormValues = z.infer<typeof schema>;

export function LinkVideoForm({
  techniqueId,
  studentSyllabus,
  onCancel,
  onLinked,
}: LinkVideoFormProps) {
  // Defaults ON: a coach linking a video usually wants it in the global
  // library. Off scopes the video to just this student's syllabus technique.
  const [alsoGlobal, setAlsoGlobal] = useState(true);
  const form = useFormWithValidation<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", description: "", url: "" },
  });

  const watchedUrl = form.watch("url");
  const detected = detectHost(watchedUrl);

  async function handleSubmit(values: FormValues) {
    const parent: VideoParentInput | undefined =
      studentSyllabus && !alsoGlobal
        ? { kind: "student_syllabus_technique", id: studentSyllabus.sstId }
        : undefined;
    try {
      const video = await linkVideo(
        techniqueId,
        {
          title: values.title.trim(),
          description: values.description?.trim() || undefined,
          url: values.url.trim(),
        },
        parent,
      );
      toast.success(
        studentSyllabus && !alsoGlobal
          ? "Video added for this student"
          : "Video added to the library",
      );
      onLinked(video);
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error(err instanceof Error ? err.message : "Failed to link video");
    }
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <TracedForm
        id="video_link"
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Video URL</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="url"
                  placeholder="https://youtu.be/... or vimeo / drive link"
                />
              </FormControl>
              {detected && (
                <FormDescription className="flex items-center gap-1.5">
                  Detected as
                  <Badge variant="secondary" className="text-xs uppercase">
                    {detected}
                  </Badge>
                  {detected === "drive" && (
                    <span className="text-xs">
                      Make sure the share permission is &quot;anyone with the
                      link&quot;.
                    </span>
                  )}
                </FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input {...field} placeholder="e.g. Mendes Bros walkthrough" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Description input intentionally hidden: see UploadVideoForm. */}

        {studentSyllabus && (
          <div className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="link-also-global">
                Also add to global technique library
              </Label>
              <p className="text-xs text-muted-foreground">
                Off keeps this video on this student&apos;s syllabus only.
              </p>
            </div>
            <Switch
              id="link-also-global"
              checked={alsoGlobal}
              onCheckedChange={setAlsoGlobal}
              disabled={isSubmitting}
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Add link"}
          </Button>
        </div>
      </TracedForm>
    </Form>
  );
}

function detectHost(url: string): VideoKind | null {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("vimeo.com")) return "vimeo";
  if (lower.includes("drive.google.com")) return "drive";
  if (/^https?:\/\//.test(lower)) return "link";
  return null;
}
