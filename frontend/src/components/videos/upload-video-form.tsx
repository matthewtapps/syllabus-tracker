import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  formatBytes,
} from "./limits";
import { uploadVideo } from "@/lib/api";
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
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useFormWithValidation } from "@/components/hooks/useFormErrors";
import { TracedForm } from "@/components/traced-form";

interface UploadVideoFormProps {
  techniqueId: number;
  onCancel: () => void;
  onUploaded: (videoId: number) => void;
}

const schema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(120, "Title is too long"),
  description: z.string().max(2000, "Description is too long").optional(),
});

type FormValues = z.infer<typeof schema>;

export function UploadVideoForm({
  techniqueId,
  onCancel,
  onUploaded,
}: UploadVideoFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useFormWithValidation<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", description: "" },
  });

  useEffect(() => {
    return () => {
      setProgressPct(null);
    };
  }, []);

  async function pickFile(picked: File | null) {
    setFileError(null);
    if (!picked) {
      setFile(null);
      return;
    }
    if (picked.type && picked.type !== "video/mp4") {
      setFileError("Only mp4 files are supported. Please re-export and try again.");
      setFile(null);
      return;
    }
    if (picked.size > MAX_VIDEO_BYTES) {
      setFileError(
        `File is ${formatBytes(picked.size)}; max allowed is ${formatBytes(
          MAX_VIDEO_BYTES,
        )}.`,
      );
      setFile(null);
      return;
    }
    try {
      const duration = await probeDurationSeconds(picked);
      if (duration > MAX_VIDEO_DURATION_SECONDS) {
        setFileError(
          `Video is ${Math.round(
            duration,
          )}s long; max allowed is ${MAX_VIDEO_DURATION_SECONDS}s.`,
        );
        setFile(null);
        return;
      }
    } catch {
      // Some browsers fail to read duration for mp4; fall through and let the
      // server enforce the limit instead of blocking the upload.
    }
    setFile(picked);
    if (!form.getValues("title")) {
      const baseName = picked.name.replace(/\.[^.]+$/, "");
      form.setValue("title", baseName);
    }
  }

  async function handleSubmit(values: FormValues) {
    if (!file) {
      setFileError("Pick an mp4 file to upload.");
      throw new Error("Pick an mp4 file to upload.");
    }
    setProgressPct(0);
    try {
      const result = await uploadVideo(
        techniqueId,
        file,
        {
          title: values.title.trim(),
          description: values.description?.trim() || undefined,
        },
        (loaded, total) => {
          if (total > 0) setProgressPct(Math.round((loaded / total) * 100));
        },
      );
      toast.success("Upload received. Processing now...");
      onUploaded(result.video_id);
    } catch (err) {
      setProgressPct(null);
      throw err;
    }
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <TracedForm
        id="video_upload"
        onSubmit={form.handleSubmit(handleSubmit)}
        setFieldErrors={form.setFieldErrors}
        className="space-y-4"
      >
        <div className="space-y-2">
          <FormLabel htmlFor="video_file">Video file</FormLabel>
          <Input
            id="video_file"
            type="file"
            accept="video/mp4"
            capture="environment"
            ref={fileInputRef}
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              pickFile(picked);
            }}
            disabled={isSubmitting}
          />
          {file ? (
            <p className="text-xs text-muted-foreground">
              {file.name} · {formatBytes(file.size)}
            </p>
          ) : (
            <FormDescription>
              mp4 only, up to {MAX_VIDEO_DURATION_SECONDS / 60} minutes and{" "}
              {formatBytes(MAX_VIDEO_BYTES)}.
            </FormDescription>
          )}
          {fileError && (
            <p className="text-sm font-medium text-destructive">{fileError}</p>
          )}
        </div>

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input {...field} placeholder="e.g. Demo from the seminar" />
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
                <Textarea
                  {...field}
                  className="min-h-24 max-h-48"
                  placeholder="What should students notice?"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {progressPct !== null && (
          <div className="space-y-1">
            <Progress value={progressPct} />
            <p className="text-xs text-muted-foreground">
              Uploading... {progressPct}%
            </p>
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
          <Button type="submit" disabled={isSubmitting || !file}>
            {isSubmitting ? "Uploading..." : "Upload video"}
          </Button>
        </div>
      </TracedForm>
    </Form>
  );
}

async function probeDurationSeconds(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.src = url;
      video.onloadedmetadata = () => {
        if (Number.isFinite(video.duration)) resolve(video.duration);
        else reject(new Error("Could not read duration"));
      };
      video.onerror = () => reject(new Error("Could not read duration"));
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
