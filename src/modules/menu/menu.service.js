import sequelize from "../../config/database.js"
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

const formatDate = value => {
  const [year, month, day] = String(value).split("-")
  return `${day}/${month}/${year}`
}

const formatDateTime = value =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(value)
    : null

const findMenu = identifier => {
  if (!isUuid(identifier)) return null
  return WeeklyMenu.findByPk(identifier, { include: [{ association: "school" }] })
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
            association: "ingredientLinks",
            include: [
              {
                association: "ingredientEntry",
                include: [{ association: "ingredient", include: [{ association: "supplier" }] }],
              },
            ],
          },
        ],
      },
    ],
    order: [["display_order", "ASC"]],
  })

  return placements.map(placement => {
    const dish = placement.dish
    const supplierNames = [
      ...new Set(
        dish.ingredientLinks
          .map(link => link.ingredientEntry?.ingredient?.supplier?.name)
          .filter(Boolean)
      ),
    ]

    return {
      mealType: placement.meal_type,
      portionSize: Number(placement.portion_size) || 0,
      servingTime: null,
      sortOrder: placement.display_order || 0,
      item: {
        name: dish.name,
        description: dish.description,
        supplier: supplierNames.join(", ") || null,
        tag: null,
        tone: "neutral",
      },
    }
  })
}

const getApprovalDetail = async identifier => {
  const menu = await findMenu(identifier)
  if (!menu) return null

  const [days, reviews, defaultApprover] = await Promise.all([
    MenuDay.findAll({ where: { weekly_menu_id: menu.id }, order: [["menu_date", "ASC"]] }),
    MenuReviewRecord.findAll({
      where: { weekly_menu_id: menu.id },
      include: [{ model: User, as: "reviewer", attributes: ["full_name"] }],
      order: [["reviewed_at", "DESC"]],
    }),
    User.findOne({ where: { school_id: menu.school_id, status: "ACTIVE" } }),
  ])

  const dayPayload = await Promise.all(
    days.map(async (day, index) => {
      const date = new Date(`${day.menu_date}T00:00:00`)
      const items = await getDayDishes(day.id)
      const portions = items.reduce((largest, item) => Math.max(largest, item.portionSize), 0)
      return {
        id: day.id,
        shortLabel: DAY_LABELS[date.getDay()],
        dayNumber: String(index + 1),
        date: formatDate(day.menu_date),
        portions,
        lunch: items.filter(item => item.mealType === "LUNCH").map(item => item.item),
        snack: items.filter(item => item.mealType === "AFTERNOON").map(item => item.item),
      }
    })
  )

  const latestReview = reviews[0]
  const supplier = dayPayload
    .flatMap(day => [...day.lunch, ...day.snack])
    .find(item => item.supplier)?.supplier
  const firstDate = days[0]?.menu_date || menu.week_start_date
  const lastDate = days.at(-1)?.menu_date || menu.week_start_date

  return {
    id: menu.id,
    code: menu.id,
    title: menu.title,
    description: null,
    status: menu.status,
    submittedAt: formatDateTime(menu.submitted_at),
    summary: {
      audience: "Toàn trường",
      audienceDetail: "Số suất ăn được xác định theo kế hoạch phục vụ",
      servingPeriod: `${formatDate(firstDate)} - ${formatDate(lastDate)}`,
      servingDetail: `${days.length} ngày học bán trú`,
      proposer: "Bộ phận Bếp và Cán bộ Bán trú",
      proposerDetail: menu.school?.name || null,
      supplier: supplier || "Nhiều nhà cung cấp đã phê duyệt",
      supplierDetail: "Đối chiếu theo nguyên liệu của từng món",
    },
    compliance: [],
    days: dayPayload,
    medicalReview: {
      status: latestReview ? "Đã thẩm định" : "Chưa thẩm định",
      reviewer: latestReview?.reviewer?.full_name || "Chưa phân công",
      role: "Cán bộ Y tế",
      reviewedAt: formatDateTime(latestReview?.reviewed_at) || "—",
      note: latestReview?.feedback || "Chưa có nhận xét thẩm định.",
      documents: [],
    },
    approval: {
      approver: latestReview?.reviewer?.full_name || defaultApprover?.full_name || "Ban Giám hiệu",
      role: "Ban Giám hiệu",
    },
  }
}

const recordDecision = async ({ menuId, reviewerId, decision, feedback }) =>
  sequelize.transaction(async transaction => {
    const menu = await WeeklyMenu.findByPk(menuId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    if (!menu) return null

    let effectiveReviewerId = reviewerId
    if (!effectiveReviewerId) {
      const defaultReviewer = await User.findOne({
        where: { school_id: menu.school_id, status: "ACTIVE" },
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
    await menu.update(
      { status: nextStatus, approved_at: decision === "APPROVED" ? new Date() : null },
      { transaction }
    )
    const review = await MenuReviewRecord.create(
      {
        weekly_menu_id: menu.id,
        reviewer_user_id: effectiveReviewerId,
        decision,
        feedback: feedback || null,
        reviewed_at: new Date(),
      },
      { transaction }
    )

    return { id: menu.id, status: nextStatus, reviewId: review.id }
  })

const approveMenu = (menuId, reviewerId, notes) =>
  recordDecision({ menuId, reviewerId, decision: "APPROVED", feedback: notes })

const requestRevision = (menuId, reviewerId, reason) =>
  recordDecision({ menuId, reviewerId, decision: "REVISION_REQUESTED", feedback: reason })

export default { getApprovalDetail, approveMenu, requestRevision }
