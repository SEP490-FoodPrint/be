import { Router } from "express"
import SupplierIngredientController from "./supplier-ingredient.controller.js"
import { validateCreate, validateUpdate } from "./supplier-ingredient.validation.js"
import { checkExists } from "./supplier-ingredient.middleware.js"
import { authenticate } from "../../middlewares/auth.middleware.js"

const router = Router()

router.use(authenticate)

router.post("/", validateCreate, SupplierIngredientController.create)
router.get("/", SupplierIngredientController.getAll)
router.get("/:id", checkExists, SupplierIngredientController.getById)
router.put("/:id", checkExists, validateUpdate, SupplierIngredientController.update)
router.delete("/:id", checkExists, SupplierIngredientController.remove)

export default router
