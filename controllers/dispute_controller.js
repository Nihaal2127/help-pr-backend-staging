const {
  listDisputesForBackOffice,
  getDisputeById,
  updateDisputeStatus,
} = require("../services/dispute_service");

const sendServiceResult = (res, result, successStatus = 200) => {
  if (!result.ok) {
    return res.status(result.status).json({
      success: false,
      status: result.status,
      message: result.message,
      ...(result.record ? { record: result.record } : {}),
    });
  }

  return res.status(result.status || successStatus).json({
    success: true,
    status: result.status || successStatus,
    message: result.message,
    ...(result.record ? { record: result.record } : {}),
    ...(result.records ? { records: result.records } : {}),
    ...(result.totalItems !== undefined ? { totalItems: result.totalItems } : {}),
    ...(result.totalPages !== undefined ? { totalPages: result.totalPages } : {}),
    ...(result.currentPage !== undefined ? { currentPage: result.currentPage } : {}),
  });
};

const getAll = async (req, res) => {
  try {
    const result = await listDisputesForBackOffice(req, req.query);
    return sendServiceResult(res, result);
  } catch (error) {
    console.error("dispute getAll:", error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const getById = async (req, res) => {
  try {
    const result = await getDisputeById(req, req.params.id);
    return sendServiceResult(res, result);
  } catch (error) {
    console.error("dispute getById:", error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const updateStatus = async (req, res) => {
  try {
    const result = await updateDisputeStatus(req, req.params.id, req.body);
    return sendServiceResult(res, result);
  } catch (error) {
    console.error("dispute updateStatus:", error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

module.exports = {
  getAll,
  getById,
  updateStatus,
};
