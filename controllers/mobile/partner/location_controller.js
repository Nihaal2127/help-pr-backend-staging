const mongoose = require('mongoose');
const State = require('../../../models/state');
const City = require('../../../models/city');
const Area = require('../../../models/area');
const { applyDropDownFilter } = require('../../../utils/pagination');
const areaService = require('../../../services/area_service');

const sendServiceResult = (res, result) => {
  if (!result.ok) {
    return res.status(result.status).json({
      success: false,
      status: result.status,
      message: result.message,
      ...(result.error !== undefined && { error: result.error }),
    });
  }
  return res.status(result.status).json({
    success: true,
    status: result.status,
    ...result.data,
  });
};

const states = async (req, res) => {
  try {
    const filter = {
      deleted_at: null,
      is_active: true,
    };
    const sort = { created_at: -1 };

    const { data: states } = await applyDropDownFilter(State, filter, sort);

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'State list fetched successfully.',
      records: states,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const cities = async (req, res) => {
  try {
    const filter = {
      deleted_at: null,
      is_active: true,
    };
    const sort = { created_at: -1 };

    if (req.query.state_id) {
      let stateIds = req.query.state_id;

      if (!Array.isArray(stateIds)) {
        stateIds = stateIds.split(',');
      }

      const validStateIds = stateIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (validStateIds.length === 0) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid state id format.',
        });
      }

      filter.state_id = { $in: validStateIds };
    }

    const { data: cities } = await applyDropDownFilter(City, filter, sort);

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'City list fetched successfully.',
      records: cities,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const areas = async (req, res) => {
  const result = await areaService.listAreasForDropdown(req.query);
  return sendServiceResult(res, result);
};

const normalizePincodes = (pincodes) => {
  if (!pincodes || !Array.isArray(pincodes)) return [];
  return [...new Set(pincodes.map((p) => String(p).trim()).filter(Boolean))];
};

const pincodes = async (req, res) => {
  try {
    const { area_id: areaIdRaw } = req.query;
    if (areaIdRaw === undefined || areaIdRaw === null || String(areaIdRaw).trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'area_id is required.',
      });
    }

    let areaIds = areaIdRaw;
    if (!Array.isArray(areaIds)) {
      areaIds = String(areaIds).split(',');
    }

    const oids = [];
    for (const raw of areaIds) {
      const id = String(raw).trim();
      if (!id) continue;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid area id format.',
        });
      }
      oids.push(new mongoose.Types.ObjectId(id));
    }

    if (oids.length === 0) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Provide at least one valid area_id.',
      });
    }

    const areas = await Area.find({
      _id: { $in: oids },
      deleted_at: null,
      is_active: true,
    })
      .select('pincodes')
      .lean();

    const pincodeSet = new Set();
    for (const area of areas) {
      for (const pincode of normalizePincodes(area.pincodes)) {
        pincodeSet.add(pincode);
      }
    }

    const records = [...pincodeSet].sort().map((pincode) => ({ pincode }));

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Pincode list fetched successfully.',
      records,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  states,
  cities,
  areas,
  pincodes,
};
