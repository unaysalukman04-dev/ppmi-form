import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FormPlayer } from "~/player/FormPlayer";
import { api, ApiError } from "~/lib/api";
import type { FormSchema } from "~/shared/schema";

export const Route = createFileRoute("/f/$slug")({
  component: FillPage,
});

function FillPage() {
  const { slug } = Route.useParams();
  const [data, setData] = useState<{ schema: FormSchema } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ schema: FormSchema }>("/api/public/forms/" + slug)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Not found"));
  }, [slug]);

  if (error)
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <h1 className="font-heading text-2xl font-medium">{error}</h1>
      </div>
    );
  if (!data)
    return (
      <div className="flex min-h-svh items-center justify-center p-6 text-muted-foreground">Loading…</div>
    );
  return (
       <div className="flex h-svh flex-col overflow-hidden">
      <FormPlayer mode="live" slug={slug} schema={data.schema} />
    </div>
  );
}
