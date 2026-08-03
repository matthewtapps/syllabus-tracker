import { Link, matchPath, useLocation } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUser } from "@/lib/current-user-context";
import { useCamp } from "@/lib/queries";
import { buildCrumbChain, type RawCrumb } from "./breadcrumb-config";
import { useBreadcrumbLabels } from "./use-breadcrumb-labels";

/**
 * Builds the breadcrumb chain for the camp-detail route `/camps/:id`.
 *
 * This route is special-cased rather than driven by `CRUMB_DEFS` because the
 * student id it needs to link back to (`/student/<sid>/...`) lives in the camp
 * data, NOT the URL. The generic builder fills every pattern in a chain from a
 * single `matchedParams` map, so routing `/camps/:id` through the `:id`-based
 * student patterns would substitute the CAMP id as the STUDENT id (a wrong
 * link). Here we build each crumb's `to` path by hand from the resolved student
 * id, so there is no param collision.
 *
 * Crumbs carry `params.id = studentId` (which the existing `studentName`
 * resolver keys off on `/student/...` patterns) and `params.campId = campId`
 * (which the `campName` resolver keys off). Dynamic labels are left unresolved;
 * `useBreadcrumbLabels` fills them.
 *
 * While the camp is still loading `studentId` is undefined, so we render a
 * shallow `Dashboard > {campName}` fallback (campName itself resolves once the
 * camp loads), avoiding a flash of wrong student links.
 */
function buildCampDetailChain(
  campId: number,
  studentId: number | undefined,
  role: string,
  /** A camp item route (`/camps/:id/techniques/:techniqueId`, `.../threads/:threadId`)
   *  appends one more crumb under the camp; absent on the camp page itself. */
  item?: RawCrumb,
): RawCrumb[] {
  const campIdStr = String(campId);
  const dashboard: RawCrumb = {
    pattern: "/dashboard",
    params: { campId: campIdStr },
    to: "/dashboard",
    staticLabel: "Dashboard",
  };
  const campCurrent: RawCrumb = {
    pattern: "/camps/:id",
    params: { campId: campIdStr },
    to: `/camps/${campIdStr}`,
    dynamic: "campName",
  };

  if (studentId === undefined) {
    // Camp not loaded yet: shallow fallback, no (wrong) student links.
    return item ? [dashboard, campCurrent, item] : [dashboard, campCurrent];
  }

  const sid = String(studentId);
  const chain: RawCrumb[] = [dashboard];

  if (role !== "student") {
    chain.push({
      pattern: "/students",
      params: { id: sid, campId: campIdStr },
      to: "/students",
      staticLabel: "Students",
    });
  }

  chain.push(
    {
      pattern: "/student/:id",
      params: { id: sid, campId: campIdStr },
      to: `/student/${sid}`,
      dynamic: "studentName",
    },
    {
      pattern: "/student/:id/camps",
      params: { id: sid, campId: campIdStr },
      to: `/student/${sid}/camps`,
      staticLabel: "Camps",
    },
    campCurrent,
  );
  if (item) chain.push(item);

  return chain;
}

/**
 * Renders a URL-hierarchy breadcrumb trail for the current location.
 *
 * Returns null when the chain has 1 or fewer entries (top-level pages
 * don't need a breadcrumb).
 *
 * On >= sm screens the full trail is shown. On mobile the trail is kept to a
 * single line: when it's deeper than two levels the leading crumbs collapse
 * into an ellipsis dropdown, leaving the immediate parent and the current
 * page visible (the current page truncates so a long title can't overflow).
 */
export function AppBreadcrumbs() {
  const location = useLocation();
  const user = useUser();

  // Camp-detail (`/camps/:id`) is special-cased: its student id comes from camp
  // data, not the URL. Detect it and parse the camp id. `useCamp` is called
  // UNCONDITIONALLY (gated on a valid id) so rules of hooks hold on every route;
  // off the camp route the id is undefined and the query is disabled.
  //
  // The camp's item routes (a technique or a thread inside the camp) hang off
  // the same chain with one crumb appended, so a camp item page carries the
  // whole path back to the camp and the student.
  const campMatch = matchPath({ path: "/camps/:id", end: true }, location.pathname);
  const campTechniqueMatch = matchPath(
    { path: "/camps/:id/techniques/:techniqueId", end: true },
    location.pathname,
  );
  const campThreadMatch = matchPath(
    { path: "/camps/:id/threads/:threadId", end: true },
    location.pathname,
  );
  const campIdRaw =
    campMatch?.params.id ?? campTechniqueMatch?.params.id ?? campThreadMatch?.params.id;
  const campId =
    campIdRaw !== undefined && /^\d+$/.test(campIdRaw) ? Number(campIdRaw) : undefined;
  const campQuery = useCamp(campId);

  let campItem: RawCrumb | undefined;
  if (campId !== undefined && campTechniqueMatch?.params.techniqueId !== undefined) {
    const techniqueId = campTechniqueMatch.params.techniqueId;
    campItem = {
      pattern: "/camps/:id/techniques/:techniqueId",
      params: { campId: String(campId), techniqueId },
      to: `/camps/${campId}/techniques/${techniqueId}`,
      dynamic: "campTechniqueName",
    };
  } else if (campId !== undefined && campThreadMatch?.params.threadId !== undefined) {
    const threadId = campThreadMatch.params.threadId;
    campItem = {
      pattern: "/camps/:id/threads/:threadId",
      params: { campId: String(campId) },
      to: `/camps/${campId}/threads/${threadId}`,
      staticLabel: "Discussion",
    };
  }

  const chain =
    campId !== undefined
      ? buildCampDetailChain(campId, campQuery.data?.student_id, user.role, campItem)
      : buildCrumbChain(location.pathname, user.role);

  // All resolver hooks must be called unconditionally (rules of hooks),
  // even when chain is empty or short.
  const resolveLabel = useBreadcrumbLabels(chain);

  if (chain.length <= 1) return null;

  const labels = chain.map((c) => resolveLabel(c));
  const lastIdx = chain.length - 1;
  // Leading crumbs that get tucked into the mobile ellipsis dropdown
  // (everything except the parent and the current page).
  const collapsed = chain.slice(0, Math.max(0, lastIdx - 1));

  return (
    <nav className="container mx-auto px-4 pt-4 sm:px-6">
      {/* Desktop / tablet: full trail. */}
      <Breadcrumb className="hidden sm:block">
        <BreadcrumbList>
          {chain.map((crumb, idx) => {
            const isLast = idx === lastIdx;
            return (
              <BreadcrumbItem key={crumb.pattern}>
                {isLast ? (
                  <BreadcrumbPage>{labels[idx]}</BreadcrumbPage>
                ) : (
                  <>
                    <BreadcrumbLink asChild>
                      <Link to={crumb.to}>{labels[idx]}</Link>
                    </BreadcrumbLink>
                    <BreadcrumbSeparator />
                  </>
                )}
              </BreadcrumbItem>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>

      {/* Mobile: single line; collapse the middle into a dropdown. */}
      <Breadcrumb className="sm:hidden">
        <BreadcrumbList className="flex-nowrap">
          {collapsed.length > 0 && (
            <>
              <BreadcrumbItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none"
                    aria-label="Show full navigation path"
                  >
                    <BreadcrumbEllipsis />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {collapsed.map((crumb, idx) => (
                      <DropdownMenuItem key={crumb.pattern} asChild>
                        <Link to={crumb.to}>{labels[idx]}</Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </>
          )}

          {/* Immediate parent (omitted only on a 1-level-deep chain, which
           *  can't happen here since chain.length >= 2 below the guard). */}
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbLink asChild className="max-w-[9rem] truncate">
              <Link to={chain[lastIdx - 1].to}>{labels[lastIdx - 1]}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />

          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="max-w-[12rem] truncate">
              {labels[lastIdx]}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </nav>
  );
}
