import sequelize from "../../config/database.js"
import Ingredient from "../ingredient/ingredient.model.js"
import { School, Supplier } from "../organization/organization.model.js"
import User from "../user/user.model.js"
import {
  Dish,
  MenuDay,
  MenuDayDish,
  MenuReviewRecord,
  WeeklyMenu,
} from "./menu.model.js"
import { MENU_STATUSES } from "./menu.validation.js"

const DAY_LABELS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"]
const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const findMenu = identifier => {
  const where = isUuid(identifier) ? { id: identifier } : { code: identifier }
  return WeeklyMenu.findOne({ where, include: [{ model: School, as: "school" }] })
}

const formatDate = value => {
  const [year, month, day] = String(value).split("-")
  return `${day}/${month}/${year}`
}

const getDayDishes = async menuDayId => {
  const placements = await MenuDayDish.findAll({
    where: { menu_day_id: menuDayId },
    include: [
      {
        model: Dish,
        as: "dish",
        include: [
          {
            model: Ingredient,
            as: "ingredients",
            through: { attributes: ["quantity", "unit"] },
            include: [{ model: Supplier, as: "supplier" }],
          },
        ],
      },
    ],
    order: [["sort_order", "ASC"]],
  })

  return placements
    .map(placement => {
      const dish = placement.dish
      const supplierNames = [
        ...new Set(dish.ingredients.map(item => item.supplier?.name).filter(Boolean)),
      ]
      return {
        mealType: placement.meal_type,
        servingTime: placement.serving_time,
        sortOrder: placement.sort_order || 0,
        item: {
          name: dish.name,
          description: dish.description,
          supplier: supplierNames.join(", ") || null,
          tag: dish.allergen_label,
          tone: dish.warning_level,
          kind: dish.dish_type === "STAPLE" ? "staple" : dish.dish_type === "DESSERT" ? "dessert" : undefined,
        },
      }
    })
}

const getApprovalDetail = async identifier => {
  const menu = await findMenu(identifier)
  if (!menu) return null

  const [days, reviews, defaultApprover] = await Promise.all([
    MenuDay.findAll({ where: { weekly_menu_id: menu.id }, order: [["day_order", "ASC"]] }),
    MenuReviewRecord.findAll({
      where: { weekly_menu_id: menu.id },
      include: [{ model: User, as: "reviewer", attributes: ["full_name", "role"] }],
      order: [["reviewed_at", "DESC"]],
    }),
    User.findOne({
      where: { school_id: menu.school_id, role: "SCHOOL_MANAGEMENT_BOARD", status: "ACTIVE" },
    }),
  ])

  const dayPayload = await Promise.all(
    days.map(async day => {
      const date = new Date(`${day.service_date}T00:00:00`)
      const items = await getDayDishes(day.id)
      return {
        id: `t${day.day_order}`,
        shortLabel: DAY_LABELS[date.getDay()],
        dayNumber: String(day.day_order),
        date: formatDate(day.service_date),
        portions: day.portion_count,
        lunch: items.filter(item => item.mealType === "LUNCH").map(item => item.item),
        snack: items.filter(item => item.mealType === "SNACK").map(item => item.item),
      }
    })
  )

  const medical = reviews.find(review => review.review_type === "MEDICAL")
  const latestApproval = reviews.find(review => review.review_type === "MANAGEMENT")
  const supplier = dayPayload
    .flatMap(day => [...day.lunch, ...day.snack])
    .find(item => item.supplier)?.supplier

  return {
    id: menu.id,
    code: menu.code,
    title: menu.title,
    description: menu.description,
    status: menu.status,
    submittedAt: menu.submitted_at
      ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(menu.submitted_at)
      : null,
    summary: {
      audience: "Toàn trường (Khối 1 - Khối 5)",
      audienceDetail: `${menu.total_classes} lớp học · ${Number(menu.total_students).toLocaleString("vi-VN")} học sinh`,
      servingPeriod: `${formatDate(menu.start_date)} - ${formatDate(menu.end_date)}`,
      servingDetail: `${days.length} ngày học bán trú`,
      proposer: menu.proposer_name,
      proposerDetail: menu.proposer_detail,
      supplier: supplier || "Nhiều nhà cung cấp đã phê duyệt",
      supplierDetail: "Đối chiếu theo hồ sơ nguyên liệu từng món",
    },
    compliance: medical?.metadata?.compliance || [],
    days: dayPayload,
    medicalReview: {
      status: medical?.metadata?.status || "Chưa thẩm định",
      reviewer: medical?.reviewer?.full_name || "Chưa phân công",
      role: medical?.metadata?.role || medical?.reviewer?.role || "Cán bộ Y tế",
      reviewedAt: medical?.reviewed_at
        ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(medical.reviewed_at)
        : "—",
      note: medical?.comment || "Chưa có nhận xét thẩm định.",
      documents: medical?.metadata?.documents || [],
    },
    approval: {
      approver: latestApproval?.reviewer?.full_name || defaultApprover?.full_name || "Ban Giám hiệu",
      role: latestApproval?.reviewer?.role || "Hiệu trưởng",
    },
  }
}

const recordDecision = async ({ menuId, reviewerId, decision, comment }) => {
  return sequelize.transaction(async transaction => {
    const menu = await WeeklyMenu.findByPk(menuId, { transaction, lock: transaction.LOCK.UPDATE })
    if (!menu) return null

    let effectiveReviewerId = reviewerId
    if (!effectiveReviewerId) {
      const defaultReviewer = await User.findOne({
        where: {
          school_id: menu.school_id,
          role: "SCHOOL_MANAGEMENT_BOARD",
          status: "ACTIVE",
        },
        transaction,
      })
      effectiveReviewerId = defaultReviewer?.id
    }
    if (!effectiveReviewerId) {
      const error = new Error("Chưa cấu hình tài khoản Ban Giám hiệu mặc định")
      error.statusCode = 422
      throw error
    }

    const nextStatus =
      decision === "APPROVED" ? MENU_STATUSES.APPROVED : MENU_STATUSES.REVISION_REQUESTED

    await menu.update({ status: nextStatus }, { transaction })
    const review = await MenuReviewRecord.create(
      {
        weekly_menu_id: menu.id,
        reviewer_id: effectiveReviewerId,
        review_type: "MANAGEMENT",
        decision,
        comment: comment || null,
        reviewed_at: new Date(),
      },
      { transaction }
    )

    return { id: menu.id, status: nextStatus, reviewId: review.id }
  })
}

const approveMenu = (menuId, reviewerId, notes) =>
  recordDecision({ menuId, reviewerId, decision: "APPROVED", comment: notes })

const requestRevision = (menuId, reviewerId, reason) =>
  recordDecision({ menuId, reviewerId, decision: "REVISION_REQUESTED", comment: reason })

export default { getApprovalDetail, approveMenu, requestRevision }
