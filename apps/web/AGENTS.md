# Web Application

## Route Organization

Localized routes live under `app/[locale]/`; `app/api/` is not localized.
Within `app/[locale]/home/`: `(user)/` is the personal account, `[account]/` is
the team account (addressed by **slug, not ID**).

## Component Organization

- Route-specific: `_components/`
- Route utilities: `_lib/` (client), `_lib/server/` (server)

## Skills

For specialized implementation:
- `/service-builder` - Server side services
- `/server-action-builder` - Server actions
- `/react-form-builder` - Forms with validation

## Data Fetching

- **Server Components** (default): `getSupabaseServerClient()` - RLS enforced
- **Client Components**: `useSupabase()` hook with React Query
- **Admin Client**: Bypasses RLS - requires manual auth validation

## Cache Components

`cacheComponents: true` is enabled. Every route must produce a static shell, so
runtime data has to sit behind a boundary.

### Non-negotiables

1. NEVER `await` `params`, `searchParams`, `cookies()`, `headers()`, or a data
   fetch at the top of a page or layout. Keep the component synchronous, pass
   the promise down, and await it inside a `<Suspense>`-wrapped child.
2. NEVER put `cookies()`/`headers()` in a shared component used by many pages —
   it makes every one of them dynamic. Derive the value from context instead
   (see `PageSidebarTrigger`).
3. Client hooks that read the URL (`usePathname`, `useSearchParams`) need a
   `<Suspense>` above them. Split the component so only the URL-dependent part
   suspends — the surrounding markup should still render.
4. `use cache` is only available with `cacheComponents`. Pair it with
   `cacheLife`. NEVER use plain `use cache` on anything touching
   `getSupabaseServerClient()` — that client marks its caller request-bound.
   Use `use cache: private` or a boundary.
5. NEVER wrap a `use cache` function in React's `cache()`. They don't compose —
   the build fails with `Invalid value used as weak map key`, reported against
   `generateMetadata` rather than the loader. `use cache` already dedupes, and
   across requests rather than within one. Remove the wrapper.
6. Content routes with dynamic segments need `generateStaticParams`, and it must
   return at least one param or the build fails. Catch-all routes take an array:
   `{ slug: item.slug.split('/') }`.
7. An **unstable value** (`Date.now()`, `Math.random()`) is NOT fixed by
   `<Suspense>` — that only covers uncached data. Choose by what the value is:
   per-request → `await connection()` before it; same for everyone for a while →
   `use cache` + `cacheLife`; browser-only → `'use client'`; telemetry →
   `performance.now()`.
   - It MUST be awaited. `connection()` stalls a prerender by returning a
     promise that never resolves, so `void connection()` does nothing.
   - Put it before the line that touches the value, which is earlier than the
     stack suggests. Any auth call reads `Date.now()` to check session expiry,
     so `requireUser`, `getUser`, `isSuperAdmin` and friends all trip it. The
     stack names `GoTrueClient`, never your code.
   - Prefer the shared loader over the page. `requireUserInServerComponent` and
     the two workspace loaders cover most authenticated routes — but not the
     pages and loaders that build a client themselves. Those need their own.
     Render paths only: actions and route handlers never prerender.
8. Auth gating belongs in `proxy.ts`, not at the top of a page. Pages keep their
   own checks as defence in depth, behind a boundary.
9. `export const instant = false` is a last resort. Only `/admin` uses it.
   That one is deliberate and must stay: `AdminGuard` resolves super-admin
   status before anything renders, and on admin routes that guarantee outranks
   instant navigation. The dev overlay still reports `/admin` as blocking —
   `instant = false` only stops flagging navigations *into* the segment, not
   direct loads — so do NOT "fix" it by moving the guard behind a `<Suspense>`.
   Boundaries *inside* the guarded subtree are fine, since the guard has already
   resolved by then.
10. The `(marketing)` layout exports `ensureStatic = 'navigation'`: every page
    under it must prerender completely, or the build fails. Do NOT weaken or
    remove it to fix a build — move the per-request page out of `(marketing)`.
    The one exception is `ENABLE_STRICT_CSP=true`, where the root layout reads
    the nonce per request; then it must be removed (see `docs/security/csp.mdoc`).

### Suspense fallbacks

Match the fallback to what the region can predict:

| Region | Fallback |
| ------ | -------- |
| Known shape (table, cards, page header) | Matching skeleton from `~/components/skeletons` |
| Unknown shape, large surface (CMS content) | `ContentFallback` — reserves height, draws nothing |
| Fixed slot that resolves fast (header widget) | Small skeleton, no delay |

A suspended region reserves no space, so wrapping structure causes layout shift.
Move the boundary inward instead of drawing a bigger fallback. Skeletons use the
`Delayed` wrapper (200ms) so fast navigations paint nothing; structural
fallbacks in always-occupied slots must NOT be delayed.

### React Query must be seeded

React Query is not hydrated by default. A component gated on `useUser()` or
`usePersonalAccountData()` renders a spinner during SSR and the real content on
the client — which shows up as empty cards and hydration mismatches.

Authenticated layouts seed the cache via `QueryHydration`. If you add a client
query that gates rendering, seed it there too or pass `initialData`.

## Routes stay mounted after you navigate

Cache Components enables React's `<Activity>`. The route you navigate away from
is **not** unmounted — it stays mounted and hidden so going back is instant.
State survives; effects are torn down and re-run.

Two consequences worth knowing:

1. **Anything left open stays open.** A dialog whose action ends in `redirect()`
   was previously destroyed by the navigation, so nothing closed it. Now it is
   still open when the user returns, and its backdrop blocks the page. Close it
   yourself on the navigation — with next-safe-action that is
   `onNavigation: () => props.onClose?.()`.

   This is easy to miss because the rule lives here, in a routing section,
   while the code that needs it is a form — `packages/ui/AGENTS.md` repeats it
   under "Forms in dialogs".

   Do NOT try to solve this generically in `useAsyncDialog` with an effect
   cleanup. Cleanup also runs on ordinary unmount and on StrictMode's
   double-invoke, and many dialogs here are mounted conditionally
   (`<If condition={isOpen}><Dialog isOpen /></If>`), so closing on cleanup
   makes them unmount the instant they open.
2. **DOM selectors match twice.** The hidden route keeps its markup at zero size,
   so a `data-test` selector matches the current page and the previous one. See
   `apps/e2e/AGENTS.md` — tests must scope to `:visible`.

## Workspace Contexts

```typescript
// Personal: app/home/(user)
import { useUserWorkspace } from '@kit/accounts/hooks/use-user-workspace';

// Team: app/home/[account]
import { useTeamAccountWorkspace } from '@kit/team-accounts/hooks/use-team-account-workspace';
```

Both **suspend** — the contexts hold a promise which the hooks unwrap with
`use()`. Any component calling one needs a `<Suspense>` boundary above it, or it
suspends further up than intended. This is what lets the workspace layouts
render their shell and `children` before the workspace resolves.

## Key Config Files

| Purpose | Location |
|---------|----------|
| Feature flags | `config/feature-flags.config.ts` |
| Paths | `config/paths.config.ts` |
| Personal nav | `config/personal-account-navigation.config.tsx` |
| Team nav | `config/team-account-navigation.config.tsx` |
| i18n | `i18n/request.ts` |

## Internationalization

Always use `Trans` component:

```tsx
import { Trans } from '@kit/ui/trans';
<Trans i18nKey="namespace.key" values={{ name }} />
```

Adding a namespace takes **two** steps: create
`i18n/messages/<locale>/<namespace>.json` *and* add its name to the `namespaces`
array in `i18n/request.ts`. Miss the second and every key renders as the raw key
with no error. Key format rules live in `packages/ui/AGENTS.md`.

## Security

- Authentication enforced by middleware
- Authorization handled by RLS
- Never pass sensitive data to Client Components
- Never expose server env vars to client

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
