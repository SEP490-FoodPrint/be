import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import userRoutes from "../modules/user/user.routes";
import organizationRoutes from "../modules/organization/organization.routes";
import ingredientRoutes from "../modules/ingredient/ingredient.routes";
import menuRoutes from "../modules/menu/menu.routes";
import supplyOrderRoutes from "../modules/supply-order/supply-order.routes";
import warehouseRoutes from "../modules/warehouse/warehouse.routes";
import kitchenRoutes from "../modules/kitchen/kitchen.routes";
import mealAttendanceRoutes from "../modules/meal-attendance/meal-attendance.routes";
import feedbackRoutes from "../modules/feedback/feedback.routes";
import inspectionRoutes from "../modules/inspection/inspection.routes";
import supplierRoutes from "../modules/supplier/supplier.routes";
import authorityRoutes from "../modules/authority/authority.routes";
import classRoutes from "../modules/class/class.routes";
import sourceFacilityRoutes from "../modules/source-facility/source-facility.routes";
import supplierCertificationRoutes from "../modules/supplier-certification/supplier-certification.routes";
import registrationRoutes from "../modules/registration/registration.routes";
import schoolSupplierRoutes from "../modules/school-supplier/school-supplier.routes";
import ingredientEntryRoutes from "../modules/ingredient-entry/ingredient-entry.routes";
import allergyRoutes from "../modules/allergy/allergy.routes";
import deliveryRoutes from "../modules/delivery/delivery.routes";
import dishRoutes from "../modules/dish/dish.routes";
import inventoryRoutes from "../modules/inventory/inventory.routes";
import retainedSampleRoutes from "../modules/retained-sample/retained-sample.routes";
import mealAllocationRoutes from "../modules/meal-allocation/meal-allocation.routes";
import ingredientQualityFeedbackRoutes from "../modules/ingredient-quality-feedback/ingredient-quality-feedback.routes";
import reportingRoutes from "../modules/reporting/reporting.routes";
import foodAnalysisRoutes from "../modules/food-analysis/food-analysis.routes";
import schoolAlertRoutes from "../modules/school-alert/school-alert.routes";
import traceabilityRoutes from "../modules/traceability/traceability.routes";
import menuReviewRoutes from "../modules/menu-review/menu-review.routes";

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

router.use("/auth/roles", authRoutes);
router.use("/users", userRoutes);
router.use("/schools", organizationRoutes);
router.use("/ingredients", ingredientRoutes);
router.use("/menus", menuRoutes);
router.use("/supply-requests", supplyOrderRoutes);
router.use("/ingredient-lots", warehouseRoutes);
router.use("/cooking-batches", kitchenRoutes);
router.use("/meal-portions", mealAttendanceRoutes);
router.use("/meal-complaints", feedbackRoutes);
router.use("/food-safety-incidents", inspectionRoutes);
router.use("/suppliers", supplierRoutes);
router.use("/commune-food-safety-units", authorityRoutes);
router.use("/classes", classRoutes);
router.use("/source-facilities", sourceFacilityRoutes);
router.use("/supplier-certifications", supplierCertificationRoutes);
router.use("/registration-requests", registrationRoutes);
router.use("/school-supplier-relationships", schoolSupplierRoutes);
router.use("/ingredient-entries", ingredientEntryRoutes);
router.use("/class-allergies", allergyRoutes);
router.use("/deliveries", deliveryRoutes);
router.use("/dishes", dishRoutes);
router.use("/inventory-transactions", inventoryRoutes);
router.use("/retained-food-samples", retainedSampleRoutes);
router.use("/meal-allocations", mealAllocationRoutes);
router.use("/ingredient-quality-feedback", ingredientQualityFeedbackRoutes);
router.use("/food-safety-reports", reportingRoutes);
router.use("/food-analysis-results", foodAnalysisRoutes);
router.use("/incident-school-alerts", schoolAlertRoutes);
router.use("/traceability-anchors", traceabilityRoutes);
router.use("/menu-reviews", menuReviewRoutes);

export default router;
