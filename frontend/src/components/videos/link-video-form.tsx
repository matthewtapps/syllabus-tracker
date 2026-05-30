import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import type { Video, VideoKind } from "@/lib/api";
import { linkVideo } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useFormWithValidation } from "@/components/hooks/useFormErrors";
import { TracedForm } from "@/components/traced-form";

interface LinkVideoFormProps {
  techniqueId: number;
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
  onCancel,
  onLinked,
}: LinkVideoFormProps) {
  const form = useFormWithValidation<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", description: "", url: "" },
  });

  const watchedUrl = form.watch("url");
  const detected = detectHost(watchedUrl);

  async function handleSubmit(values: FormValues) {
    const video = await linkVideo(techniqueId, {
      title: values.title.trim(),
      description: values.description?.trim() || undefined,
      url: values.url.trim(),
    });
    toast.success("Link added");
    onLinked(video);
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <TracedForm
        id="video_link"
        onSubmit={form.handleSubmit(handleSubmit)}
        setFieldErrors={form.setFieldErrors}
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

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description (optional)</FormLabel>
              <FormControl>
                <Textarea {...field} className="min-h-24 max-h-48" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
