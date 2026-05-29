---
name: shadcn-ui-design
description: Use when building, editing, or reviewing UI in this project's React frontend (Vite + React 19 + shadcn/ui + Tailwind v4). Covers component-to-job mapping, UX heuristics, accessibility floor, the project's RHF+Zod+TracedForm pattern, and React purity rules. Activate whenever working on anything under `frontend/src/`.
---

# shadcn UI & UX design skill

This project's frontend is a **Vite + React 19 SPA** (no Next.js, no RSC, no Server Actions). Stack: shadcn/ui (`new-york` style, `slate` base, CSS variables on), Radix primitives, Tailwind v4, lucide-react icons, react-hook-form + Zod, sonner for toasts, react-router-dom v7, next-themes.

When you build or change UI, work through the four pillars below in order: **UX → component choice → composition → React correctness**. Skipping ahead produces code that compiles but feels wrong.

---

## 1. UX foundations — apply before writing code

Run this checklist mentally on every screen. Most of these come from Nielsen's heuristics; they are not optional polish.

- **System status is visible.** Every async action shows loading state (spinner, skeleton, or button text change like `"Saving..."`). Never leave a clicked button silent.
- **Four states minimum for any data view:** loading, empty, error, success. The empty state must say what's missing and how to add it — never just render `[]`.
- **Recognition over recall.** Don't make the user remember IDs or state from a previous screen. Show context inline (breadcrumbs, headers, selected entity name).
- **Errors are recoverable.** Every destructive action has an undo path or a confirmation. Every error tells the user *what to do next*, not just what broke.
- **Match the user's language.** Labels and microcopy use domain words (the project is a syllabus tracker for coaches and students — say "technique" and "student", not "entity" and "user").
- **Consistency.** If you introduce a new pattern (a new dialog shape, a new way to delete), check whether the codebase already has one and reuse it.
- **Minimalist by default.** Every element on screen earns its space. If a label, icon, or border doesn't aid comprehension or action, remove it.

**Microcopy rules:**
- Button labels are verbs: `Save changes`, `Add technique`, `Delete student`. Not `OK`, `Submit`, `Click here`.
- Destructive verbs are explicit: `Delete permanently`, not `Remove`.
- Empty states have two parts: what's missing + a CTA. *"No techniques assigned yet. Add one to get started."*
- Error messages name the problem and the fix: *"Name is required"* — not *"Validation failed"*.

---

## 2. Component-to-job map

shadcn/ui has many components that overlap. Pick by intent, not appearance.

### Surfaces / overlays

| Use this | When |
|---|---|
| `Dialog` | Modal task that **interrupts** the current flow (edit form, confirmation). Centered, blocks the page. |
| `Sheet` | Side-panel for **secondary or supporting** content (filters, detail view) where the user still needs page context. |
| `Popover` | Lightweight, non-modal floating content triggered by a click (date picker, color picker, small forms). |
| `DropdownMenu` | A list of **actions** triggered by a button. Not for selecting a value — that's `Select`. |
| `AlertDialog` | **Only** for confirming destructive or irreversible actions. Has explicit Cancel + Confirm. (Not yet installed — `npx shadcn@latest add alert-dialog` when first needed.) |
| `Tooltip` | Short label for an icon-only control. Never for essential information — tooltips are invisible on touch and to screen readers without `aria-describedby`. |

### Input

| Use this | When |
|---|---|
| `Input` | Single-line text. |
| `Textarea` | Multi-line. Always set `min-h-[...]` and usually `max-h-[...]` so it doesn't grow unbounded. |
| `Select` | Pick one from a **short, known** list (≤ ~10 options). |
| `Combobox` (Popover + Command) | Pick one from a **long or searchable** list. (Build via Popover + Command — no single `Combobox` component in shadcn.) |
| `RadioGroup` | Pick one from 2–5 options where seeing all choices at once aids the decision. |
| `Checkbox` | Independent boolean(s). For "select many from a list", use multiple checkboxes or a `ToggleGroup`. |
| `Switch` | Immediate-effect boolean (e.g. "Dark mode"). Not for form fields that need a Save step. |

### Feedback

| Use this | When |
|---|---|
| `toast` (sonner, via `<Toaster />` mounted once) | Transient, non-blocking confirmation or error. Default for "Saved", "Deleted", network errors. |
| Inline `FormDescription` / `FormMessage` | Per-field validation errors. Already wired through the `Form` component. |
| `AlertDialog` | Blocking confirmation **before** an irreversible action. |
| `Card` with destructive border or muted background | Persistent in-page warning/notice. (No `Alert` component installed — add if needed.) |

### Structure

| Use this | When |
|---|---|
| `Card` | Group related content with a visible boundary. |
| `Tabs` | Switch between sibling views of the same entity. Not for navigation between pages. |
| `Accordion` | Progressive disclosure of optional/secondary content on a single page. |
| `Table` | Structured tabular data with clear rows and columns. For lists of cards or simple item lists, use a flex/grid layout instead. |

---

## 3. shadcn composition rules

**Hard rules — do not violate:**

1. **Never edit files in `frontend/src/components/ui/`.** Those are owned by the shadcn CLI; edits are silently lost on regeneration. To customize, wrap in a new component under `frontend/src/components/`.
2. **Use semantic color tokens, not raw Tailwind colors.** `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-destructive`, etc. (defined in `src/index.css`). Raw colors like `bg-slate-100` break dark mode and theming.
3. **Use the `cn()` helper** from `@/lib/utils` whenever combining classes conditionally. Never string-concatenate Tailwind classes.
4. **Use `asChild`** to forward props to a different element instead of nesting interactive elements. `<Button asChild><Link to="/x">Go</Link></Button>` — not `<Button onClick={() => navigate("/x")}>`.
5. **Icons via `lucide-react`.** Size with Tailwind classes (`className="h-4 w-4"`), not the `size` prop. Always pair icon-only buttons with `<span className="sr-only">Label</span>`.
6. **Toasts via `sonner`.** Import `toast` from `sonner`. The `<Toaster />` is mounted once at the app root; don't add another.
7. **Dark mode via `next-themes`.** Don't hardcode light/dark variants beyond what semantic tokens already do for you. The `.dark` class is managed by the provider.

**Style guidance:**
- Spacing: prefer `space-y-*` / `gap-*` on a parent over margins on children. Use the responsive pattern from the codebase: `space-y-4 sm:space-y-6`.
- Mobile-first. Start with mobile classes, add `sm:`/`md:`/`lg:` as you scale up.
- Don't add a third button variant when an existing one (`default`, `secondary`, `outline`, `ghost`, `link`, `destructive`) fits.
- Limit visual weight: usually one primary action per surface. Secondary actions use `outline` or `ghost`.

---

## 4. The form pattern (this project's actual convention)

Forms in this codebase use a specific stack: shadcn `Form` (provider) + a project-local `useFormWithValidation` hook + a `TracedForm` wrapper that adds telemetry, sonner error toasts, and server-error → field-error mapping. **Use this pattern for every new form.** Do not call `useForm` directly or use a plain `<form>` — you'll lose error mapping and tracing.

```tsx
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useFormWithValidation } from './hooks/useFormErrors';
import { TracedForm } from './traced-form';

interface Values { name: string; }

export function ExampleForm({ onSubmit }: { onSubmit: (v: Values) => void }) {
  const form = useFormWithValidation<Values>({
    defaultValues: { name: '' },
  });

  const handleSubmit = async (values: Values) => {
    const response = await saveSomething(values);
    if (!response.ok) throw response; // TracedForm maps server errors back to fields
    onSubmit(values);
  };

  return (
    <Form {...form}>
      <TracedForm
        id="example_form"
        onSubmit={form.handleSubmit(handleSubmit)}
        setFieldErrors={form.setFieldErrors}
        className="space-y-4 sm:space-y-6"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>Save</Button>
        </div>
      </TracedForm>
    </Form>
  );
}
```

**Required:**
- The outer `<Form {...form}>` wires RHF context so `FormField` works.
- `TracedForm` replaces `<form>` and needs an `id` (used as the telemetry span name) and `setFieldErrors={form.setFieldErrors}`.
- Throw the `Response` (or an object with `.response`) on failure — `TracedForm` extracts validation errors and routes them to the right field, plus toasts.
- For Zod validation, pass `resolver: zodResolver(schema)` into `useFormWithValidation`. Server validation still works alongside it.

**Submit button:** disable while in-flight, show pending text (`"Saving..."`). The codebase uses a local `isSubmitting` state in some forms; `form.formState.isSubmitting` is equivalent and preferred.

See `frontend/src/components/technique-edit-form.tsx` for the canonical example.

---

## 5. Accessibility floor

Radix primitives behind shadcn give you keyboard nav, focus management, and ARIA out of the box. **Don't break that.** Concretely:

- **Every icon-only button has an accessible name.** Either `aria-label="..."` or a visually hidden span:
  ```tsx
  <Button variant="ghost" size="icon">
    <Trash className="h-4 w-4" />
    <span className="sr-only">Delete</span>
  </Button>
  ```
- **Every form input has a `<FormLabel>`.** Placeholders are not labels.
- **Every form error has a `<FormMessage />`.** Don't render errors as floating toasts only — toasts disappear and aren't tied to fields for screen readers.
- **Don't override focus rings** without a replacement. The default `focus-visible:ring-ring` is the project's standard.
- **Don't use `tabIndex={-1}`** on anything the user needs to interact with.
- **Color is not the only signal.** Status `red`/`amber`/`green` (used for techniques) must also carry a text label or icon. A colorblind user must be able to read state.
- **Dialogs need a title.** Use `<DialogTitle>` — if you want it visually hidden, wrap in `<VisuallyHidden>` from Radix, don't omit it. Screen readers announce it on open.

---

## 6. React conventions (React 19, SPA)

These are the [Rules of React](https://react.dev/reference/rules). Treat them as invariants.

- **Components are pure.** Same props → same output. No reading from globals, no `Date.now()` in render, no side effects.
- **No side effects during render.** API calls, subscriptions, DOM mutations, timers go in event handlers or `useEffect`.
- **Hooks at the top level only.** Never in loops, conditions, or after early returns. The `eslint-plugin-react-hooks` rule enforces this — fix the warning, don't suppress it.
- **Props and state are immutable.** Never mutate; always return new objects/arrays.
- **Functional components only.** PascalCase file matches the default export. Hooks files: `useThing.ts` in `components/hooks/` (note: this project keeps hooks under `components/hooks/`, not the top-level `@/hooks` alias).
- **Derive, don't sync.** Before reaching for `useEffect` to keep state in sync, ask: can I compute it from props or other state directly during render?
- **Lift state to the lowest common ancestor.** Don't put local UI state in a context just because a child needs it; pass it as a prop until that becomes painful.
- **Data fetching.** This is a SPA — no RSC. Fetch in a custom hook (see `frontend/src/components/hooks/useFetch.ts`) or in an effect colocated with the route component. Don't recommend Server Components, Server Actions, or `use()` for server data — they don't apply here.
- **Routing.** `react-router-dom` v7 — use `<Link>` for in-app navigation, never `<a href>` for internal routes. `useNavigate()` for programmatic navigation.
- **Booleans.** Prefix with `is`, `has`, `should`, `can` — matches existing code (`isSubmitting`, `canEditAll`, `isOwnTechnique`).
- **Event handlers.** Prefix with `handle` (`handleSubmit`, `handleClick`). Props that receive them prefix with `on` (`onSubmit`, `onClick`).

---

## 7. File and naming conventions

- Component files: `kebab-case.tsx` (matches existing `technique-edit-form.tsx`, `add-techniques-dialogue.tsx`). The exported component is PascalCase.
- Hooks: `useThing.ts`, camelCase file matching the export.
- Imports use the `@/` alias for `src/`. `@/components/ui/...` for shadcn primitives, `@/lib/...` for utilities and API, `@/components/...` for project components.
- One component per file unless tightly coupled (small subcomponents like `ReadOnlyField` inside `technique-edit-form.tsx` are fine).

---

## 8. Pre-flight checklist before declaring a UI task done

- [ ] Loading, empty, error, and success states all handled.
- [ ] Every async action shows pending state and is disabled while pending.
- [ ] All icon-only buttons have `sr-only` labels.
- [ ] All form fields have `FormLabel` and route errors through `FormMessage`.
- [ ] No raw color classes (`bg-slate-*`, `text-gray-*`) — semantic tokens only.
- [ ] Verified the change visually with the dev server. Type checks alone don't prove the UI works.
- [ ] Dark mode still works (toggle and check).
- [ ] Keyboard test: can I tab to every control and activate it with Enter/Space? Does Escape close dialogs?
- [ ] Mobile width (≤640px) is not broken.

---

## 9. When you're unsure

- For a component pattern: check `frontend/src/components/` for an existing example before inventing one. The codebase is small enough to skim.
- For a shadcn install: `npx shadcn@latest add <component>` from `frontend/`. Don't hand-copy from the shadcn docs — the CLI configures aliases correctly.
- For a UX decision (e.g., dialog vs sheet, toast vs inline error): re-read section 2 of this skill. If still ambiguous, ask the user which they prefer — don't guess.
