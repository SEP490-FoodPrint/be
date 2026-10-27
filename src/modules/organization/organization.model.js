import School from "../school/school.model.js"
import Supplier from "../supplier/supplier.model.js"

// Compatibility exports for the aggregate menu-approval feature.
// Canonical model definitions live in their feature modules.
export { School, Supplier }
export default { School, Supplier }
