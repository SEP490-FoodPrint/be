import { Router } from "express"
import menuRoutes from "../modules/menu/menu.routes.js"

// 1. Health check & API System Info
const router = Router()

router.use("/menus", menuRoutes)

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "FoodPrint Backend API (Modular Architecture)",
    totalModules: 43,
    database: "PostgreSQL (foodprint)",
    timestamp: new Date().toISOString(),
  })
})

// 2. Import 43 Feature Module Routes
import authRoutes from "../modules/auth/auth.routes.js"
import classRoutes from "../modules/class/class.routes.js"
import classAllergyRoutes from "../modules/class-allergy/class-allergy.routes.js"
import communeFoodSafetyUnitRoutes from "../modules/commune-food-safety-unit/commune-food-safety-unit.routes.js"
import cookingBatchRoutes from "../modules/cooking-batch/cooking-batch.routes.js"
import cookingBatchLotRoutes from "../modules/cooking-batch-lot/cooking-batch-lot.routes.js"
import dailyAllergyPortionRoutes from "../modules/daily-allergy-portion/daily-allergy-portion.routes.js"
import dailyMealPortionRoutes from "../modules/daily-meal-portion/daily-meal-portion.routes.js"
import deliveryRoutes from "../modules/delivery/delivery.routes.js"
import deliveryApprovalRoutes from "../modules/delivery-approval/delivery-approval.routes.js"
import deliveryItemRoutes from "../modules/delivery-item/delivery-item.routes.js"
import dishRoutes from "../modules/dish/dish.routes.js"
import dishIngredientEntryRoutes from "../modules/dish-ingredient-entry/dish-ingredient-entry.routes.js"
import foodAnalysisResultRoutes from "../modules/food-analysis-result/food-analysis-result.routes.js"
import foodSafetyIncidentRoutes from "../modules/food-safety-incident/food-safety-incident.routes.js"
import foodSafetyIncidentAllocationRoutes from "../modules/food-safety-incident-allocation/food-safety-incident-allocation.routes.js"
import foodSafetyReportForwardingRoutes from "../modules/food-safety-report-forwarding/food-safety-report-forwarding.routes.js"
import incidentSchoolAlertRoutes from "../modules/incident-school-alert/incident-school-alert.routes.js"
import ingredientRoutes from "../modules/ingredient/ingredient.routes.js"
import ingredientEntryRoutes from "../modules/ingredient-entry/ingredient-entry.routes.js"
import ingredientLotRoutes from "../modules/ingredient-lot/ingredient-lot.routes.js"
import ingredientQualityFeedbackRoutes from "../modules/ingredient-quality-feedback/ingredient-quality-feedback.routes.js"
import inventoryTransactionRoutes from "../modules/inventory-transaction/inventory-transaction.routes.js"
import mealAllocationRoutes from "../modules/meal-allocation/meal-allocation.routes.js"
import mealAllocationBatchRoutes from "../modules/meal-allocation-batch/meal-allocation-batch.routes.js"
import mealComplaintRoutes from "../modules/meal-complaint/meal-complaint.routes.js"
import menuDayRoutes from "../modules/menu-day/menu-day.routes.js"
import menuDayDishRoutes from "../modules/menu-day-dish/menu-day-dish.routes.js"
import menuReviewRecordRoutes from "../modules/menu-review-record/menu-review-record.routes.js"
import registrationRequestRoutes from "../modules/registration-request/registration-request.routes.js"
import retainedFoodSampleRoutes from "../modules/retained-food-sample/retained-food-sample.routes.js"
import roleRoutes from "../modules/role/role.routes.js"
import schoolRoutes from "../modules/school/school.routes.js"
import schoolSupplierRelationshipRoutes from "../modules/school-supplier-relationship/school-supplier-relationship.routes.js"
import sourceFacilityRoutes from "../modules/source-facility/source-facility.routes.js"
import supplierRoutes from "../modules/supplier/supplier.routes.js"
import supplierCertificationRoutes from "../modules/supplier-certification/supplier-certification.routes.js"
import supplierIngredientRoutes from "../modules/supplier-ingredient/supplier-ingredient.routes.js"
import supplyRequestRoutes from "../modules/supply-request/supply-request.routes.js"
import supplyRequestItemRoutes from "../modules/supply-request-item/supply-request-item.routes.js"
import traceabilityAnchorRoutes from "../modules/traceability-anchor/traceability-anchor.routes.js"
import userRoutes from "../modules/user/user.routes.js"
import weeklyMenuRoutes from "../modules/weekly-menu/weekly-menu.routes.js"

// 3. Register 43 Feature Module Routes
router.use("/auth", authRoutes)
router.use("/classes", classRoutes)
router.use("/class-allergies", classAllergyRoutes)
router.use("/commune-food-safety-units", communeFoodSafetyUnitRoutes)
router.use("/cooking-batchs", cookingBatchRoutes)
router.use("/cooking-batch-lots", cookingBatchLotRoutes)
router.use("/daily-allergy-portions", dailyAllergyPortionRoutes)
router.use("/daily-meal-portions", dailyMealPortionRoutes)
router.use("/deliveries", deliveryRoutes)
router.use("/delivery-approvals", deliveryApprovalRoutes)
router.use("/delivery-items", deliveryItemRoutes)
router.use("/dishes", dishRoutes)
router.use("/dish-ingredient-entrys", dishIngredientEntryRoutes)
router.use("/food-analysis-results", foodAnalysisResultRoutes)
router.use("/food-safety-incidents", foodSafetyIncidentRoutes)
router.use("/food-safety-incident-allocations", foodSafetyIncidentAllocationRoutes)
router.use("/food-safety-report-forwardings", foodSafetyReportForwardingRoutes)
router.use("/incident-school-alerts", incidentSchoolAlertRoutes)
router.use("/ingredients", ingredientRoutes)
router.use("/ingredient-entrys", ingredientEntryRoutes)
router.use("/ingredient-lots", ingredientLotRoutes)
router.use("/ingredient-quality-feedback", ingredientQualityFeedbackRoutes)
router.use("/inventory-transactions", inventoryTransactionRoutes)
router.use("/meal-allocations", mealAllocationRoutes)
router.use("/meal-allocation-batchs", mealAllocationBatchRoutes)
router.use("/meal-complaints", mealComplaintRoutes)
router.use("/menu-days", menuDayRoutes)
router.use("/menu-day-dishs", menuDayDishRoutes)
router.use("/menu-review-records", menuReviewRecordRoutes)
router.use("/registration-requests", registrationRequestRoutes)
router.use("/retained-food-samples", retainedFoodSampleRoutes)
router.use("/roles", roleRoutes)
router.use("/schools", schoolRoutes)
router.use("/school-supplier-relationships", schoolSupplierRelationshipRoutes)
router.use("/source-facilitys", sourceFacilityRoutes)
router.use("/suppliers", supplierRoutes)
router.use("/supplier-certifications", supplierCertificationRoutes)
router.use("/supplier-ingredients", supplierIngredientRoutes)
router.use("/supply-requests", supplyRequestRoutes)
router.use("/supply-request-items", supplyRequestItemRoutes)
router.use("/traceability-anchors", traceabilityAnchorRoutes)
router.use("/users", userRoutes)
router.use("/weekly-menus", weeklyMenuRoutes)

export default router
