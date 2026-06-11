import { Link, useLocation } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useUser } from "@/lib/current-user-context";
import { buildCrumbChain } from "./breadcrumb-config";
import { useBreadcrumbLabels } from "./use-breadcrumb-labels";

/**
 * Renders a URL-hierarchy breadcrumb trail for the current location.
 *
 * Returns null when the chain has 1 or fewer entries (top-level pages
 * don't need a breadcrumb). Mount this in Layout once Part 2 lands.
 */
export function AppBreadcrumbs() {
  const location = useLocation();
  const user = useUser();
  const chain = buildCrumbChain(location.pathname, user.role);

  // All resolver hooks must be called unconditionally (rules of hooks),
  // even when chain is empty or short.
  const resolveLabel = useBreadcrumbLabels(chain);

  if (chain.length <= 1) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {chain.map((crumb, idx) => {
          const label = resolveLabel(crumb);
          const isLast = idx === chain.length - 1;

          return (
            <BreadcrumbItem key={crumb.pattern}>
              {isLast ? (
                <BreadcrumbPage>{label}</BreadcrumbPage>
              ) : (
                <>
                  <BreadcrumbLink asChild>
                    <Link to={crumb.to}>{label}</Link>
                  </BreadcrumbLink>
                  <BreadcrumbSeparator />
                </>
              )}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
