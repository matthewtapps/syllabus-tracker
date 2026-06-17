import { Link, useLocation } from "react-router-dom";
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
import { buildCrumbChain } from "./breadcrumb-config";
import { useBreadcrumbLabels } from "./use-breadcrumb-labels";

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
  const chain = buildCrumbChain(location.pathname, user.role);

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
