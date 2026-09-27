import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { toast } from "sonner";
import { CopyIcon, GripVertical, LockIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field } from "@/components/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormPlayer, type PlayerScreen } from "~/player/FormPlayer";
import { FlowMap } from "~/builder/FlowMap";
import { PageLogic } from "~/builder/PageLogic";
import { unreachablePages, routingError } from "~/shared/flow";
import {
  FILE_KINDS,
  newPage,
  newQuestion,
  normalizeFormSchema,
  pageLabel,
  publishSchemaError,
  questionsOnPage,
  removePage,
  unpublishedChanges,
  type FileKind,
  type FormPage,
  type FormSchema,
  type Question,
} from "~/shared/schema";
import { slugify } from "~/shared/slug";
import { api, ApiError } from "~/lib/api";

const TYPES: Question["type"][] = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
  "select",
  "multi_select",
  "dropdown",
  "date",
  "file",
  "statement",
];

type Props = {
  formId: string;
  title: string;
  slug: string;
  published: boolean;
  schema: FormSchema;
  publishedSchema: FormSchema | null;
  onMeta: (p: { title: string; published: boolean; publishedSchema?: FormSchema | null }) => void;
};

function isQuestionScreen(s: PlayerScreen): s is { questionId: string } {
  return typeof s === "object" && "questionId" in s;
}

function isPageScreen(s: PlayerScreen): s is { pageId: string } {
  return typeof s === "object" && "pageId" in s;
}

function targetPageId(schema: FormSchema, selected: PlayerScreen): string | undefined {
  const pages = normalizeFormSchema(schema).pages;
  if (isPageScreen(selected)) return selected.pageId;
  if (isQuestionScreen(selected)) return pages.find((p) => p.questionIds.includes(selected.questionId))?.id;
  return pages[pages.length - 1]?.id;
}

function pageTitle(page: FormPage, index: number): string {
  return pageLabel(page, index);
}

function moveQuestion(schema: FormSchema, questionId: string, destPageId: string, destIndex?: number): FormSchema {
  const n = normalizeFormSchema(schema);
  const stripped = n.pages.map((p) => ({ ...p, questionIds: p.questionIds.filter((id) => id !== questionId) }));
  const dest = stripped.find((p) => p.id === destPageId);
  if (!dest) return n;
  const at = destIndex === undefined ? dest.questionIds.length : Math.max(0, Math.min(destIndex, dest.questionIds.length));
  dest.questionIds.splice(at, 0, questionId);
  return normalizeFormSchema({ ...n, pages: stripped });
}

export function Builder(props: Props) {
  const [title, setTitle] = useState(props.title);
  const [schema, setSchema] = useState<FormSchema>(() => normalizeFormSchema(props.schema));
  const [published, setPublished] = useState(props.published);
  const [selected, setSelected] = useState<PlayerScreen>("welcome");
  const [view, setView] = useState<"build" | "flow">("build");
  const [err, setErr] = useState<string | null>(null);
  const publishedTitle = useRef(props.title);
  const saved = useRef<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const publishedIds = useMemo(
    () => new Set((props.publishedSchema?.questions ?? []).map((q) => q.id)),
    [props.publishedSchema],
  );
  const diff = useMemo(() => unpublishedChanges(schema, props.publishedSchema), [schema, props.publishedSchema]);
  const canPublish = !published || diff.lines.length > 0 || title.trim() !== publishedTitle.current.trim();
  const pages = schema.pages ?? [];
  const deadPages = useMemo(() => unreachablePages(schema), [schema]);

  useEffect(() => {
    const now = JSON.stringify({ title, schema });
    if (saved.current === null) {
      saved.current = now;
      return;
    }
    if (now === saved.current) return;
    saved.current = now;
    const t = setTimeout(() => {
      void save();
    }, 600);
    return () => clearTimeout(t);
  }, [title, schema]);

  async function save() {
    setErr(null);
    try {
      await persist();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    }
  }

  function taken(exceptId?: string): Set<string> {
    const slugs = new Set<string>();
    for (const q of schema.questions) {
      if (q.type === "statement" || q.id === exceptId) continue;
      slugs.add(q.slug);
    }
    return slugs;
  }

  function patchQuestion(id: string, fn: (q: Question) => Question) {
    setSchema((s) => ({ ...s, questions: s.questions.map((q) => (q.id === id ? fn(q) : q)) }));
  }

  function patchPage(id: string, fn: (p: FormPage) => FormPage) {
    setSchema((s) => {
      const n = normalizeFormSchema(s);
      return { ...n, pages: n.pages.map((p) => (p.id === id ? fn(p) : p)) };
    });
  }

  function addQuestion(type: Question["type"]) {
    const q = newQuestion(type, taken());
    setSchema((s) => {
      const n = normalizeFormSchema(s);
      const pid = targetPageId(n, selected);
      const nextPages = n.pages.length
        ? n.pages.map((p) => (p.id === pid ? { ...p, questionIds: [...p.questionIds, q.id] } : p))
        : [newPage([q.id])];
      if (pid && !nextPages.some((p) => p.id === pid)) nextPages.push(newPage([q.id]));
      return normalizeFormSchema({ ...n, questions: [...n.questions, q], pages: nextPages });
    });
    setSelected({ questionId: q.id });
  }

  function duplicateQuestion(id: string) {
    const src = schema.questions.find((q) => q.id === id);
    if (!src) return;
    const copy: Question = { ...src, id: crypto.randomUUID(), retired: undefined };
    if (copy.type !== "statement") copy.slug = slugify(copy.title, taken());
    setSchema((s) => {
      const n = normalizeFormSchema(s);
      const pages = n.pages.map((p) => {
        const at = p.questionIds.indexOf(id);
        if (at < 0) return p;
        return { ...p, questionIds: [...p.questionIds.slice(0, at + 1), copy.id, ...p.questionIds.slice(at + 1)] };
      });
      return normalizeFormSchema({ ...n, questions: [...n.questions, copy], pages });
    });
    setSelected({ questionId: copy.id });
  }

  function addPage() {
    const page = newPage([]);
    setSchema((s) => {
      const n = normalizeFormSchema(s);
      const pid = targetPageId(n, selected);
      const idx = n.pages.findIndex((p) => p.id === pid);
      const pages = [...n.pages];
      pages.splice(idx >= 0 ? idx + 1 : pages.length, 0, page);
      return { ...n, pages };
    });
    setSelected({ pageId: page.id });
  }

  function deletePage(pageId: string) {
    const n = normalizeFormSchema(schema);
    const idx = n.pages.findIndex((p) => p.id === pageId);
    const dest = (idx > 0 ? n.pages[idx - 1] : n.pages[idx + 1]) ?? undefined;
    setSchema((s) => removePage(s, pageId));
    setSelected(dest ? { pageId: dest.id } : "welcome");
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId.startsWith("page:") && overId.startsWith("page:")) {
      setSchema((s) => {
        const n = normalizeFormSchema(s);
        const fromIdx = n.pages.findIndex((p) => `page:${p.id}` === activeId);
        const toIdx = n.pages.findIndex((p) => `page:${p.id}` === overId);
        if (fromIdx < 0 || toIdx < 0) return n;
        return normalizeFormSchema({ ...n, pages: arrayMove(n.pages, fromIdx, toIdx) });
      });
      return;
    }
    if (activeId.startsWith("page:")) return;
    setSchema((s) => {
      const n = normalizeFormSchema(s);
      const from = n.pages.find((p) => p.questionIds.includes(activeId));
      const toPageId = overId.startsWith("page:")
        ? overId.slice(5)
        : n.pages.find((p) => p.questionIds.includes(overId))?.id;
      const to = n.pages.find((p) => p.id === toPageId);
      if (!from || !to) return n;
      if (from.id === to.id && !overId.startsWith("page:")) {
        const ids = arrayMove(from.questionIds, from.questionIds.indexOf(activeId), from.questionIds.indexOf(overId));
        return normalizeFormSchema({ ...n, pages: n.pages.map((p) => (p.id === from.id ? { ...p, questionIds: ids } : p)) });
      }
      const destIndex = overId.startsWith("page:") ? to.questionIds.filter((id) => id !== activeId).length : undefined;
      const insertAt = destIndex ?? to.questionIds.filter((id) => id !== activeId).indexOf(overId);
      return moveQuestion(n, activeId, to.id, insertAt < 0 ? to.questionIds.length : insertAt);
    });
  }

  async function persist() {
    await api("/api/forms/" + props.formId, {
      method: "PUT",
      body: JSON.stringify({ title, schema: normalizeFormSchema(schema) }),
    });
    saved.current = JSON.stringify({ title, schema });
    props.onMeta({ title, published });
  }

  async function publishLive() {
    setErr(null);
    const pubErr = publishSchemaError(schema) ?? routingError(schema);
    if (pubErr) {
      setErr(pubErr);
      return;
    }
    try {
      await persist();
      await api("/api/forms/" + props.formId + "/publish", {
        method: "POST",
        body: JSON.stringify({ published: true }),
      });
      setPublished(true);
      publishedTitle.current = title;
      props.onMeta({ title, published: true, publishedSchema: schema });
      toast.success("Published");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Publish failed");
    }
  }

  async function unpublish() {
    setErr(null);
    try {
      await api("/api/forms/" + props.formId + "/publish", {
        method: "POST",
        body: JSON.stringify({ published: false }),
      });
      setPublished(false);
      props.onMeta({ title, published: false });
      toast.success("Unpublished");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Unpublish failed");
    }
  }

  const inspectPage = isPageScreen(selected) ? pages.find((p) => p.id === selected.pageId) : undefined;
  const inspectQuestion = isQuestionScreen(selected)
    ? schema.questions.find((q) => q.id === selected.questionId)
    : undefined;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Input
          aria-label="Form title"
          className="max-w-xs"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {err && (
          <Alert variant="destructive" className="min-w-0 flex-1">
            <AlertDescription>{err}</AlertDescription>
          </Alert>
        )}
        {deadPages.length > 0 && !err && (
          <Alert className="min-w-0 flex-1">
            <AlertDescription>
              Unreachable: {deadPages.map((p, i) => pageTitle(p, pages.indexOf(p) >= 0 ? pages.indexOf(p) : i)).join(", ")}
            </AlertDescription>
          </Alert>
        )}
        <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
          <div className="flex rounded-lg border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={view === "build" ? "secondary" : "ghost"}
              onClick={() => setView("build")}
            >
              Build
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === "flow" ? "secondary" : "ghost"}
              onClick={() => setView("flow")}
            >
              Flow
            </Button>
          </div>
          {canPublish && (
            <Button type="button" onClick={() => void publishLive()}>
              {published ? "Publish changes" : "Publish"}
            </Button>
          )}
          {published && (
            <Button type="button" variant="outline" onClick={() => void unpublish()}>
              Unpublish
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const url = window.location.origin + "/f/" + props.slug;
              void navigator.clipboard.writeText(url).then(
                () => toast.success("Link copied"),
                () => toast.message(url),
              );
            }}
          >
            Copy link
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto overflow-y-hidden">
      <div className="grid min-h-0 min-w-[56rem] flex-1 grid-cols-[16rem_minmax(0,1fr)_18rem] grid-rows-[minmax(0,1fr)] overflow-hidden">
      <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r bg-card">
        <div className="min-h-0 min-w-0 flex-1 basis-0 overflow-x-hidden overflow-y-auto overscroll-y-contain">
          <div className="grid min-w-0 gap-1 p-3">
            <Button
              type="button"
              variant={selected === "welcome" ? "secondary" : "ghost"}
              className="h-auto min-w-0 justify-start py-2"
              onClick={() => setSelected("welcome")}
            >
              <span className="min-w-0 flex-1 truncate text-left">Welcome</span>
              {diff.welcome ? (
                <Badge variant="secondary" className="ml-2 shrink-0">
                  Edited
                </Badge>
              ) : null}
            </Button>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={pages.map((p) => `page:${p.id}`)}
                strategy={verticalListSortingStrategy}
              >
                {pages.map((page, i) => (
                  <PageRow
                    key={page.id}
                    page={page}
                    index={i}
                    selected={isPageScreen(selected) && selected.pageId === page.id}
                    edited={diff.pages && Boolean(page.title || page.description)}
                    onSelect={() => setSelected({ pageId: page.id })}
                  >
                    <SortableContext items={page.questionIds} strategy={verticalListSortingStrategy}>
                      {questionsOnPage(schema, page).map((q) => (
                        <SortRow
                          key={q.id}
                          q={q}
                          mark={
                            publishedIds.has(q.id)
                              ? diff.questionIds.has(q.id)
                                ? "Edited"
                                : undefined
                              : props.publishedSchema
                                ? "New"
                                : undefined
                          }
                          on={isQuestionScreen(selected) && selected.questionId === q.id}
                          onClick={() => setSelected({ questionId: q.id })}
                          onDuplicate={() => duplicateQuestion(q.id)}
                        />
                      ))}
                    </SortableContext>
                  </PageRow>
                ))}
              </SortableContext>
            </DndContext>
            <Button
              type="button"
              variant={selected === "ending" ? "secondary" : "ghost"}
              className="h-auto min-w-0 justify-start py-2"
              onClick={() => setSelected("ending")}
            >
              <span className="min-w-0 flex-1 truncate text-left">Ending</span>
              {diff.ending ? (
                <Badge variant="secondary" className="ml-2 shrink-0">
                  Edited
                </Badge>
              ) : null}
            </Button>
          </div>
        </div>
        <div className="grid shrink-0 gap-2 border-t bg-card p-3">
          <Button type="button" variant="outline" onClick={addPage}>
            Add page
          </Button>
          <Select value="" onValueChange={(t) => addQuestion(t as Question["type"])}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Add question" />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </aside>
      <div className="h-full min-h-0 overflow-hidden bg-muted/30">
        {view === "flow" ? (
          <FlowMap schema={schema} selected={selected} onSelect={setSelected} onChange={setSchema} />
        ) : (
          <FormPlayer mode="preview" schema={schema} screen={selected} />
        )}
      </div>
      <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l bg-card">
        <ScrollArea className="min-h-0 size-full flex-1">
          <div className="grid gap-4 p-4">
            {selected === "welcome" && (
              <>
                <Field label="Headline">
                  <Input
                    value={schema.welcome.title}
                    onChange={(e) => setSchema((s) => ({ ...s, welcome: { ...s.welcome, title: e.target.value } }))}
                  />
                </Field>
                <Field label="Description">
                  <Textarea
                    rows={3}
                    value={schema.welcome.description ?? ""}
                    onChange={(e) =>
                      setSchema((s) => ({ ...s, welcome: { ...s.welcome, description: e.target.value || undefined } }))
                    }
                  />
                </Field>
                <Field label="Button">
                  <Input
                    value={schema.welcome.button}
                    onChange={(e) => setSchema((s) => ({ ...s, welcome: { ...s.welcome, button: e.target.value } }))}
                  />
                </Field>
              </>
            )}
            {selected === "ending" && (
              <>
                <Field label="Headline">
                  <Input
                    value={schema.ending.title}
                    onChange={(e) => setSchema((s) => ({ ...s, ending: { ...s.ending, title: e.target.value } }))}
                  />
                </Field>
                <Field label="Description">
                  <Textarea
                    rows={3}
                    value={schema.ending.description ?? ""}
                    onChange={(e) =>
                      setSchema((s) => ({ ...s, ending: { ...s.ending, description: e.target.value || undefined } }))
                    }
                  />
                </Field>
              </>
            )}
            {inspectPage && (
              <>
                <Field label="Page title">
                  <Input
                    value={inspectPage.title ?? ""}
                    placeholder={pageTitle(inspectPage, pages.indexOf(inspectPage))}
                    onChange={(e) =>
                      patchPage(inspectPage.id, (p) => ({ ...p, title: e.target.value || undefined }))
                    }
                  />
                </Field>
                <Field label="Page description">
                  <Textarea
                    rows={3}
                    value={inspectPage.description ?? ""}
                    onChange={(e) =>
                      patchPage(inspectPage.id, (p) => ({ ...p, description: e.target.value || undefined }))
                    }
                  />
                </Field>
                <PageLogic schema={schema} page={inspectPage} onChange={(fn) => patchPage(inspectPage.id, fn)} />
                {pages.length > 1 && (
                  <Button type="button" variant="destructive" onClick={() => deletePage(inspectPage.id)}>
                    Delete page
                  </Button>
                )}
              </>
            )}
            {inspectQuestion && (
              <QuestionInspect
                q={inspectQuestion}
                lockedType={publishedIds.has(inspectQuestion.id)}
                taken={taken(inspectQuestion.id)}
                pages={pages}
                currentPageId={targetPageId(schema, selected)}
                onMovePage={(pageId) => {
                  setSchema((s) => moveQuestion(s, inspectQuestion.id, pageId));
                }}
                onChange={(fn) => patchQuestion(inspectQuestion.id, fn)}
                onRetire={() => patchQuestion(inspectQuestion.id, (q) => ({ ...q, retired: !q.retired }))}
                onDelete={
                  publishedIds.has(inspectQuestion.id)
                    ? undefined
                    : () => {
                        const page = pages.find((p) => p.questionIds.includes(inspectQuestion.id));
                        const ids = page?.questionIds ?? [];
                        const at = ids.indexOf(inspectQuestion.id);
                        const sibling = ids[at - 1] ?? ids[at + 1];
                        setSchema((s) => {
                          const n = normalizeFormSchema(s);
                          return normalizeFormSchema({
                            ...n,
                            questions: n.questions.filter((x) => x.id !== inspectQuestion.id),
                            pages: n.pages.map((p) => ({
                              ...p,
                              questionIds: p.questionIds.filter((id) => id !== inspectQuestion.id),
                            })),
                          });
                        });
                        setSelected(sibling ? { questionId: sibling } : page ? { pageId: page.id } : "welcome");
                      }
                }
              />
            )}
          </div>
        </ScrollArea>
      </aside>
      </div>
      </div>
    </div>
  );
}

function DragHandle(props: { label: string } & ComponentProps<"button">) {
  const { label, className, ...rest } = props;
  return (
    <button
      type="button"
      className={cn(
        "flex shrink-0 touch-none cursor-grab items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing",
        className,
      )}
      aria-label={label}
      {...rest}
    >
      <GripVertical className="size-3.5" />
    </button>
  );
}

function PageRow(props: {
  page: FormPage;
  index: number;
  selected: boolean;
  edited?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  const sortableId = `page:${props.page.id}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sortableId });
  return (
    <div
      ref={setNodeRef}
      className={cn("grid gap-1", isDragging && "opacity-60")}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="mt-1 flex min-w-0 items-center gap-0.5">
        <DragHandle label="Drag to reorder page" {...attributes} {...listeners} />
        <Button
          type="button"
          variant={props.selected ? "secondary" : "ghost"}
          className="h-auto min-w-0 flex-1 justify-start py-2 font-medium"
          onClick={props.onSelect}
        >
          <span className="min-w-0 flex-1 truncate text-left">{pageTitle(props.page, props.index)}</span>
          {props.edited ? (
            <Badge variant="secondary" className="ml-2 shrink-0">
              Edited
            </Badge>
          ) : null}
        </Button>
      </div>
      <div className="pl-2 min-w-0">{props.children}</div>
    </div>
  );
}

function SortRow(props: {
  q: Question;
  on: boolean;
  mark?: "New" | "Edited";
  onClick: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.q.id });
  return (
    <div
      ref={setNodeRef}
      className={cn("flex min-w-0 items-center gap-0.5", isDragging && "opacity-60")}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <DragHandle label="Drag to reorder question" {...attributes} {...listeners} />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button
            type="button"
            variant={props.on ? "secondary" : "ghost"}
            className="h-auto min-w-0 flex-1 justify-start py-2 text-left"
            onClick={props.onClick}
          >
            <span className="min-w-0 flex-1 truncate">
              {props.q.retired ? <Badge variant="outline" className="mr-2">Retired</Badge> : null}
              {props.q.title.trim() || "Untitled"}
            </span>
            {props.mark ? (
              <Badge variant="secondary" className="ml-2 shrink-0">
                {props.mark}
              </Badge>
            ) : null}
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={props.onDuplicate}>
            <CopyIcon />
            Duplicate
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function QuestionInspect(props: {
  q: Question;
  lockedType: boolean;
  taken: Set<string>;
  pages: FormPage[];
  currentPageId?: string;
  onMovePage: (pageId: string) => void;
  onChange: (fn: (q: Question) => Question) => void;
  onRetire: () => void;
  onDelete?: () => void;
}) {
  const { q } = props;
  return (
    <>
      {props.pages.length > 1 && props.currentPageId && (
        <Field label="Page">
          <Select value={props.currentPageId} onValueChange={props.onMovePage}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.pages.map((p, i) => (
                <SelectItem key={p.id} value={p.id}>
                  {pageTitle(p, i)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field label="Title">
        <Input
          value={q.title}
          placeholder="Question title"
          onChange={(e) => {
            const title = e.target.value;
            props.onChange((prev) => {
              if (prev.type === "statement" || props.lockedType) return { ...prev, title };
              return { ...prev, title, slug: slugify(title, props.taken) };
            });
          }}
        />
      </Field>
      <Field label="Description">
        <Textarea
          rows={3}
          value={q.description ?? ""}
          onChange={(e) => props.onChange((prev) => ({ ...prev, description: e.target.value || undefined }))}
        />
      </Field>
      {"slug" in q && (
        <Field
          label={props.lockedType ? "Slug · locked" : "Slug · read only"}
          hint={
            props.lockedType
              ? "Locked after publish"
              : "Generated from the title as you type"
          }
        >
          <div className="relative">
            <Input
              value={q.slug}
              readOnly
              aria-readonly="true"
              className="cursor-default bg-muted/50 pr-8 text-muted-foreground"
            />
            {props.lockedType ? (
              <LockIcon className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            ) : null}
          </div>
        </Field>
      )}
      <Field label="Type">
        <Select
          value={q.type}
          disabled={props.lockedType}
          onValueChange={(type) => {
            const fresh = newQuestion(type as Question["type"], new Set());
            props.onChange((prev) => {
              const next = { ...fresh, id: prev.id, title: prev.title };
              if (next.type !== "statement") next.slug = slugify(prev.title, props.taken);
              return next;
            });
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {"required" in q && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={q.required}
            onCheckedChange={(c) =>
              props.onChange((prev) => ("required" in prev ? { ...prev, required: Boolean(c) } : prev))
            }
          />
          Required
        </label>
      )}
      {"placeholder" in q && (
        <Field label="Placeholder">
          <Input
            value={q.placeholder ?? ""}
            onChange={(e) =>
              props.onChange((prev) =>
                "placeholder" in prev ? { ...prev, placeholder: e.target.value || undefined } : prev,
              )
            }
          />
        </Field>
      )}
      {q.type === "short_text" && (
        <Field label="Validation regex" hint="Optional. Answers must match this pattern (JavaScript RegExp syntax).">
          <Input
            value={q.regex ?? ""}
            onChange={(e) =>
              props.onChange((prev) =>
                prev.type === "short_text" ? { ...prev, regex: e.target.value || undefined } : prev,
              )
            }
          />
        </Field>
      )}
      {q.type === "number" && (
        <>
          <Field label="Min">
            <Input
              type="number"
              value={q.min ?? ""}
              onChange={(e) =>
                props.onChange((prev) =>
                  prev.type === "number" ? { ...prev, min: e.target.value === "" ? undefined : Number(e.target.value) } : prev,
                )
              }
            />
          </Field>
          <Field label="Max">
            <Input
              type="number"
              value={q.max ?? ""}
              onChange={(e) =>
                props.onChange((prev) =>
                  prev.type === "number" ? { ...prev, max: e.target.value === "" ? undefined : Number(e.target.value) } : prev,
                )
              }
            />
          </Field>
        </>
      )}
      {(q.type === "select" || q.type === "multi_select" || q.type === "dropdown") && (
        <Field label="Options (one per line)" hint={q.type === "dropdown" ? "Up to 500. Respondents can type to search." : undefined}>
          <Textarea
            rows={6}
            value={q.options.join("\n")}
            onChange={(e) => {
              const options = e.target.value.split("\n");
              props.onChange((prev) =>
                prev.type === "select" || prev.type === "multi_select" || prev.type === "dropdown"
                  ? { ...prev, options }
                  : prev,
              );
            }}
          />
        </Field>
      )}
      {q.type === "file" && (
        <>
          <Field label="Max size (MB)">
            <Input
              type="number"
              min={1}
              max={25}
              value={q.maxSizeMb}
              onChange={(e) =>
                props.onChange((prev) =>
                  prev.type === "file"
                    ? { ...prev, maxSizeMb: Math.min(25, Math.max(1, Number(e.target.value) || 1)) }
                    : prev,
                )
              }
            />
          </Field>
          <fieldset className="grid gap-2">
            <Label>Accepted types</Label>
            {(Object.keys(FILE_KINDS) as FileKind[]).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={q.accept.includes(k)}
                  onCheckedChange={(checked) => {
                    props.onChange((prev) => {
                      if (prev.type !== "file") return prev;
                      const accept = checked ? [...prev.accept, k] : prev.accept.filter((x) => x !== k);
                      return { ...prev, accept: accept.length ? accept : prev.accept };
                    });
                  }}
                />
                {FILE_KINDS[k].label}
              </label>
            ))}
          </fieldset>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {props.onDelete ? (
          <Button type="button" variant="destructive" onClick={props.onDelete}>
            Delete
          </Button>
        ) : (
          <Button
            type="button"
            variant={q.retired ? "outline" : "destructive"}
            onClick={props.onRetire}
          >
            {q.retired ? "Unretire" : "Retire"}
          </Button>
        )}
      </div>
    </>
  );
}
