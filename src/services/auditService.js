import AuditLog from "../models/AuditLog.js";

/**
 * Safely and asynchronously records security and management audit logs
 */
export const logAdminAction = async ({
  req,
  action,
  targetResource,
  targetId = "",
  changes = {},
  details = "",
}) => {
  try {
    if (!req?.user) return;

    await AuditLog.create({
      actor: req.user._id,
      actorName: req.user.name || "Administrator",
      actorEmail: req.user.email || "",
      actorRole: req.user.role || "admin",
      action,
      targetResource,
      targetId: targetId ? targetId.toString() : "",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
      userAgent: req.headers["user-agent"] || "",
      changes,
      details,
    });
  } catch (err) {
    console.error("[AuditLog Error]", err.message);
  }
};
