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

/** Initial read-only samples; tenant-specific permissions need an approved policy. */
export const schoolAdminOnly: RequestHandler[] = [
  authenticate,
  requireOrg([ORG_TYPES.SCHOOL]),
  requireRoles([ROLES.SCHOOL_ADMINISTRATION]),
];

/** Initial read-only samples; tenant-specific permissions need an approved policy. */
export const schoolKitchenStaffOnly: RequestHandler[] = [
  authenticate,
  requireOrg([ORG_TYPES.SCHOOL]),
  requireRoles([ROLES.SCHOOL_KITCHEN_STAFF]),
];

/** Initial read-only samples; tenant-specific permissions need an approved policy. */
export const schoolHealthStaffOnly: RequestHandler[] = [
  authenticate,
  requireOrg([ORG_TYPES.SCHOOL]),
  requireRoles([ROLES.SCHOOL_HEALTH_OFFICER]),
];

/** Initial read-only samples; tenant-specific permissions need an approved policy. */
export const schoolManagementBoardOnly: RequestHandler[] = [
  authenticate,
  requireOrg([ORG_TYPES.SCHOOL]),
  requireRoles([ROLES.SCHOOL_MANAGEMENT_BOARD]),
];

/** Initial read-only samples; tenant-specific permissions need an approved policy. */
export const homeroomTeacherOnly: RequestHandler[] = [
  authenticate,
  requireOrg([ORG_TYPES.SCHOOL]),
  requireRoles([ROLES.HOMEROOM_TEACHER]),
];

export const parentsCommitteeOnly: RequestHandler[] = [
  authenticate,
  requireOrg([ORG_TYPES.SCHOOL]),
  requireRoles([ROLES.PARENTS_COMMITTEE]),
];

/** Initial read-only samples; tenant-specific permissions need an approved policy. */
export const ingredientManagementOnly: RequestHandler[] = [
  authenticate,
  requireOrg([ORG_TYPES.SCHOOL]),
  requireRoles([ROLES.INGREDIENT_MANAGEMENT]),
];

/** Initial read-only samples; tenant-specific permissions need an approved policy. */
export const ingredientSupplierAdminOnly: RequestHandler[] = [
  authenticate,
  requireOrg([ORG_TYPES.SUPPLIER]),
  requireRoles([ROLES.INGREDIENT_SUPPLIER_ADMIN]),
];

/** Initial read-only samples; tenant-specific permissions need an approved policy. */
export const ingredientSupplierStaffOnly: RequestHandler[] = [
  authenticate,
  requireOrg([ORG_TYPES.SUPPLIER]),
  requireRoles([ROLES.INGREDIENT_SUPPLIER_STAFF]),
];

/** Initial read-only samples; tenant-specific permissions need an approved policy. */
export const communeHealthOfficerOnly: RequestHandler[] = [
  authenticate,
  requireOrg([ORG_TYPES.AUTHORITY]),
  requireRoles([ROLES.COMMUNE_FOOD_SAFETY_OFFICER]),
];
