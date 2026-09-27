import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "~/lib/api";
import { PhoneField } from "./PhoneField";
import { MAX_FLOW_STEPS, resolveNext } from "~/shared/flow";
import {
  acceptAttr,
  FILE_KINDS,
  livePages,
  normalizePhone,
  questionsOnPage,
  shortTextMatchesRegex,
  type FileKind,
  type FormPage,
  type FormSchema,
  type Question,
} from "~/shared/schema";

export type PlayerScreen = "welcome" | "ending" | { questionId: string } | { pageId: string };

type Phase = { kind: "welcome" } | { kind: "page"; pageId: string } | { kind: "ending" };

type Props = {
  schema: FormSchema;
  mode: "live" | "preview";
  slug?: string;
  screen?: PlayerScreen;
};

function letter(i: number): string {
  return String.fromCharCode(65 + i);
}

function isQuestionScreen(s: PlayerScreen): s is { questionId: string } {
  return typeof s === "object" && "questionId" in s;
}

function isPageScreen(s: PlayerScreen): s is { pageId: string } {
  return typeof s === "object" && "pageId" in s;
}

export function FormPlayer({ schema, mode, slug, screen }: Props) {
  const walk = useMemo(() => livePages(schema, mode === "preview"), [mode, schema]);
  const barPages = useMemo(() => livePages(schema, false), [schema]);
  const [phase, setPhase] = useState<Phase>({ kind: "welcome" });
  const [visitStack, setVisitStack] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "preview" || screen === undefined) return;
    if (screen === "welcome") {
      setPhase({ kind: "welcome" });
      setVisitStack([]);
    } else if (screen === "ending") {
      setPhase({ kind: "ending" });
    } else if (isPageScreen(screen)) {
      const page = walk.find((p) => p.id === screen.pageId);
      if (page) {
        setPhase({ kind: "page", pageId: page.id });
        setVisitStack([page.id]);
      }
    } else if (isQuestionScreen(screen)) {
      const page = walk.find((p) => p.questionIds.includes(screen.questionId));
      if (page) {
        setPhase({ kind: "page", pageId: page.id });
        setVisitStack([page.id]);
      }
    }
  }, [mode, screen, walk]);

  const page: FormPage | undefined = phase.kind === "page" ? walk.find((p) => p.id === phase.pageId) : undefined;
  const pageQs = page ? questionsOnPage(schema, page) : [];
  const nextTarget = page ? resolveNext(schema, page.id, answers) : undefined;
  const isLastPage = phase.kind === "page" && nextTarget?.kind === "ending";
  // ponytail: progress is visit count / default page count; branching paths can be shorter or longer than that
  const progress =
    barPages.length === 0
      ? 0
      : phase.kind === "ending"
        ? 100
        : visitStack.length
          ? Math.min(99, (visitStack.length / barPages.length) * 100)
          : 0;

  const setAns = (id: string, v: unknown) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    setError(null);
  };

  const validate = (question: Question): string | null => {
    if (question.type === "statement") return null;
    if (question.type === "file" && mode === "preview") return null;
    const v = answers[question.id];
    if (
      question.type === "short_text" &&
      question.regex &&
      typeof v === "string" &&
      v.trim() &&
      !shortTextMatchesRegex(question.regex, v.trim())
    ) {
      return "Does not match the required format";
    }
    if (!("required" in question) || !question.required) return null;
    if (v === undefined || v === null || v === "") return "This question is required";
    if (question.type === "multi_select" && Array.isArray(v) && v.length === 0) return "This question is required";
    if (question.type === "email" && typeof v === "string") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return "Enter a valid email";
    }
    if (question.type === "phone" && typeof v === "string") {
      if (!normalizePhone(v)) return "Enter a valid phone number";
    }
    if (question.type === "file" && !(v && typeof v === "object" && "uploadId" in v)) return "Add a file";
    return null;
  };

  const validatePage = (qs: Question[]): string | null => {
    const prefix = qs.filter((q) => q.type !== "statement").length > 1;
    for (const q of qs) {
      const err = validate(q);
      if (!err) continue;
      return prefix && q.title.trim() ? `${q.title}: ${err}` : err;
    }
    return null;
  };

  const submitOrThanks = useCallback(async () => {
    if (mode === "preview") {
      setPhase({ kind: "ending" });
      return;
    }
    if (!slug) {
      setError("Missing form");
      return;
    }
    setBusy(true);
    try {
      await api("/api/public/forms/" + slug + "/submit", {
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      setPhase({ kind: "ending" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }, [mode, slug, answers]);

  const goNext = useCallback(async () => {
    setError(null);
    if (phase.kind === "welcome") {
      const first = walk[0];
      if (first) {
        setVisitStack([first.id]);
        setPhase({ kind: "page", pageId: first.id });
      } else await submitOrThanks();
      return;
    }
    if (phase.kind !== "page") return;
    const cur = walk.find((p) => p.id === phase.pageId);
    if (cur) {
      const err = validatePage(questionsOnPage(schema, cur));
      if (err) {
        setError(err);
        return;
      }
    }
    if (visitStack.length >= MAX_FLOW_STEPS) {
      await submitOrThanks();
      return;
    }
    const next = resolveNext(schema, phase.pageId, answers);
    if (next.kind === "page") {
      setVisitStack((s) => [...s, next.pageId]);
      setPhase({ kind: "page", pageId: next.pageId });
    } else await submitOrThanks();
  }, [phase, walk, schema, submitOrThanks, answers, visitStack.length]);

  const goBack = () => {
    setError(null);
    if (phase.kind === "ending") {
      const last = visitStack[visitStack.length - 1] ?? walk[walk.length - 1]?.id;
      if (last) setPhase({ kind: "page", pageId: last });
      else setPhase({ kind: "welcome" });
      return;
    }
    if (phase.kind === "page") {
      const nextStack = visitStack.slice(0, -1);
      setVisitStack(nextStack);
      const prev = nextStack[nextStack.length - 1];
      if (prev) setPhase({ kind: "page", pageId: prev });
      else setPhase({ kind: "welcome" });
    }
  };

  const choiceQ = pageQs.filter((q) => q.type === "select" || q.type === "multi_select");
  const loneChoice = choiceQ.length === 1 ? choiceQ[0] : undefined;
  const hasLongText = pageQs.some((q) => q.type === "long_text");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (e.key === "Enter" && !e.shiftKey) {
        if (hasLongText && tag === "TEXTAREA") return;
        // Enter inside an open combobox (dropdown field, phone country) picks an option, not the next page.
        if (el?.getAttribute("aria-expanded") === "true") return;
        e.preventDefault();
        void goNext();
        return;
      }
      if (!loneChoice || tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toUpperCase();
      if (k.length !== 1 || k < "A" || k > "Z") return;
      const idx = k.charCodeAt(0) - 65;
      if (idx >= loneChoice.options.length) return;
      const opt = loneChoice.options[idx];
      if (loneChoice.type === "select") setAns(loneChoice.id, opt);
      else {
        const cur = Array.isArray(answers[loneChoice.id]) ? (answers[loneChoice.id] as string[]) : [];
        setAns(loneChoice.id, cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, hasLongText, loneChoice, answers]);

  async function onPickFile(file: File, question: Extract<Question, { type: "file" }>) {
    if (mode === "preview") return;
    if (!slug) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("questionId", question.id);
      const res = await fetch("/api/public/forms/" + slug + "/files", { method: "POST", body: fd });
      const data = (await res.json()) as { uploadId?: string; error?: string };
      if (!res.ok) throw new ApiError(data.error ?? "Upload failed", res.status);
      if (!data.uploadId) throw new ApiError("Upload failed", 400);
      setAns(question.id, { uploadId: data.uploadId, name: file.name });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const firstField = pageQs.find((q) => q.type !== "statement");

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {phase.kind !== "welcome" && <Progress value={progress} className="h-1 rounded-none" />}
      {phase.kind === "welcome" && (
        <WelcomeScreen
          title={schema.welcome.title}
          description={schema.welcome.description}
          button={schema.welcome.button}
          onStart={() => void goNext()}
        />
      )}
      {phase.kind === "page" && page && (
        <QuestionScreen
          page={page}
          questions={pageQs}
          answers={answers}
          back={goBack}
          onOk={() => void goNext()}
          okLabel={isLastPage ? "Submit" : "OK"}
          error={error}
          busy={busy}
          mode={mode}
          firstFieldId={firstField?.id}
          onChange={setAns}
          onPickFile={onPickFile}
        />
      )}
      {phase.kind === "ending" && (
        <EndingScreen title={schema.ending.title} description={schema.ending.description} />
      )}
    </div>
  );
}

function WelcomeScreen(props: { title: string; description?: string; button: string; onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <h1 className="font-heading max-w-2xl text-4xl font-medium tracking-tight text-balance sm:text-5xl">
        {props.title}
      </h1>
      {props.description && (
        <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground text-pretty">{props.description}</p>
      )}
      <Button size="lg" className="mt-10 min-w-40 px-8" type="button" onClick={props.onStart}>
        {props.button}
      </Button>
    </div>
  );
}

function EndingScreen(props: { title: string; description?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-6 flex size-14 items-center justify-center rounded-full bg-muted">
        <CheckIcon className="size-7 text-foreground" />
      </div>
      <h1 className="font-heading max-w-2xl text-4xl font-medium tracking-tight text-balance sm:text-5xl">
        {props.title}
      </h1>
      {props.description && (
        <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground text-pretty">{props.description}</p>
      )}
    </div>
  );
}

function QuestionScreen(props: {
  page: FormPage;
  questions: Question[];
  answers: Record<string, unknown>;
  back: () => void;
  onOk: () => void;
  okLabel: string;
  error?: string | null;
  busy?: boolean;
  mode: "live" | "preview";
  firstFieldId?: string;
  onChange: (id: string, v: unknown) => void;
  onPickFile: (file: File, q: Extract<Question, { type: "file" }>) => void;
}) {
  const multi = props.questions.filter((q) => q.type !== "statement").length > 1;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center gap-4 px-6 py-16">
        <Button variant="ghost" size="sm" className="w-fit" type="button" aria-label="Back" onClick={props.back}>
          ← Back
        </Button>
        {(props.page.title || props.page.description) && (
          <div className="grid gap-2">
            {props.page.title && (
              <h1 className="font-heading text-3xl font-medium tracking-tight text-balance">{props.page.title}</h1>
            )}
            {props.page.description && <p className="text-muted-foreground text-pretty">{props.page.description}</p>}
          </div>
        )}
        <div className="grid gap-2">
          {props.questions.map((q) => (
            <div key={q.id} className="grid gap-3">
              <div className="grid gap-1">
                <h2
                  className={
                    multi || props.page.title
                      ? "font-heading text-xl font-medium tracking-tight text-balance"
                      : "font-heading text-3xl font-medium tracking-tight text-balance"
                  }
                >
                  {q.title}
                </h2>
                {q.description && <p className="text-muted-foreground">{q.description}</p>}
              </div>
              <Field
                q={q}
                value={props.answers[q.id]}
                onChange={(v) => props.onChange(q.id, v)}
                mode={props.mode}
                autoFocus={q.id === props.firstFieldId}
                onPickFile={props.onPickFile}
              />
            </div>
          ))}
        </div>
        {props.error && (
          <Alert variant="destructive">
            <AlertDescription>{props.error}</AlertDescription>
          </Alert>
        )}
        <div>
          <Button size="lg" className="w-fit px-6" type="button" disabled={props.busy} onClick={props.onOk}>
            {props.okLabel} <Kbd className="ml-1">↵</Kbd>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field(props: {
  q: Question;
  value: unknown;
  onChange: (v: unknown) => void;
  mode: "live" | "preview";
  autoFocus?: boolean;
  onPickFile: (file: File, q: Extract<Question, { type: "file" }>) => void;
}) {
  const { q, value, onChange } = props;
  if (q.type === "statement") return null;
  if (q.type === "short_text" || q.type === "email") {
    return (
      <Input
        autoFocus={props.autoFocus}
        className="h-11 text-base"
        type={q.type === "email" ? "email" : "text"}
        autoComplete={q.type === "email" ? "email" : undefined}
        aria-label={q.title}
        placeholder={q.placeholder}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (q.type === "phone") {
    return (
      <PhoneField
        autoFocus={props.autoFocus}
        value={value}
        onChange={(v) => onChange(v)}
        title={q.title}
        placeholder={q.placeholder}
      />
    );
  }
  if (q.type === "long_text") {
    return (
      <Textarea
        autoFocus={props.autoFocus}
        rows={5}
        className="text-base"
        aria-label={q.title}
        placeholder={q.placeholder}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (q.type === "number") {
    return (
      <Input
        autoFocus={props.autoFocus}
        className="h-11 text-base"
        type="number"
        aria-label={q.title}
        min={q.min}
        max={q.max}
        value={typeof value === "number" || typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />
    );
  }
  if (q.type === "date") {
    return (
      <Input
        autoFocus={props.autoFocus}
        className="h-11 text-base"
        type="date"
        aria-label={q.title}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (q.type === "dropdown") {
    return (
      <Combobox
        items={q.options}
        value={typeof value === "string" && value ? value : null}
        onValueChange={(v: string | null) => onChange(v ?? "")}
      >
        <ComboboxInput
          autoFocus={props.autoFocus}
          aria-label={q.title}
          placeholder="Type or pick an option"
          className="h-11 w-full text-base [&_input]:text-base"
        />
        <ComboboxContent>
          <ComboboxEmpty>No matching option.</ComboboxEmpty>
          <ComboboxList>
            {(opt: string) => (
              <ComboboxItem key={opt} value={opt}>
                {opt}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    );
  }
  if (q.type === "select" || q.type === "multi_select") {
    const selected = q.type === "select" ? value : Array.isArray(value) ? value : [];
    const isOtherValue = (v: unknown) => typeof v === "string" && (v === "Lainnya" || v.startsWith("Lainnya: "));
    const otherText = (v: unknown) => (typeof v === "string" && v.startsWith("Lainnya: ") ? v.slice("Lainnya: ".length) : "");
    const selectedHasOther =
      q.type === "select" ? isOtherValue(selected) : (selected as string[]).some(isOtherValue);
    const currentOtherText =
      q.type === "select" ? otherText(selected) : otherText((selected as string[]).find(isOtherValue));

    return (
      <div className="grid gap-2">
        <ul className="grid gap-2">
          {q.options.map((opt, i) => {
            const isOtherOption = opt === "Lainnya";
            const on = isOtherOption
              ? selectedHasOther
              : q.type === "select"
                ? selected === opt
                : (selected as string[]).includes(opt);
            return (
              <li key={opt}>
                <Button
                  type="button"
                  variant={on ? "default" : "outline"}
                  className="h-auto w-full justify-start gap-3 py-3"
                  onClick={() => {
                    if (q.type === "select") {
                      onChange(isOtherOption ? "Lainnya" : opt);
                    } else {
                      const cur = Array.isArray(value) ? (value as string[]) : [];
                      if (isOtherOption) {
                        onChange(selectedHasOther ? cur.filter((x) => !isOtherValue(x)) : [...cur, "Lainnya"]);
                      } else {
                        onChange(cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]);
                      }
                    }
                  }}
                >
                  <Kbd>{letter(i)}</Kbd>
                  {opt}
                </Button>
              </li>
            );
          })}
        </ul>
        {selectedHasOther && (
          <Input
            autoFocus
            className="h-11 text-base"
            placeholder="Tuliskan jawabanmu"
            value={currentOtherText}
            onChange={(e) => {
              const text = e.target.value;
              if (q.type === "select") {
                onChange(text ? `Lainnya: ${text}` : "Lainnya");
              } else {
                const cur = Array.isArray(value) ? (value as string[]) : [];
                const next = cur.map((x) => (isOtherValue(x) ? (text ? `Lainnya: ${text}` : "Lainnya") : x));
                onChange(next);
              }
            }}
          />
        )}
      </div>
    );
  }
  const kinds = q.accept as FileKind[];
  const labels = kinds.map((k) => FILE_KINDS[k].label).join(", ");
  const uploaded = value && typeof value === "object" && "uploadId" in value ? (value as { name?: string }) : null;
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        {labels}. Max {q.maxSizeMb} MB.
      </p>
      {props.mode === "preview" ? (
        <p className="text-sm text-muted-foreground">File picker disabled in preview.</p>
      ) : (
        <Input
          type="file"
          aria-label={q.title}
          accept={acceptAttr(kinds)}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) props.onPickFile(f, q);
          }}
        />
      )}
      {uploaded?.name && <p className="text-sm text-muted-foreground">Uploaded {uploaded.name}</p>}
    </div>
  );
}
