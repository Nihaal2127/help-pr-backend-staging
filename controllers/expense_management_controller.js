const Expense = require("../models/expense");
const {
  safeNotifyBackofficeExpenseCreated,
} = require("../src/modules/notifications/services/backofficeHooks");
const ExpenseCategory = require("../models/expense_category");
const ExpenseSubcategory = require("../models/expense_subcategory");
const Franchise = require("../models/franchise");
const mongoose = require("mongoose");

const MAX_PAGE_SIZE = 100;

const toIdString = (value) => {
  if (value === undefined || value === null) return "";
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === "object" && value !== null && value._id !== undefined) {
    return toIdString(value._id);
  }
  return String(value).trim();
};

const parseObjectId = (value) => {
  const s = toIdString(value);
  if (!s || !mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
};

/**
 * Loads an expense category by _id with deleted_at null.
 * Supports legacy docs where _id or refs may not match strict ObjectId queries.
 */
const findActiveExpenseCategoryById = async (idLike) => {
  const oid = parseObjectId(idLike);
  if (!oid) return null;
  let doc = await ExpenseCategory.findOne({ _id: oid, deleted_at: null }).lean();
  if (doc) return doc;
  const idStr = oid.toString();
  doc = await ExpenseCategory.findOne({
    deleted_at: null,
    $expr: { $eq: [{ $toString: "$_id" }, idStr] }
  }).lean();
  return doc;
};

const parsePagination = (query) => {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 10;
  if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;
  return { page, limit, skip: (page - 1) * limit };
};

const buildExpenseRecord = async (expenseDoc) => {
  const [category, subcategory] = await Promise.all([
    ExpenseCategory.findOne({ _id: expenseDoc.category_id, deleted_at: null }).lean(),
    ExpenseSubcategory.findOne({ _id: expenseDoc.subcategory_id, deleted_at: null }).lean()
  ]);

  return {
    _id: expenseDoc._id,
    franchise_id: expenseDoc.franchise_id,
    category_id: expenseDoc.category_id,
    category_name: category ? category.category_name : null,
    subcategory_id: expenseDoc.subcategory_id,
    sub_category_name: subcategory ? subcategory.sub_category_name : null,
    expense_name: expenseDoc.expense_name,
    description: expenseDoc.description,
    expense_amount: expenseDoc.expense_amount,
    expense_date: expenseDoc.expense_date,
    payment_mode: expenseDoc.payment_mode,
    created_at: expenseDoc.created_at,
    updated_at: expenseDoc.updated_at
  };
};

const create = async (req, res) => {
  try {
    const {
      franchise_id,
      category_id,
      subcategory_id,
      expense_name,
      description,
      expense_amount,
      expense_date,
      payment_mode
    } = req.body;

    const franchiseOid = parseObjectId(franchise_id);
    const franchise = await Franchise.findOne({ _id: franchiseOid, deleted_at: null });
    if (!franchise) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Franchise not found."
      });
    }

    const subOid = parseObjectId(subcategory_id);
    const subcategoryDoc = await ExpenseSubcategory.findOne({
      _id: subOid,
      deleted_at: null
    }).lean();
    if (!subcategoryDoc) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Sub category not found."
      });
    }

    const subRefStr = toIdString(subcategoryDoc.category_id);
    const bodyCatStr = toIdString(category_id);
    if (bodyCatStr && subRefStr && bodyCatStr !== subRefStr) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Sub category does not belong to the selected category."
      });
    }

    const categoryDoc = await findActiveExpenseCategoryById(subcategoryDoc.category_id);

    if (!categoryDoc) {
      const lookupId = subRefStr || bodyCatStr;
      const tomb =
        lookupId &&
        (await ExpenseCategory.findOne({
          $expr: { $eq: [{ $toString: "$_id" }, lookupId] }
        }).lean());
      if (tomb && tomb.deleted_at != null) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: "This expense category was deleted."
        });
      }
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Category not found for this sub category."
      });
    }

    const resolvedCategoryId = parseObjectId(categoryDoc._id) || categoryDoc._id;

    const record = new Expense({
      franchise_id: franchiseOid,
      category_id: resolvedCategoryId,
      subcategory_id: subOid,
      expense_name,
      description,
      expense_amount: Number(expense_amount),
      expense_date: new Date(expense_date),
      payment_mode
    });

    const savedRecord = await record.save();
    void safeNotifyBackofficeExpenseCreated({
      expense: savedRecord,
      actorUserId: req.user?.id || req.user?._id || null,
    });
    const formattedRecord = await buildExpenseRecord(savedRecord);

    return res.status(201).json({
      success: true,
      status: 201,
      message: "Expense created successfully.",
      record: formattedRecord
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error."
    });
  }
};

const getAll = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const search = req.query.search ? String(req.query.search).trim() : "";
    const franchiseId = req.query.franchise_id ? String(req.query.franchise_id).trim() : "";
    const sortKeyRaw = req.query.sort_by || req.query.sort;
    const sortBy = sortKeyRaw ? String(sortKeyRaw).trim() : "created_at";
    const sortOrder = req.query.sort_order === "asc" ? 1 : -1;

    const allowedSortFields = {
      id: "_id",
      category: "category_name",
      subcategory: "sub_category_name",
      expense_name: "expense_name",
      amount: "expense_amount",
      date: "expense_date",
      payment_mode: "payment_mode"
    };
    const sortField = allowedSortFields[sortBy] || "created_at";

    const pipeline = [
      { $match: { deleted_at: null } },
      {
        $lookup: {
          from: ExpenseCategory.collection.name,
          let: { catId: "$category_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ["$_id", "$$catId"] }, { $eq: ["$deleted_at", null] }]
                }
              }
            }
          ],
          as: "category_doc"
        }
      },
      {
        $lookup: {
          from: ExpenseSubcategory.collection.name,
          let: { subId: "$subcategory_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ["$_id", "$$subId"] }, { $eq: ["$deleted_at", null] }]
                }
              }
            }
          ],
          as: "subcategory_doc"
        }
      },
      {
        $addFields: {
          category_name: { $ifNull: [{ $arrayElemAt: ["$category_doc.category_name", 0] }, null] },
          sub_category_name: { $ifNull: [{ $arrayElemAt: ["$subcategory_doc.sub_category_name", 0] }, null] }
        }
      }
    ];

    if (franchiseId && mongoose.Types.ObjectId.isValid(franchiseId)) {
      pipeline.push({
        $match: {
          franchise_id: new mongoose.Types.ObjectId(franchiseId)
        }
      });
    }

    if (search) {
      pipeline.push({
        $match: {
          $or: [
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: "$_id" },
                  regex: search,
                  options: "i"
                }
              }
            },
            { category_name: { $regex: search, $options: "i" } },
            { sub_category_name: { $regex: search, $options: "i" } },
            { expense_name: { $regex: search, $options: "i" } },
            { payment_mode: { $regex: search, $options: "i" } },
            {
              $expr: {
                $regexMatch: {
                  input: {
                    $dateToString: {
                      format: "%Y-%m-%d %H:%M:%S",
                      date: "$expense_date"
                    }
                  },
                  regex: search,
                  options: "i"
                }
              }
            }
          ]
        }
      });
    }

    pipeline.push(
      { $sort: { [sortField]: sortOrder } },
      {
        $facet: {
          metadata: [{ $count: "totalItems" }],
          records: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                franchise_id: 1,
                category_id: 1,
                category_name: 1,
                subcategory_id: 1,
                sub_category_name: 1,
                expense_name: 1,
                description: 1,
                expense_amount: 1,
                expense_date: 1,
                payment_mode: 1,
                created_at: 1,
                updated_at: 1
              }
            }
          ]
        }
      }
    );

    const aggregatedResult = await Expense.aggregate(pipeline);
    const firstResult = aggregatedResult[0] || { metadata: [], records: [] };
    const totalItems = firstResult.metadata[0] ? firstResult.metadata[0].totalItems : 0;
    const totalPages = Math.ceil(totalItems / limit);
    const records = firstResult.records || [];

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Expense list fetched successfully.",
      totalItems,
      totalPages,
      currentPage: page,
      records
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error."
    });
  }
};

const getById = async (req, res) => {
  try {
    // const { id } = req.params;

    // const record = await Expense.findOne({ _id: id, deleted_at: null }).lean();
    const { id } = req.params;
    const { franchise_id } = req.query;

    const record = await Expense.findOne({
      _id: id,
      franchise_id,
      deleted_at: null
    }).lean();

    if (!record) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Expense not found."
      });
    }

    const formattedRecord = await buildExpenseRecord(record);

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Expense fetched successfully.",
      record: formattedRecord
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error."
    });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const expenseOid = parseObjectId(id);
    const record = await Expense.findOne({
      _id: expenseOid || id,
      deleted_at: null
    });

    if (!record) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Expense not found."
      });
    }

    const nextSubcategoryId = updateData.subcategory_id || record.subcategory_id;
    const nextFranchiseId = updateData.franchise_id || record.franchise_id;

    if (updateData.franchise_id || updateData.category_id || updateData.subcategory_id) {
      const nextFranchiseOid = parseObjectId(nextFranchiseId);
      const franchise = await Franchise.findOne({
        _id: nextFranchiseOid || nextFranchiseId,
        deleted_at: null
      });

      if (!franchise) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: "Franchise not found."
        });
      }

      const nextSubOid = parseObjectId(nextSubcategoryId);
      const subcategoryDoc = await ExpenseSubcategory.findOne({
        _id: nextSubOid,
        deleted_at: null
      }).lean();
      if (!subcategoryDoc) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: "Sub category not found."
        });
      }

      const updBodyCat = toIdString(updateData.category_id);
      const subRefStrUpd = toIdString(subcategoryDoc.category_id);
      if (updBodyCat && subRefStrUpd && updBodyCat !== subRefStrUpd) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: "Sub category does not belong to the selected category."
        });
      }

      let categoryDoc = await findActiveExpenseCategoryById(subcategoryDoc.category_id);
      if (!categoryDoc) {
        const lookupIdUpd = subRefStrUpd || updBodyCat;
        const tombUpd =
          lookupIdUpd &&
          (await ExpenseCategory.findOne({
            $expr: { $eq: [{ $toString: "$_id" }, lookupIdUpd] }
          }).lean());
        if (tombUpd && tombUpd.deleted_at != null) {
          return res.status(404).json({
            success: false,
            status: 404,
            message: "This expense category was deleted."
          });
        }
        return res.status(404).json({
          success: false,
          status: 404,
          message: "Category not found for this sub category."
        });
      }

      updateData.category_id = parseObjectId(categoryDoc._id) || categoryDoc._id;
    }

    Object.keys(updateData).forEach((key) => {
      if (key === "expense_amount") {
        record[key] = Number(updateData[key]);
      } else if (key === "expense_date") {
        record[key] = new Date(updateData[key]);
      } else {
        record[key] = updateData[key];
      }
    });
    record.updated_at = new Date();

    const updatedRecord = await record.save();
    const formattedRecord = await buildExpenseRecord(updatedRecord);

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Expense updated successfully.",
      record: formattedRecord
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error."
    });
  }
};

const remove = async (req, res) => {
  try {
    const { id } = req.params;

    // const record = await Expense.findOne({ _id: id, deleted_at: null });
    const { franchise_id } = req.query;

    const record = await Expense.findOne({
      _id: id,
      franchise_id,
      deleted_at: null
    });

    if (!record) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Expense not found."
      });
    }

    record.deleted_at = new Date();
    record.updated_at = new Date();
    await record.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Expense deleted successfully."
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error."
    });
  }
};

module.exports = { create, getAll, getById, update, remove };
