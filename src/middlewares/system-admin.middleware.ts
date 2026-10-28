import type { RequestHandler } from "express";
import { ORG_TYPES, ROLES } from "../constants/roles";
import { authenticate } from "./auth.middleware";
import { requireOrg, requireRoles } from "./role.middleware";

/** Initial read-only samples; tenant-specific permissions need an approved policy. */
export const systemAdminOnly: RequestHandler[] = [
  authenticate,
  requireOrg([ORG_TYPES.SYSTEM]),
  requireRoles([ROLES.SYSTEM_ADMIN]),
];
