const getCallerId = (req) => req.user?.id || req.user?._id;

const sendServiceError = (res, result, extraFields = {}) => {
  const payload = {
    success: false,
    status: result.status,
    message: result.message,
    ...extraFields,
  };
  if (result.breakdown !== undefined) {
    payload.breakdown = result.breakdown;
  }
  if (result.details !== undefined) {
    payload.details = result.details;
  }
  return res.status(result.status).json(payload);
};

const sendInternalError = (res, logLabel, error) => {
  console.error(logLabel, error.message);
  return res.status(500).json({
    success: false,
    status: 500,
    message: 'Internal server error.',
  });
};

const wrapMobileHandler = (logLabel, handler, options = {}) => async (req, res) => {
  const errorMessage = options.errorMessage || 'Internal server error.';
  try {
    return await handler(req, res);
  } catch (error) {
    console.error(logLabel, error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: errorMessage,
    });
  }
};

const sendPaginatedListFromData = (res, result, { includeTodayCount = true } = {}) => {
  if (!result.ok) {
    return sendServiceError(res, result);
  }

  const listData = result.data.data;
  const payload = {
    success: true,
    status: 200,
    message: result.data.message,
    totalItems: listData.totalItems,
    totalPages: listData.totalPages,
    currentPage: listData.currentPage,
    limit: listData.limit,
    records: listData.records,
  };

  if (includeTodayCount && listData.todayCount !== undefined) {
    payload.todayCount = listData.todayCount;
  }

  return res.status(200).json(payload);
};

const sendRecordResult = (res, result, extraSuccessFields = {}) => {
  if (!result.ok) {
    return sendServiceError(res, result);
  }

  return res.status(200).json({
    success: true,
    status: 200,
    message: result.data.message,
    record: result.data.record,
    ...extraSuccessFields,
  });
};

const sendServiceResult = (res, result) => {
  if (!result.ok) {
    return sendServiceError(res, result);
  }

  const payload = {
    success: true,
    status: result.status,
    message: result.data.message,
  };

  if (result.data.data !== undefined) {
    payload.data = result.data.data;
  }
  if (result.data.record !== undefined) {
    payload.record = result.data.record;
  }
  if (result.data.totalItems !== undefined) {
    payload.totalItems = result.data.totalItems;
    payload.totalPages = result.data.totalPages;
    payload.currentPage = result.data.currentPage;
    payload.limit = result.data.limit;
    if (result.data.records) {
      payload.records = result.data.records;
    }
  }

  return res.status(result.status).json(payload);
};

const sendDataResult = (res, result) => {
  if (!result.ok) {
    return sendServiceError(res, result);
  }

  return res.status(result.status).json({
    success: true,
    status: result.status,
    message: result.data.message,
    ...(result.data.data !== undefined ? { data: result.data.data } : {}),
  });
};

const sendTopLevelServiceResult = (res, result, { httpStatus = 200 } = {}) => {
  if (!result.ok) {
    return sendServiceError(res, result);
  }

  const payload = {
    success: true,
    status: httpStatus,
    message: result.message,
  };
  if (result.data !== undefined) {
    payload.data = result.data;
  }
  return res.status(httpStatus).json(payload);
};

const sendSpreadDataResult = (res, result) => {
  if (!result.ok) {
    return sendServiceError(res, result);
  }

  const status = result.status || 200;
  return res.status(status).json({
    success: true,
    status,
    ...result.data,
  });
};

const sendPaginatedListWithNestedData = (res, result, buildData) => {
  if (!result.ok) {
    return sendServiceError(res, result);
  }

  const listData = result.data.data;
  return res.status(200).json({
    success: true,
    status: 200,
    message: result.data.message,
    totalItems: listData.totalItems,
    totalPages: listData.totalPages,
    currentPage: listData.currentPage,
    limit: listData.limit,
    data: buildData(listData),
  });
};

const sendCreatedOrOkDataResult = (res, result, createdMessage) => {
  if (!result.ok) {
    return sendServiceError(res, result);
  }

  const httpStatus = result.data.message === createdMessage ? 201 : 200;
  return res.status(httpStatus).json({
    success: true,
    status: httpStatus,
    message: result.data.message,
    data: result.data.data,
  });
};

const sendStatusPayloadResult = (res, result, buildPayload) => {
  if (!result.ok) {
    return sendServiceError(res, result);
  }

  const status = result.status || 200;
  return res.status(status).json({
    success: true,
    status,
    ...buildPayload(result),
  });
};

module.exports = {
  getCallerId,
  sendServiceError,
  sendInternalError,
  wrapMobileHandler,
  sendPaginatedListFromData,
  sendRecordResult,
  sendServiceResult,
  sendDataResult,
  sendTopLevelServiceResult,
  sendSpreadDataResult,
  sendPaginatedListWithNestedData,
  sendCreatedOrOkDataResult,
  sendStatusPayloadResult,
};
