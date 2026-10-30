import { createPermissionRouter } from "../modules/permission/permission.routes";
import type { RequestHandler } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { Router } from "express";
import { createAuthRouter } from "../modules/auth/auth.routes";
import { createUserRouter } from "../modules/user/user.routes";
import { createOrganizationRouter } from "../modules/organization/organization.routes";
import { createIngredientRouter } from "../modules/ingredient/ingredient.routes";
import { createMenuRouter } from "../modules/menu/menu.routes";
import { createSupplyOrderRouter } from "../modules/supply-order/supply-order.routes";
import { createWarehouseRouter } from "../modules/warehouse/warehouse.routes";
import { createKitchenRouter } from "../modules/kitchen/kitchen.routes";
import { createMealAttendanceRouter } from "../modules/meal-attendance/meal-attendance.routes";
import { createFeedbackRouter } from "../modules/feedback/feedback.routes";
import { createInspectionRouter } from "../modules/inspection/inspection.routes";
import { createSupplierRouter } from "../modules/supplier/supplier.routes";
import { createAuthorityRouter } from "../modules/authority/authority.routes";
import { createClassRouter } from "../modules/class/class.routes";
import { createSourceFacilityRouter } from "../modules/source-facility/source-facility.routes";
import { createSupplierCertificationRouter } from "../modules/supplier-certification/supplier-certification.routes";
import { createRegistrationRouter } from "../modules/registration/registration.routes";
import { createSchoolSupplierRouter } from "../modules/school-supplier/school-supplier.routes";
import { createIngredientEntryRouter } from "../modules/ingredient-entry/ingredient-entry.routes";
import { createAllergyRouter } from "../modules/allergy/allergy.routes";
import { createDeliveryRouter } from "../modules/delivery/delivery.routes";
import { createDishRouter } from "../modules/dish/dish.routes";
import { createInventoryRouter } from "../modules/inventory/inventory.routes";
import { createRetainedSampleRouter } from "../modules/retained-sample/retained-sample.routes";
import { createMealAllocationRouter } from "../modules/meal-allocation/meal-allocation.routes";
import { createIngredientQualityFeedbackRouter } from "../modules/ingredient-quality-feedback/ingredient-quality-feedback.routes";
import { createReportingRouter } from "../modules/reporting/reporting.routes";
import { createFoodAnalysisRouter } from "../modules/food-analysis/food-analysis.routes";
import { createSchoolAlertRouter } from "../modules/school-alert/school-alert.routes";
import { createTraceabilityRouter } from "../modules/traceability/traceability.routes";
import { createMenuReviewRouter } from "../modules/menu-review/menu-review.routes";
import { createSchoolOverviewRouter } from "../modules/school-overview/school-overview.routes";
import { createSupplierOnboardingRouter } from "../modules/supplier-onboarding/supplier-onboarding.routes";

export function createApiRouter(authHandler: RequestHandler = authenticate) {
  const router = Router();

  // Health check endpoint
  router.get("/health", (req, res) => {
    res.json({
      status: "ok",
      service: "FoodPrint Backend API",
      architecture: "Modular Architecture",
      database: "PostgreSQL (Prisma)",
      timestamp: new Date().toISOString(),
    });
  });

  router.use(createPermissionRouter(authHandler));
  router.use(createSupplierOnboardingRouter(authHandler));
  router.use("/school-overview", createSchoolOverviewRouter(authHandler));
  router.use("/auth", createAuthRouter(undefined, authHandler));
  router.use("/users", createUserRouter(undefined, authHandler));
  router.use("/schools", createOrganizationRouter(undefined, authHandler));
  router.use("/ingredients", createIngredientRouter(undefined, authHandler));
  router.use("/menus", createMenuRouter(undefined, authHandler));
  router.use(
    "/supply-requests",
    createSupplyOrderRouter(undefined, authHandler),
  );
  router.use("/ingredient-lots", createWarehouseRouter(undefined, authHandler));
  router.use("/cooking-batches", createKitchenRouter(undefined, authHandler));
  router.use(
    "/meal-portions",
    createMealAttendanceRouter(undefined, authHandler),
  );
  router.use("/meal-complaints", createFeedbackRouter(undefined, authHandler));
  router.use(
    "/food-safety-incidents",
    createInspectionRouter(undefined, authHandler),
  );
  router.use("/suppliers", createSupplierRouter(undefined, authHandler));
  router.use(
    "/commune-food-safety-units",
    createAuthorityRouter(undefined, authHandler),
  );
  router.use("/classes", createClassRouter(undefined, authHandler));
  router.use(
    "/source-facilities",
    createSourceFacilityRouter(undefined, authHandler),
  );
  router.use(
    "/supplier-certifications",
    createSupplierCertificationRouter(undefined, authHandler),
  );
  router.use(
    "/registration-requests",
    createRegistrationRouter(undefined, authHandler),
  );
  router.use(
    "/school-supplier-relationships",
    createSchoolSupplierRouter(undefined, authHandler),
  );
  router.use(
    "/ingredient-entries",
    createIngredientEntryRouter(undefined, authHandler),
  );
  router.use("/class-allergies", createAllergyRouter(undefined, authHandler));
  router.use("/deliveries", createDeliveryRouter(undefined, authHandler));
  router.use("/dishes", createDishRouter(undefined, authHandler));
  router.use(
    "/inventory-transactions",
    createInventoryRouter(undefined, authHandler),
  );
  router.use(
    "/retained-food-samples",
    createRetainedSampleRouter(undefined, authHandler),
  );
  router.use(
    "/meal-allocations",
    createMealAllocationRouter(undefined, authHandler),
  );
  router.use(
    "/ingredient-quality-feedback",
    createIngredientQualityFeedbackRouter(undefined, authHandler),
  );
  router.use(
    "/food-safety-reports",
    createReportingRouter(undefined, authHandler),
  );
  router.use(
    "/food-analysis-results",
    createFoodAnalysisRouter(undefined, authHandler),
  );
  router.use(
    "/incident-school-alerts",
    createSchoolAlertRouter(undefined, authHandler),
  );
  router.use(
    "/traceability-anchors",
    createTraceabilityRouter(undefined, authHandler),
  );
  router.use("/menu-reviews", createMenuReviewRouter(undefined, authHandler));

  return router;
}
export default createApiRouter;
