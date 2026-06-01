const {
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
} = require('../../../services/mobile/user/address_service');

const sendResult = (res, result) => {
  if (!result.ok) {
    return res.status(result.status).json({
      success: false,
      status: result.status,
      message: result.message,
    });
  }

  return res.status(result.status).json({
    success: true,
    status: result.status,
    message: result.data.message,
    ...(result.data.data !== undefined ? { data: result.data.data } : {}),
  });
};

const listHandler = async (req, res) => {
  try {
    const result = await listAddresses(req.user.id, { search: req.query.search });
    return sendResult(res, result);
  } catch (error) {
    console.error('mobile user addresses list', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const createHandler = async (req, res) => {
  try {
    const result = await createAddress(req.user.id, req.body);
    return sendResult(res, result);
  } catch (error) {
    console.error('mobile user address create', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const updateHandler = async (req, res) => {
  try {
    const result = await updateAddress(req.user.id, req.params.id, req.body);
    return sendResult(res, result);
  } catch (error) {
    console.error('mobile user address update', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const deleteHandler = async (req, res) => {
  try {
    const result = await deleteAddress(req.user.id, req.params.id);
    return sendResult(res, result);
  } catch (error) {
    console.error('mobile user address delete', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
};
