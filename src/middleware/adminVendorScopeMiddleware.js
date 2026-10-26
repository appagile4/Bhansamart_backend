import { AppError } from "./errorMiddleware.js";

/**
 * Enforces vendor scoping for admins while granting unrestricted global access to superadmin.
 * Also strictly forbids admins from executing restricted financial operations.
 */
export const enforceAdminVendorScope = (req, res, next) => {
  if (!req.user) {
    return next(new AppError("Authentication required.", 401));
  }

  // Superadmin has unrestricted global access across all platform entities
  if (req.user.role === "superadmin") {
    req.isSuperAdmin = true;
    req.accessibleVendorIds = null; // null represents global platform scope
    return next();
  }

  // Regular Admin checks
  if (req.user.role === "admin") {
    req.isSuperAdmin = false;
    const assigned = (req.user.assignedVendors || []).map((id) => id.toString());
    req.accessibleVendorIds = assigned;

    // If query/params specifies a vendorId, verify admin has been explicitly assigned to it
    const body = req.body || {};
    const query = req.query || {};
    const params = req.params || {};

    const targetVendorId =
      params.vendorId ||
      params.id ||
      query.vendorId ||
      body.vendorId;

    if (
      targetVendorId &&
      req.baseUrl &&
      typeof req.baseUrl === "string" &&
      req.baseUrl.includes("/vendors") &&
      req.method !== "GET" &&
      !assigned.includes(targetVendorId.toString())
    ) {
      return next(
        new AppError(
          "Access denied. You are not authorized to manage this vendor.",
          403
        )
      );
    }

    return next();
  }

  return next(
    new AppError("Access denied. Management privileges required.", 403)
  );
};

/**
 * Strictly ensures that only Superadmin can access financial ledgers, payouts, bank configs, and withdrawals
 */
export const requireSuperadminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "superadmin") {
    return next(
      new AppError(
        "Forbidden. Financial operations and platform bank configurations are restricted strictly to Superadmin.",
        403
      )
    );
  }
  next();
};
